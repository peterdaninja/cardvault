import { useRef, useState } from 'react'
import { scanCard } from './lib/ocr'
import { findCards, marketPrice } from './lib/tcg'
import type { Collection, OwnedCard, TcgCard } from './lib/types'
import { uid } from './lib/store'

interface Props {
  collections: Collection[]
  defaultCollectionId: string
  onAdd: (card: OwnedCard) => void
  onClose: () => void
}

export default function AddCard({ collections, defaultCollectionId, onAdd, onClose }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [collectionId, setCollectionId] = useState(defaultCollectionId)
  const [name, setName] = useState('')
  const [number, setNumber] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [results, setResults] = useState<TcgCard[]>([])
  const [added, setAdded] = useState<string[]>([])

  async function search(n = name, num = number) {
    setError('')
    setBusy('Searching…')
    try {
      const found = await findCards(n, num)
      setResults(found)
      if (!found.length) setError('No matches. Edit the name or number and search again.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setBusy('')
    }
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return
    setError('')
    setResults([])
    try {
      const scan = await scanCard(file, setBusy)
      setName(scan.name)
      setNumber(scan.number)
      if (!scan.name && !scan.number) {
        setBusy('')
        setError('Could not read the card. Try a brighter, flatter photo, or type the name.')
        return
      }
      await search(scan.name, scan.number)
    } catch (e) {
      setBusy('')
      setError(e instanceof Error ? e.message : 'Scan failed')
    }
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
          capture="environment"
          hidden
          onChange={(e) => {
            onPhoto(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <button className="primary big" disabled={!!busy} onClick={() => fileRef.current?.click()}>
          📷 Scan a card
        </button>
        <p className="hint">Fill the frame with one card, flat and well lit.</p>

        <div className="row">
          <label className="field grow">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Pikachu" />
          </label>
          <label className="field num">
            No.
            <input
              value={number}
              inputMode="numeric"
              onChange={(e) => setNumber(e.target.value)}
              placeholder="25"
            />
          </label>
        </div>
        <button disabled={!!busy || (!name && !number)} onClick={() => search()}>Search</button>

        {busy && <p className="status">{busy}</p>}
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
