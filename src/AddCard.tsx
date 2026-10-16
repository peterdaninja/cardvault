import { useRef, useState } from 'react'
import Camera from './Camera'
import { fileToCanvas, scanCanvas } from './lib/ocr'
import { findCards, marketPrice } from './lib/tcg'
import type { Collection, OwnedCard, TcgCard } from './lib/types'
import { uid } from './lib/store'

interface Props {
  collections: Collection[]
  defaultCollectionId: string
  onAdd: (card: OwnedCard) => void
  onClose: () => void
  onBulk: () => void
}

export default function AddCard({ collections, defaultCollectionId, onAdd, onClose, onBulk }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [collectionId, setCollectionId] = useState(defaultCollectionId)
  const collection = collections.find((c) => c.id === collectionId)
  const [name, setName] = useState('')
  const [number, setNumber] = useState('')
  const [total, setTotal] = useState('')
  const [camera, setCamera] = useState(false)
  const [lastRead, setLastRead] = useState('')
  const [trustName, setTrustName] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [results, setResults] = useState<TcgCard[]>([])
  const [added, setAdded] = useState<string[]>([])

  async function search(n = name, num = number, tot = total, trust = trustName) {
    setError('')
    setBusy('Searching…')
    try {
      const found = await findCards(n, num, tot, trust, collection?.setId)
      setResults(found)
      if (!found.length) setError(
          collection?.setName
            ? `No match in ${collection.setName}. Edit the name or number, or change the collection's set.`
            : 'No matches. Edit the name or number and search again.',
        )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setBusy('')
    }
  }

  async function scan(getCanvas: () => Promise<HTMLCanvasElement> | HTMLCanvasElement) {
    setError('')
    setResults([])
    setLastRead('')
    try {
      setBusy('Preparing photo…')
      const scanned = await scanCanvas(await getCanvas(), setBusy)
      setName(scanned.name)
      setNumber(scanned.number)
      setTotal(scanned.total)
      setTrustName(scanned.nameConfident)
      setLastRead(scanned.rawText)
      if (!scanned.name && !scanned.number) {
        setBusy('')
        setError('Could not read the card. Try again with less glare, or type the name.')
        return
      }
      await search(scanned.name, scanned.number, scanned.total, scanned.nameConfident)
    } catch (e) {
      setBusy('')
      setError(e instanceof Error ? e.message : 'Scan failed')
    }
  }

  function onPhoto(file: File | undefined) {
    if (file) scan(() => fileToCanvas(file))
  }

  function add(c: TcgCard) {
    onAdd({
      id: uid(),
      collectionId,
      cardId: c.id,
      name: c.name,
      setName: c.set.name,
      number: c.number,
      rarity: c.rarity ?? '',
      image: c.images.small,
      price: marketPrice(c),
      qty: 1,
      addedAt: Date.now(),
    })
    setAdded((a) => [...a, c.id])
  }

  return (
    <div className="sheet">
      {camera && (
        <Camera
          onCancel={() => setCamera(false)}
          onCapture={(c) => {
            setCamera(false)
            scan(() => c)
          }}
        />
      )}
      <header className="bar">
        <button className="link" onClick={onClose}>Done</button>
        <h2>Add card</h2>
        <span />
      </header>

      <div className="pad">
        <label className="field">
          Collection
          <select value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
                    hidden
          onChange={(e) => {
            onPhoto(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <button className="primary big" disabled={!!busy} onClick={() => setCamera(true)}>
          📷 Scan a card
        </button>
        <button className="link" disabled={!!busy} onClick={() => fileRef.current?.click()}>
          Choose photo instead
        </button>
        <button className="big" onClick={onBulk}>⚡ Auto scan (hands-free, for a phone mount)</button>
        <p className="hint">
          {collection?.setName
            ? `Searching only in ${collection.setName}.`
            : 'Fill the frame with one card, flat and well lit.'}
        </p>

        <div className="row">
          <label className="field grow">
            Name
            <input value={name} onChange={(e) => {
                setName(e.target.value)
                setTrustName(true)
              }} placeholder="Pikachu" />
          </label>
          <label className="field num">
            No.
            <input
              value={number}
              inputMode="numeric"
              onChange={(e) => {
                setNumber(e.target.value)
                setTotal('')
              }}
              placeholder="e.g. 120"
            />
          </label>
        </div>
        <button disabled={!!busy || (!name && !number)} onClick={() => search()}>Search</button>

        {busy && <p className="status">{busy}</p>}
        {lastRead && <p className="hint">Read: {lastRead}</p>}
        {error && <p className="error">{error}</p>}

        <ul className="results">
          {results.map((c) => {
            const price = marketPrice(c)
            return (
              <li key={c.id}>
                <img src={c.images.small} alt={c.name} loading="lazy" />
                <div className="meta">
                  <strong>{c.name}</strong>
                  <span>{c.set.name} · #{c.number}</span>
                  <span>{c.rarity ?? ''}</span>
                  <span>{price != null ? `$${price.toFixed(2)}` : 'No price'}</span>
                </div>
                <button className="primary" onClick={() => add(c)}>
                  {added.includes(c.id) ? 'Add another' : 'Add'}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
