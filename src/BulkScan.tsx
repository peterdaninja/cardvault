import { useEffect, useRef, useState } from 'react'
import { CardTracker } from './lib/autoscan'
import { beep, boxToScreen, cropBox, frameSignature, isBlank, type Box, type FrameSig } from './lib/frame'
import { toOwned, type CatalogCard } from './lib/catalog'
import { adapterFor } from './lib/games'
import { applyZoom, listCameras, openCamera, saveCameraId, savedCameraId, type CameraChoice, type CameraInfo } from './lib/camera'
import { ZONES } from './lib/zones'
import { confidentMatch, decide } from './lib/confidence'
import { SetMatcher } from './lib/imagematch'
import { scanFor, type ScanResult } from './lib/scan'
import { money } from './ui/format'
import type { Collection, Game, OwnedCard } from './lib/types'

interface Props {
  collections: Collection[]
  defaultCollectionId: string
  onAdd: (card: OwnedCard) => void
  /** Take back one copy of a card that was added by mistake. */
  onUndo: (card: CatalogCard, collectionId: string) => void
  onClose: () => void
}

interface ReviewItem {
  key: number
  thumb: string
  big?: string // a larger picture to look at when tapped
  raw?: string // what the reader actually saw, to help work out why a card was missed
  scan?: ScanResult // set when the lookup failed on the network, so it can be tried again
  note: string
  candidates: CatalogCard[]
}

interface AddedItem {
  key: number
  name: string
  image: string
  detail: string
  price: number | null
  card: CatalogCard
  collectionId: string
  scanThumb?: string // what the camera saw, to compare with the matched card
}

const TICK_MS = 150
const CARD_ASPECT = 63 / 88
const FRAME_KEY = 'slowtcg-frame-v1'
// A starting spot for a card standing in a mount, a little below the middle of a portrait picture.
const DEFAULT_FRAME: Box = { x0: 0.28, y0: 0.335, x1: 0.74, y1: 0.696 }

function loadFrame(camera = ''): Box {
  try {
    const b = JSON.parse(localStorage.getItem(FRAME_KEY + camera) ?? 'null') as Box | null
    if (b && b.x1 > b.x0 && b.y1 > b.y0 && b.x0 >= 0 && b.y0 >= 0 && b.x1 <= 1 && b.y1 <= 1) return b
  } catch {
    /* fall through to the default */
  }
  return DEFAULT_FRAME
}

/**
 * Hands-free scanning for a phone on a mount. You set a green frame once, over where the mount holds
 * a card. Then it only watches inside that frame, so shifting light elsewhere cannot fool it.
 */
export default function BulkScan({ collections, defaultCollectionId, onAdd, onUndo, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const [collectionId, setCollectionId] = useState(defaultCollectionId)
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('')
  const [added, setAdded] = useState<AddedItem[]>([])
  const [review, setReview] = useState<ReviewItem[]>([])
  const [error, setError] = useState('')
  const [frame, setFrame] = useState<Box>(() => loadFrame(''))
  const [cardIn, setCardIn] = useState(false) // a card is in the frame right now
  const [cameras, setCameras] = useState<CameraChoice[]>([])
  const [cameraId, setCameraId] = useState<string | undefined>(savedCameraId)
  const [info, setInfo] = useState<CameraInfo | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const vocabRef = useRef<string[] | undefined>(undefined) // names of the cards in this collection's set
  const [zoomKey, setZoomKey] = useState<number | null>(null)
  const [adjusting, setAdjusting] = useState(false) // the frame is being moved, so watching is paused
  const matcherRef = useRef<SetMatcher | null>(null) // recognises a card by its picture, for Pokémon sets
  const [pics, setPics] = useState<{ state: 'none' | 'loading' | 'ready' | 'failed'; done: number; total: number }>({ state: 'none', done: 0, total: 0 })
  const [setReady, setSetReady] = useState<{ state: 'none' | 'loading' | 'ready' | 'failed'; count: number }>({ state: 'none', count: 0 })
  const [, redraw] = useState(0) // re-render once the video size is known, so the frame can be placed

  // Mutable loop state lives in refs so the interval never sees stale values.
  const collectionRef = useRef(collectionId)
  collectionRef.current = collectionId
  const onAddRef = useRef(onAdd)
  onAddRef.current = onAdd
  const frameRef = useRef(frame)
  frameRef.current = frame
  const infoRef = useRef<CameraInfo | null>(null)
  infoRef.current = info
  const loop = useRef({ busy: false, key: 0, timer: 0, paused: false })
  const tracker = useRef(new CardTracker())
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null)
  const drag = useRef<{ mode: 'move' | 'resize'; x: number; y: number; start: Box } | null>(null)

  useEffect(() => {
    tracker.current.setFixed(frame)
  }, [frame])

  // Open the chosen camera (or the default back camera). Changing the choice reopens it.
  useEffect(() => {
    let cancelled = false
    let opened: MediaStream | undefined
    setError('')
    openCamera(cameraId)
      .then(async ({ stream, info: i }) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop())
        opened = stream
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }
        setInfo(i)
        setFrame(loadFrame(i.label))
        setCameras(await listCameras())
      })
      .catch(() => {
        if (cameraId) {
          saveCameraId('') // the saved camera is gone or unavailable; fall back to the default
          setCameraId(undefined)
        } else setError('Camera not available. Allow camera access and reopen this screen.')
      })
    return () => {
      cancelled = true
      opened?.getTracks().forEach((t) => t.stop())
    }
  }, [cameraId])

  useEffect(() => {
    return () => {
      window.clearInterval(loop.current.timer)
      wakeLock.current?.release().catch(() => {})
    }
  }, [])

  function signature() {
    const v = videoRef.current
    return v ? frameSignature(v) : null
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  /** Count down so the mount can be emptied, then remember what it looks like empty. */
  async function learnEmpty(): Promise<boolean> {
    for (let s = 3; s > 0; s--) {
      setStatus(`Take any card out of the mount. Learning the empty mount in ${s}…`)
      await sleep(1000)
    }
    const base = signature()
    if (!base) {
      setError('Camera is not ready yet. Wait a moment and tap Start again.')
      return false
    }
    tracker.current.setFixed(frameRef.current)
    tracker.current.reset(base)
    return true
  }

  function readyMessage(first: boolean) {
    return tracker.current.baselineOccupied
      ? 'Heads up: there still seems to be a card in the frame, so a new card may not be noticed. Take it out and tap Re-learn.'
      : first
        ? 'Ready. Put the first card in the mount.'
        : 'Ready. Put the next card in the mount.'
  }

  async function start() {
    const l = loop.current
    setError('')
    if (!(await learnEmpty())) return
    l.busy = false
    l.paused = false
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
    setStatus(readyMessage(true))
  }

  /** Learn the empty mount again while running (the mount must be empty). */
  async function relearn() {
    const l = loop.current
    l.paused = true
    setAdjusting(false)
    setCardIn(false)
    if (await learnEmpty()) setStatus(readyMessage(false))
    l.paused = false
  }

  /** Pause to move or resize the frame without losing what was learned about the empty mount. */
  function toggleAdjust() {
    const l = loop.current
    if (!adjusting) {
      l.paused = true
      setAdjusting(true)
      setStatus('Drag the green frame onto a card in the mount. Drag the dot to resize it. Tap Done when it fits.')
    } else {
      setAdjusting(false)
      l.paused = false
      setStatus(readyMessage(false))
    }
  }

  function stop() {
    window.clearInterval(loop.current.timer)
    wakeLock.current?.release().catch(() => {})
    wakeLock.current = null
    setRunning(false)
    setAdjusting(false)
    loop.current.paused = false
    setCardIn(false)
    setStatus('')
  }

  function tick() {
    const l = loop.current
    if (l.paused || l.busy || !tracker.current.ready) return
    const sig = signature()
    if (!sig) return

    // The tracker decides when to shoot: a card has arrived in the frame and stopped moving, once per card.
    const r = tracker.current.update(sig)
    if (r.state === 'waiting') return
    setCardIn(r.state !== 'empty')
    if (r.state === 'empty') setStatus(readyMessage(false))
    else if (r.state === 'capture') capture(sig)
    else {
      const px = Math.round((frameRef.current.x1 - frameRef.current.x0) * (videoRef.current?.videoWidth ?? 0))
      setStatus(px && px < 650 ? `Card in place (the frame is ${px}px wide, which is small). Move the phone closer${cameras.some((c) => /tele/i.test(c.label)) ? ' or pick the Telephoto camera' : ''} for a better read.` : 'Card in place, hold still…')
    }
  }

  function forceScan() {
    const sig = signature()
    if (sig && !loop.current.busy) capture(sig)
  }

  async function capture(sig: FrameSig) {
    const l = loop.current
    const v = videoRef.current
    if (!v) return
    // Cut out the card where it really sits, which can differ a little from where the frame was drawn.
    const where = tracker.current.refine(sig) ?? frameRef.current
    const card = cropBox(v, where)
    if (!card) return
    l.busy = true
    if (isBlank(card)) {
      // The camera frame could not be copied (rather than the card being dark): say so instead of scanning black.
      addReview({ key: ++l.key, thumb: '', note: 'The camera frame came back blank. Tap Stop, then Start again.', candidates: [] })
      l.busy = false
      return
    }
    tracker.current.markCaptured(sig, frameRef.current)
    const key = ++l.key
    const thumb = makeThumb(card)
    const big = makeThumb(card, 420, 0.8)

    try {
      setStatus('Reading card…')
      const scan = await scanFor(gameRef.current, card, undefined, true, vocabRef.current)
      // Also recognise the card by its picture, when this collection is tied to a Pokémon set.
      const img = matcherRef.current?.match(card) ?? null
      const raw =
        scan.rawText + (img ? ` | picture: ${img.best.card.name} #${img.best.card.number} score ${img.best.score.toFixed(2)}, lead ${img.margin.toFixed(2)}` : '')

      let results: CatalogCard[] = []
      let lookupError: unknown = null
      if (scan.name || scan.number) {
        setStatus(`Looking up ${scan.name || 'card'} ${scan.number}…`)
        try {
          results = await adapterFor(gameRef.current).findCards({
            name: scan.name,
            number: scan.number,
            total: scan.total,
            trustName: scan.nameConfident,
            setId: setIdRef.current,
          })
        } catch (e) {
          lookupError = e
        }
      }

      const decision = decide(results, gameRef.current, scan, !!setIdRef.current, img)
      const pick = decision.pick
      if (pick) {
        onAddRef.current(toOwned(pick, collectionRef.current))
        setAdded((a) => [
          { key, name: pick.name, image: pick.image, detail: `${pick.setName} · #${pick.number}`, price: pick.price, card: pick, collectionId: collectionRef.current, scanThumb: thumb },
          ...a,
        ].slice(0, 30))
        beep(880, 110)
        setStatus(`Added ${pick.name}. Swap in the next card.`)
      } else if (lookupError && !decision.candidates.length) {
        addReview({
          key,
          thumb,
          big,
          raw,
          scan,
          note: `${scan.name} ${scan.number}: ${lookupError instanceof Error ? lookupError.message : 'lookup failed'}`,
          candidates: [],
        })
      } else if (!scan.name && !scan.number && !decision.candidates.length) {
        addReview({ key, thumb, big, raw, note: 'Could not read this card. Check the frame sits on the card.', candidates: [] })
      } else {
        addReview({
          key,
          thumb,
          big,
          raw,
          note: scan.name || scan.number ? `Read: ${scan.name || '?'} ${scan.number || '?'}${scan.total ? '/' + scan.total : ''}` : 'Could not read the text. The closest pictures are below.',
          candidates: decision.candidates.slice(0, 6),
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
    setStatus('Needs review. Swap in the next card.')
    loop.current.busy = false
  }

  /** Look a card up again after a network failure, using what was already read from it. */
  async function retry(item: ReviewItem) {
    const scan = item.scan
    if (!scan) return
    setReview((r) => r.map((x) => (x.key === item.key ? { ...x, note: 'Looking up again…' } : x)))
    try {
      const results = await adapterFor(gameRef.current).findCards({
        name: scan.name,
        number: scan.number,
        total: scan.total,
        trustName: scan.nameConfident,
        setId: setIdRef.current,
      })
      const pick = confidentMatch(results, gameRef.current, scan, !!setIdRef.current)
      if (pick) {
        resolve(item, pick)
        beep(880, 110)
      } else {
        setReview((r) =>
          r.map((x) =>
            x.key === item.key
              ? { ...x, scan: undefined, candidates: results.slice(0, 6), note: `Read: ${scan.name || '?'} ${scan.number || '?'}` }
              : x,
          ),
        )
      }
    } catch (e) {
      setReview((r) => r.map((x) => (x.key === item.key ? { ...x, note: e instanceof Error ? e.message : 'Still cannot reach the card database.' } : x)))
    }
  }

  function resolve(item: ReviewItem, card?: CatalogCard) {
    if (card) {
      onAdd(toOwned(card, collectionId))
      setAdded((a) => [
        { key: item.key, name: card.name, image: card.image, detail: `${card.setName} · #${card.number}`, price: card.price, card, collectionId, scanThumb: item.thumb },
        ...a,
      ].slice(0, 30))
    }
    setReview((r) => r.filter((x) => x.key !== item.key))
  }

  // ───────── The green frame: drag to move, drag the corner dot to resize ─────────
  function metrics() {
    const c = boxRef.current!.getBoundingClientRect()
    const v = videoRef.current!
    const scale = Math.min(c.width / v.videoWidth, c.height / v.videoHeight)
    return { vw: v.videoWidth, vh: v.videoHeight, scale }
  }

  function beginDrag(e: React.PointerEvent, mode: 'move' | 'resize') {
    if ((running && !adjusting) || !videoRef.current?.videoWidth) return
    e.preventDefault()
    e.stopPropagation()
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* dragging still works without capture, the finger just can't leave the frame */
    }
    drag.current = { mode, x: e.clientX, y: e.clientY, start: frame }
  }

  function moveDrag(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    const { vw, vh, scale } = metrics()
    const dx = (e.clientX - d.x) / (vw * scale)
    const dy = (e.clientY - d.y) / (vh * scale)
    const s = d.start
    if (d.mode === 'move') {
      const w = s.x1 - s.x0
      const h = s.y1 - s.y0
      const x0 = Math.max(0, Math.min(1 - w, s.x0 + dx))
      const y0 = Math.max(0, Math.min(1 - h, s.y0 + dy))
      setFrame({ x0, y0, x1: x0 + w, y1: y0 + h })
    } else {
      // Keep the frame card-shaped as it grows or shrinks.
      let w = Math.max(0.12, Math.min(1 - s.x0, s.x1 - s.x0 + dx))
      let h = (w * vw) / (vh * CARD_ASPECT)
      if (s.y0 + h > 1) {
        h = 1 - s.y0
        w = (h * vh * CARD_ASPECT) / vw
      }
      setFrame({ x0: s.x0, y0: s.y0, x1: s.x0 + w, y1: s.y0 + h })
    }
  }

  function endDrag() {
    if (!drag.current) return
    drag.current = null
    try {
      localStorage.setItem(FRAME_KEY + (infoRef.current?.label ?? ''), JSON.stringify(frameRef.current))
    } catch {
      /* the frame just won't be remembered */
    }
  }

  function resetFrame() {
    setFrame(DEFAULT_FRAME)
    try {
      localStorage.removeItem(FRAME_KEY + (info?.label ?? ''))
    } catch {
      /* ignore */
    }
  }

  const col = collections.find((c) => c.id === collectionId)
  const colName = col?.name ?? ''
  const setId = col?.setId
  const setIdRef = useRef(setId)
  setIdRef.current = setId
  const game: Game = adapterFor(col?.game).key
  const gameRef = useRef(game)
  gameRef.current = game

  // For a collection tied to one set, match what is read against that set's own card names.
  useEffect(() => {
    vocabRef.current = undefined
    matcherRef.current = null
    setPics({ state: 'none', done: 0, total: 0 })
    if (!setId) {
      setSetReady({ state: 'none', count: 0 })
      return
    }
    let cancelled = false
    setSetReady({ state: 'loading', count: 0 })
    adapterFor(game)
      .getSetCards(setId)
      .then((cards) => {
        if (cancelled) return
        vocabRef.current = [...new Set(cards.map((c) => c.name))]
        setSetReady({ state: cards.length ? 'ready' : 'failed', count: cards.length })
        if (game === 'pokemon' && cards.length) {
          setPics({ state: 'loading', done: 0, total: cards.length })
          SetMatcher.build(setId, cards, (done, total) => {
            if (!cancelled) setPics({ state: 'loading', done, total })
          })
            .then((m) => {
              if (cancelled) return
              matcherRef.current = m
              setPics({ state: m.size ? 'ready' : 'failed', done: m.size, total: cards.length })
            })
            .catch(() => {
              if (!cancelled) setPics({ state: 'failed', done: 0, total: cards.length })
            })
        }
      })
      .catch(() => {
        if (!cancelled) setSetReady({ state: 'failed', count: 0 })
      })
    return () => {
      cancelled = true
    }
  }, [setId, game])

  const video = videoRef.current
  const container = boxRef.current
  const placed = video && container && video.videoWidth ? boxToScreen(frame, container.getBoundingClientRect(), video.videoWidth, video.videoHeight, 'contain') : null

  return (
    <div className="bulk">
      <div className="bulk-cam" ref={boxRef}>
        <video ref={videoRef} playsInline muted onLoadedMetadata={() => redraw((n) => n + 1)} onResize={() => redraw((n) => n + 1)} />
        {placed && (
          <div
            className={`found ${running && !adjusting ? 'live' : 'edit'} ${cardIn ? 'has-card' : ''}`}
            style={{ left: placed.left, top: placed.top, width: placed.width, height: placed.height }}
            onPointerDown={(e) => beginDrag(e, 'move')}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {ZONES[game].map((z) => (
              <span
                key={z.label + z.box.join()}
                className="zone"
                style={{ left: `${z.box[0] * 100}%`, top: `${z.box[1] * 100}%`, width: `${(z.box[2] - z.box[0]) * 100}%`, height: `${(z.box[3] - z.box[1]) * 100}%` }}
              >
                <i>{z.label}</i>
              </span>
            ))}
            {(!running || adjusting) && (
              <span
                className="handle"
                onPointerDown={(e) => beginDrag(e, 'resize')}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              />
            )}
          </div>
        )}
      </div>

      <div className="bulk-panel">
        <div className="bulk-top">
          <button className="link" onClick={() => { stop(); onClose() }}>Close</button>
          <strong>Auto scan → {colName}</strong>
          <span className="count">{added.length} added</span>
        </div>

        {!running && (
          <>
            <ol className="steps">
              <li>Put a card in the mount.</li>
              <li>Drag the green frame onto it. Drag the corner dot to resize. The markers show where the name and number are read.</li>
              <li>Take the card out, then tap Start. The frame is remembered next time.</li>
            </ol>
            {cameras.length > 1 && (
              <label className="field">
                Camera
                <select
                  value={info?.deviceId ?? ''}
                  onChange={(e) => {
                    saveCameraId(e.target.value)
                    setCameraId(e.target.value)
                  }}
                >
                  {cameras.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </label>
            )}
            {info && (
              <p className="hint" style={{ margin: '0 2px 10px' }}>
                {info.label} · picture {info.width}×{info.height}
                {info.width && info.width < 2500 ? '. Small for reading numbers: try the telephoto camera or move the phone closer.' : '.'}
              </p>
            )}
            {info?.zoom && (
              <label className="field">
                Zoom
                <input
                  type="range"
                  min={info.zoom.min}
                  max={info.zoom.max}
                  step={info.zoom.step}
                  value={info.zoom.value}
                  onChange={(e) => {
                    const z = Number(e.target.value)
                    setInfo((cur) => (cur && cur.zoom ? { ...cur, zoom: { ...cur.zoom, value: z } } : cur))
                    if (streamRef.current) applyZoom(streamRef.current, z)
                  }}
                />
              </label>
            )}
            {setReady.state !== 'none' && (
              <p className={setReady.state === 'failed' ? 'error' : 'hint'} style={{ margin: '0 2px 10px' }}>
                {setReady.state === 'ready'
                  ? `✓ All ${setReady.count} cards of ${col?.setName ?? 'this set'} are stored on this phone, so cards are matched instantly, even offline.`
                  : setReady.state === 'loading'
                    ? 'Loading this set\'s cards…'
                    : 'Could not load this set\'s cards. Connect to the internet once and reopen Auto scan.'}
              </p>
            )}
            {pics.state !== 'none' && (
              <p className={pics.state === 'failed' ? 'error' : 'hint'} style={{ margin: '0 2px 10px' }}>
                {pics.state === 'ready'
                  ? '✓ Picture matching is ready: cards are also recognised by their artwork, not just their text.'
                  : pics.state === 'loading'
                    ? `Learning the pictures in this set… ${pics.done}/${pics.total}`
                    : 'Picture matching is not available yet (the card pictures could not be loaded). Text reading still works.'}
              </p>
            )}
            <label className="field">
              Add cards to
              <select value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} · {adapterFor(c.game).label}</option>
                ))}
              </select>
            </label>
          </>
        )}

        <p className={error ? 'error' : 'status'}>{error || status}</p>

        <div className="row">
          {!running ? (
            <>
              <button className="grow" onClick={resetFrame}>Reset frame</button>
              <button className="primary grow" style={{ flex: 2 }} onClick={start} disabled={!!error}>▶ Start (card out)</button>
            </>
          ) : (
            <>
              <button className="grow" onClick={stop}>Stop</button>
              <button className="grow" onClick={forceScan}>Scan now</button>
              <button className={`grow ${adjusting ? 'primary' : ''}`} onClick={toggleAdjust}>{adjusting ? 'Done' : 'Adjust frame'}</button>
              <button className="grow" onClick={relearn} disabled={adjusting}>Re-learn</button>
            </>
          )}
        </div>

        {review.length > 0 && (
          <>
            <h3>Needs review ({review.length})</h3>
            <ul className="results">
              {review.map((item) => (
                <li key={item.key} className="review">
                  {item.thumb ? (
                    <img
                      src={item.thumb}
                      alt="scanned card (tap to enlarge)"
                      className="thumb"
                      onClick={() => setZoomKey(zoomKey === item.key ? null : item.key)}
                    />
                  ) : null}
                  <div className="meta">
                    <span>{item.note}</span>
                    {item.raw && <small className="raw">{item.raw}</small>}
                    {zoomKey === item.key && item.big && <img src={item.big} alt="" className="bigthumb" onClick={() => setZoomKey(null)} />}
                    <div className="cands">
                      {item.candidates.map((c) => (
                        <button key={c.id} onClick={() => resolve(item, c)}>
                          {c.name} · {c.setName} #{c.number}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="row-actions">
                    {item.scan && <button className="primary" onClick={() => retry(item)}>Try again</button>}
                    <button onClick={() => resolve(item)}>Skip</button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {added.length > 0 && (
          <>
            <h3>Recently scanned <small className="muted">(left: camera, right: matched card)</small> <span className="tray-total">{money(added.reduce((s, a) => s + (a.price ?? 0), 0))} total</span></h3>
            <ul className="results">
              {added.map((a) => (
                <li key={a.key} className="added-row">
                  {a.scanThumb && <img src={a.scanThumb} alt="what the camera saw" className="seen" />}
                  <img src={a.image} alt={a.name} />
                  <div className="meta">
                    <strong>{a.name}</strong>
                    <span>{a.detail}</span>
                    <b className="tray-total">{a.price != null ? money(a.price) : 'No price'}</b>
                  </div>
                  <button
                    onClick={() => {
                      onUndo(a.card, a.collectionId)
                      setAdded((list) => list.filter((x) => x.key !== a.key))
                    }}
                  >
                    Undo
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

function makeThumb(card: HTMLCanvasElement, width = 90, quality = 0.7): string {
  const c = document.createElement('canvas')
  c.width = width
  c.height = Math.round((card.height / card.width) * width)
  c.getContext('2d')!.drawImage(card, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', quality)
}
