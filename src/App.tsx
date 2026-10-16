import { useEffect, useMemo, useRef, useState } from 'react'
import AddCard from './AddCard'
import { exportJson, loadState, parseImport, saveState, uid } from './lib/store'
import type { AppState, OwnedCard } from './lib/types'
import './App.css'

const money = (n: number) => `$${n.toFixed(2)}`

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState('')
  const importRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadState().then(setState)
  }, [])

  const totals = useMemo(() => {
    const byCol = new Map<string, { count: number; value: number }>()
    for (const c of state?.cards ?? []) {
      const t = byCol.get(c.collectionId) ?? { count: 0, value: 0 }
      t.count += c.qty
      t.value += (c.price ?? 0) * c.qty
      byCol.set(c.collectionId, t)
    }
    return byCol
  }, [state])

  if (!state) return <div className="pad">Loading…</div>

  function update(next: AppState) {
    setState(next)
    saveState(next)
  }

  const open = state.collections.find((c) => c.id === openId)

  function newCollection() {
    const name = prompt('Collection name (e.g. Base Set, Charizard, Binder 1)')?.trim()
    if (!name) return
    update({ ...state!, collections: [...state!.collections, { id: uid(), name, createdAt: Date.now() }] })
  }

  function deleteCollection(id: string) {
    if (!confirm('Delete this collection and all its cards?')) return
    update({
      collections: state!.collections.filter((c) => c.id !== id),
      cards: state!.cards.filter((c) => c.collectionId !== id),
    })
    setOpenId(null)
  }

  function addCard(card: OwnedCard) {
    // Same card already in this collection? Bump quantity instead of duplicating.
    const dupe = state!.cards.find((c) => c.collectionId === card.collectionId && c.cardId === card.cardId)
    if (dupe) {
      update({ ...state!, cards: state!.cards.map((c) => (c.id === dupe.id ? { ...c, qty: c.qty + 1 } : c)) })
    } else {
      update({ ...state!, cards: [...state!.cards, card] })
    }
  }

  function changeQty(id: string, delta: number) {
    const cards = state!.cards
      .map((c) => (c.id === id ? { ...c, qty: c.qty + delta } : c))
      .filter((c) => c.qty > 0)
    update({ ...state!, cards })
  }

  async function onImport(file: File | undefined) {
    if (!file) return
    try {
      const data = await parseImport(file)
      if (confirm(`Replace current data with ${data.cards.length} cards from this backup?`)) update(data)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Import failed')
    }
  }

  const defaultCol = openId ?? state.collections[0]?.id ?? ''

  const addSheet =
    adding && state.collections.length ? (
      <AddCard
        collections={state.collections}
        defaultCollectionId={defaultCol}
        onAdd={addCard}
        onClose={() => setAdding(false)}
      />
    ) : null

  if (open) {
    const q = filter.toLowerCase()
    const cards = state.cards
      .filter((c) => c.collectionId === open.id)
      .filter((c) => !q || `${c.name} ${c.setName}`.toLowerCase().includes(q))
      .sort((a, b) => a.setName.localeCompare(b.setName) || a.name.localeCompare(b.name))
    const t = totals.get(open.id)
    return (
      <div className="app">
        <header className="bar">
          <button className="link" onClick={() => { setOpenId(null); setFilter('') }}>‹ Back</button>
          <h2>{open.name}</h2>
          <button className="link danger" onClick={() => deleteCollection(open.id)}>Delete</button>
        </header>
        <div className="pad">
          <p className="summary">{t?.count ?? 0} cards · {money(t?.value ?? 0)}</p>
          <input className="search" placeholder="Filter by name or set" value={filter} onChange={(e) => setFilter(e.target.value)} />
          {cards.length === 0 && <p className="hint">No cards yet. Tap + to scan one.</p>}
          <div className="grid">
            {cards.map((c) => (
              <div className="card" key={c.id}>
                <img src={c.image} alt={c.name} loading="lazy" />
                <div className="cap">
                  <strong>{c.name}</strong>
                  <span>{c.setName} · #{c.number}</span>
                  <span>{c.price != null ? money(c.price) : '—'}</span>
                </div>
                <div className="qty">
                  <button onClick={() => changeQty(c.id, -1)}>−</button>
                  <span>×{c.qty}</span>
                  <button onClick={() => changeQty(c.id, 1)}>+</button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <button className="fab" onClick={() => setAdding(true)} aria-label="Add card">+</button>
        {addSheet}
      </div>
    )
  }

  const totalCount = [...totals.values()].reduce((s, t) => s + t.count, 0)
  const totalValue = [...totals.values()].reduce((s, t) => s + t.value, 0)

  return (
    <div className="app">
      <header className="bar">
        <span />
        <h2>CardVault</h2>
        <button className="link" onClick={newCollection}>New</button>
      </header>
      <div className="pad">
        <p className="summary">{totalCount} cards · {money(totalValue)} total</p>
        {state.collections.length === 0 && (
          <p className="hint">Create a collection first (tap New), then scan cards into it.</p>
        )}
        <ul className="collections">
          {state.collections.map((c) => {
            const t = totals.get(c.id)
            const thumbs = state.cards.filter((x) => x.collectionId === c.id).slice(0, 3)
            return (
              <li key={c.id} onClick={() => setOpenId(c.id)}>
                <div className="thumbs">{thumbs.map((x) => <img key={x.id} src={x.image} alt="" />)}</div>
                <div>
                  <strong>{c.name}</strong>
                  <span>{t?.count ?? 0} cards · {money(t?.value ?? 0)}</span>
                </div>
              </li>
            )
          })}
        </ul>
        <div className="row backup">
          <button onClick={() => exportJson(state)}>Export backup</button>
          <button onClick={() => importRef.current?.click()}>Import backup</button>
          <input ref={importRef} type="file" accept="application/json" hidden
            onChange={(e) => { onImport(e.target.files?.[0]); e.target.value = '' }} />
        </div>
      </div>
      {state.collections.length > 0 && (
        <button className="fab" onClick={() => setAdding(true)} aria-label="Add card">+</button>
      )}
      {addSheet}
    </div>
  )
}
