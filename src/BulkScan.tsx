import { useEffect, useRef, useState } from 'react'
import { beep, cropGuide, guideSignature, sigDiff } from './lib/frame'
import { scanCanvas } from './lib/ocr'
import { findCards, toOwned } from './lib/tcg'
import type { Collection, OwnedCard, TcgCard } from './lib/types'

interface Props {
  collections: Collection[]
  defaultCollectionId: string
  onAdd: (card: OwnedCard) => void
  onClose: () => void
}

interface ReviewItem {
  key: number
  thumb: string
  note: string
  candidates: TcgCard[]
}

interface AddedItem {
  key: number
  name: string
  image: string
  detail: string
}

const RATIO = 63 / 88
const TICK_MS = 150
const PRESENT_DIFF = 14 // guide area differs from the empty mount by this much => something is there
const CHANGED_DIFF = 14 // guide area differs from the last captured card by this much => card swapped/removed
const STABLE_DIFF = 3 // frame-to-frame difference below this => holding still
const STABLE_TICKS = 4 // ...for this many ticks (about 0.6s) before capturing

/** Hands-free scanning for a phone on a mount: feed cards one after another and they add themselves. */
export default function BulkScan({ collections, defaultCollectionId, onAdd, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const guideRef = useRef<HTMLDivElement>(null)

  const [collectionId, setCollectionId] = useState(defaultCollectionId)
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('Mount the phone, empty the scan area, then tap Start.')
  const [added, setAdded] = useState<AddedItem[]>([])
  const [review, setReview] = useState<ReviewItem[]>([])
  const [error, setError] = useState('')

  // Mutable loop state lives in refs so the interval never sees stale values.
  const collectionRef = useRef(collectionId)
  collectionRef.current = collectionId
  const onAddRef = useRef(onAdd)
  onAddRef.current = onAdd
  const loop = useRef({
    busy: false,
    armed: true,
    stable: 0,
    baseline: null as Uint8Array | null,
    captured: null as Uint8Array | null,
    last: null as Uint8Array | null,
    key: 0,
    timer: 0,
  })
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null)

  useEffect(() => {
    let stream: MediaStream | undefined
    let cancelled = false
    navigator.mediaDevices
      ?.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop())
        stream = s
        if (videoRef.current) {
          videoRef.current.srcObject = s
          videoRef.current.play().catch(() => {})
        }
      })
      .catch(() => setError('Camera not available. Allow camera access and reopen this screen.'))
    if (!navigator.mediaDevices) setError('Camera not available in this browser.')
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
      window.clearInterval(loop.current.timer)
      wakeLock.current?.release().catch(() => {})
    }
  }, [])

  function signature() {
    const v = videoRef.current
    const b = boxRef.current
    const g = guideRef.current
    return v && b && g ? guideSignature(v, b, g) : null
  }

  async function start() {
    const l = loop.current
    setError('')
    setStatus('Learning the empty mount…')
    await new Promise((r) => setTimeout(r, 600))
    const base = signature()
    if (!base) {
      setError('Camera is not ready yet. Wait a moment and tap Start again.')
      return
    }
    l.baseline = base
    l.captured = null
    l.last = null
    l.armed = true
    l.stable = 0
    l.busy = false
    try {
      // Keep the screen awake while scanning.
      const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
      wakeLock.current = (await nav.wakeLock?.request('screen')) ?? null
    } catch {
      /* not supported; the screen may dim */
    }
    window.clearInterval(l.timer)
    l.timer = window.setInterval(tick, TICK_MS)
    setRunning(true)
    setStatus('Ready. Feed the first card.')
  }

  function stop() {
    window.clearInterval(loop.current.timer)
    wakeLock.current?.release().catch(() => {})
    wakeLock.current = null
    setRunning(false)
    setStatus('Stopped.')
  }

  function tick() {
    const l = loop.current
    if (l.busy || !l.baseline) return
    const sig = signature()
    if (!sig) return

    const prevDiff = l.last ? sigDiff(sig, l.last) : 99
    l.last = sig
    const present = sigDiff(sig, l.baseline) > PRESENT_DIFF

    if (!l.armed) {
      // After a capture, wait until the card is removed or replaced before looking again.
      if (l.captured && sigDiff(sig, l.captured) > CHANGED_DIFF) {
        l.armed = true
        l.stable = 0
      } else {
        return
      }
    }
    if (!present) {
      l.stable = 0
      setStatus('Ready. Feed the next card.')
      return
    }
    l.stable = prevDiff < STABLE_DIFF ? l.stable + 1 : 0
    if (l.stable >= STABLE_TICKS) capture(sig)
    else setStatus('Card detected, hold still…')
  }

  function forceScan() {
    const sig = signature()
    if (sig && !loop.current.busy) capture(sig)
  }

  async function capture(sig: Uint8Array) {
    const l = loop.current
    const v = videoRef.current
    const b = boxRef.current
    const g = guideRef.current
    if (!v || !b || !g) return
    const card = cropGuide(v, b, g)
    if (!card) return
    l.busy = true
    l.armed = false
    l.captured = sig
    l.stable = 0
    const key = ++l.key
    const thumb = makeThumb(card)

    try {
      setStatus('Reading card…')
      const scan = await scanCanvas(card, undefined, true)
      if (!scan.name && !scan.number) {
        addReview({ key, thumb, note: 'Could not read this card.', candidates: [] })
        return
      }
      setStatus(`Looking up ${scan.name || 'card'} ${scan.number}…`)
      let results: TcgCard[] = []
      try {
        results = await findCards(scan.name, scan.number, scan.total, scan.nameConfident)
      } catch (e) {
        addReview({
          key,
          thumb,
          note: `${scan.name} ${scan.number}: ${e instanceof Error ? e.message : 'lookup failed'}`,
          candidates: [],
        })
        return
      }

      const pick = confidentMatch(results, scan.nameConfident && !!scan.number, scan.total)
      if (pick) {
        onAddRef.current(toOwned(pick, collectionRef.current))
        setAdded((a) => [
          { key, name: pick.name, image: pick.images.small, detail: `${pick.set.name} · #${pick.number}` },
          ...a,
        ].slice(0, 30))
        beep(880, 110)
        setStatus(`Added ${pick.name}. Feed the next card.`)
      } else {
        addReview({
          key,
          thumb,
          note: `Read: ${scan.name || '?'} ${scan.number || '?'}${scan.total ? '/' + scan.total : ''}`,
          candidates: results.slice(0, 6),
        })
      }
    } catch (e) {
      addReview({ key, thumb, note: e instanceof Error ? e.message : 'Scan failed', candidates: [] })
    } finally {
      l.busy = false
    }
  }

  function addReview(item: ReviewItem) {
    setReview((r) => [item, ...r])
    beep(300, 220)
    setStatus('Needs review. Feed the next card.')
    loop.current.busy = false
  }

  function resolve(item: ReviewItem, card?: TcgCard) {
    if (card) {
      onAdd(toOwned(card, collectionId))
      setAdded((a) => [
        { key: item.key, name: card.name, image: card.images.small, detail: `${card.set.name} · #${card.number}` },
        ...a,
      ].slice(0, 30))
    }
    setReview((r) => r.filter((x) => x.key !== item.key))
  }

  const colName = collections.find((c) => c.id === collectionId)?.name ?? ''

  return (
    <div className="bulk">
      <div className="bulk-cam" ref={boxRef}>
        <video ref={videoRef} playsInline muted />
        <div className="guide" ref={guideRef} style={{ aspectRatio: String(RATIO), height: '90%' }} />
      </div>

      <div className="bulk-panel">
        <div className="bulk-top">
          <button className="link" onClick={() => { stop(); onClose() }}>Close</button>
          <strong>Auto scan → {colName}</strong>
          <span className="count">{added.length} added</span>
        </div>

        {!running && (
          <label className="field">
            Add cards to
            <select value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        )}

        <p className={error ? 'error' : 'status'}>{error || status}</p>

        <div className="row">
          {!running ? (
            <button className="primary big" onClick={start} disabled={!!error}>▶ Start with empty mount</button>
          ) : (
            <>
              <button className="grow" onClick={stop}>Stop</button>
              <button className="grow" onClick={forceScan}>Scan now</button>
              <button className="grow" onClick={() => { stop(); start() }}>Recalibrate</button>
            </>
          )}
        </div>

        {review.length > 0 && (
          <>
            <h3>Needs review ({review.length})</h3>
            <ul className="results">
              {review.map((item) => (
                <li key={item.key} className="review">
                  <img src={item.thumb} alt="scanned card" className="thumb" />
                  <div className="meta">
                    <span>{item.note}</span>
                    <div className="cands">
                      {item.candidates.map((c) => (
                        <button key={c.id} onClick={() => resolve(item, c)}>
                          {c.name} · {c.set.name} #{c.number}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => resolve(item)}>Skip</button>
                </li>
              ))}
            </ul>
          </>
        )}

        {added.length > 0 && (
          <>
            <h3>Added</h3>
            <ul className="results">
              {added.map((a) => (
                <li key={a.key}>
                  <img src={a.image} alt={a.name} />
                  <div className="meta">
                    <strong>{a.name}</strong>
                    <span>{a.detail}</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Auto-add only when the match is clear: a confidently read name plus number that leads to
 * exactly one card, or to one card whose set total agrees with the printed total.
 */
function confidentMatch(results: TcgCard[], confident: boolean, total: string): TcgCard | null {
  if (!confident || !results.length) return null
  if (results.length === 1) return results[0]
  if (total) {
    const sameTotal = results.filter((c) => String(c.set.printedTotal) === total)
    if (sameTotal.length === 1) return sameTotal[0]
  }
  return null
}

function makeThumb(card: HTMLCanvasElement): string {
  const c = document.createElement('canvas')
  c.width = 90
  c.height = Math.round((card.height / card.width) * 90)
  c.getContext('2d')!.drawImage(card, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.7)
}
