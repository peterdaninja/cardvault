import { useRef, useState } from 'react'
import Camera from './Camera'
import { toOwned, type CatalogCard } from './lib/catalog'
import { adapterFor } from './lib/games'
import { fileToCanvas } from './lib/ocr'
import { scanFor } from './lib/scan'
import type { Collection, OwnedCard } from './lib/types'
import { money } from './ui/format'

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
  const adapter = adapterFor(collection?.game)
  const [name, setName] = useState('')
  const [number, setNumber] = useState('')
  const [total, setTotal] = useState('')
  const [camera, setCamera] = useState(false)
  const [lastRead, setLastRead] = useState('')
  const [trustName, setTrustName] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [results, setResults] = useState<CatalogCard[]>([])
  const [added, setAdded] = useState<string[]>([])

  function pickCollection(id: string) {
    setCollectionId(id)
    // A different game means different numbering and results, so start the search over.
    setResults([])
    setError('')
    setLastRead('')
  }

  async function search(n = name, num = number, tot = total, trust = trustName) {
    setError('')
    setBusy('Searching…')
    try {
      const found = await adapter.findCards({ name: n, number: num, total: tot, trustName: trust, setId: collection?.setId })
      setResults(found)
      if (!found.length) {
        setError(
          collection?.setName
            ? `No match in ${collection.setName}. Edit the name or ${adapter.numberLabel.toLowerCase()}, or change the collection's set.`
            : `No matches. Edit the name or ${adapter.numberLabel.toLowerCase()} and search again.`,
        )
      }
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
      const scanned = await scanFor(adapter.key, await getCanvas(), setBusy)
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

  function add(c: CatalogCard) {
    onAdd(toOwned(c, collectionId))
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
          <select value={collectionId} onChange={(e) => pickCollection(e.target.value)}>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>{c.name} · {adapterFor(c.game).label}</option>
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
        <div className="row" style={{ marginTop: 10 }}>
          <button className="grow" disabled={!!busy} onClick={() => fileRef.current?.click()}>
            🖼 Choose photo
          </button>
          <button className="grow" onClick={onBulk}>⚡ Auto scan</button>
        </div>
        <p className="hint">
          {collection?.setName
            ? `Searching only in ${collection.setName}.`
            : 'Fill the frame with one card, flat and well lit.'}
        </p>

        <div className="row">
          <label className="field grow">
            Name
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setTrustName(true)
              }}
              placeholder={adapter.key === 'yugioh' ? 'Dark Magician' : 'Pikachu'}
            />
          </label>
          <label className={`field ${adapter.key === 'yugioh' ? 'code' : 'num'}`}>
            {adapter.numberLabel}
            <input
              value={number}
              inputMode={adapter.key === 'yugioh' ? 'text' : 'numeric'}
              autoCapitalize="characters"
              onChange={(e) => {
                setNumber(e.target.value)
                setTotal('')
              }}
              placeholder={adapter.numberPlaceholder}
            />
          </label>
        </div>
        <button disabled={!!busy || (!name && !number)} onClick={() => search()}>Search</button>

        {busy && <p className="status">{busy}</p>}
        {lastRead && <p className="hint">Read: {lastRead}</p>}
        {error && <p className="error">{error}</p>}

        <ul className="results">
          {results.map((c) => (
            <li key={`${c.id}-${c.setName}`}>
              <img src={c.image} alt={c.name} loading="lazy" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
              <div className="meta">
                <strong>{c.name}</strong>
                <span>{c.setName} · #{c.number}</span>
                <span>{c.rarity}</span>
                <span>{c.price != null ? money(c.price) : 'No price'}</span>
              </div>
              <button className="primary" onClick={() => add(c)}>
                {added.includes(c.id) ? 'Add another' : 'Add'}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
