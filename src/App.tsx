import { useEffect, useMemo, useRef, useState } from 'react'
import AddCard from './AddCard'
import BulkScan from './BulkScan'
import SetPicker from './SetPicker'
import type { TcgSet } from './lib/sets'
import { exportJson, loadState, parseImport, saveState, uid } from './lib/store'
import type { AppState, Collection, OwnedCard } from './lib/types'
import './App.css'

declare const __BUILD__: string

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type PickerState = { mode: 'new'; name: string } | { mode: 'edit'; id: string } | null

function Pokeball() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="4" />
      <path d="M4 32h56" stroke="currentColor" strokeWidth="4" />
      <circle cx="32" cy="32" r="9" fill="var(--bg)" stroke="currentColor" strokeWidth="4" />
    </svg>
  )
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [bulk, setBulk] = useState(false)
  const [picker, setPicker] = useState<PickerState>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const importRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadState().then(setState)
  }, [])

  // Per-collection card count, unique cards and value.
  const totals = useMemo(() => {
    const byCol = new Map<string, { count: number; value: number; unique: Set<string> }>()
    for (const c of state?.cards ?? []) {
      const t = byCol.get(c.collectionId) ?? { count: 0, value: 0, unique: new Set<string>() }
      t.count += c.qty
      t.value += (c.price ?? 0) * c.qty
      t.unique.add(c.cardId)
      byCol.set(c.collectionId, t)
    }
    return byCol
  }, [state])

  if (!state) return <div className="app"><p className="status">Loading…</p></div>

  function update(next: AppState) {
    setState(next)
    saveState(next)
  }

  const open = state.collections.find((c) => c.id === openId)
  const detail = state.cards.find((c) => c.id === detailId)

  function newCollection() {
    const name = prompt('Collection name (e.g. Base Set, Charizard, Binder 1)')?.trim()
    if (!name) return
    setPicker({ mode: 'new', name }) // next: optionally limit it to one set
  }

  function applySet(picked: TcgSet | null) {
    if (!picker) return
    const setFields = { setId: picked?.id, setName: picked?.name, setTotal: picked?.printedTotal }
    if (picker.mode === 'new') {
      update({
        ...state!,
        collections: [...state!.collections, { id: uid(), name: picker.name, createdAt: Date.now(), ...setFields }],
      })
    } else {
      update({
        ...state!,
        collections: state!.collections.map((c) => (c.id === picker.id ? { ...c, ...setFields } : c)),
      })
    }
    setPicker(null)
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
    if (!cards.some((c) => c.id === id)) setDetailId(null)
  }

  function removeCard(id: string) {
    if (!confirm('Remove this card from the collection?')) return
    update({ ...state!, cards: state!.cards.filter((c) => c.id !== id) })
    setDetailId(null)
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

  const sheets = (
    <>
      {adding && state.collections.length > 0 && (
        <AddCard
          collections={state.collections}
          defaultCollectionId={defaultCol}
          onAdd={addCard}
          onClose={() => setAdding(false)}
          onBulk={() => {
            setAdding(false)
            setBulk(true)
          }}
        />
      )}
      {bulk && state.collections.length > 0 && (
        <BulkScan
          collections={state.collections}
          defaultCollectionId={defaultCol}
          onAdd={addCard}
          onClose={() => setBulk(false)}
        />
      )}
      {picker && (
        <SetPicker
          title={picker.mode === 'new' ? 'Limit to a set?' : 'Collection set'}
          currentId={picker.mode === 'edit' ? state.collections.find((c) => c.id === picker.id)?.setId : undefined}
          onPick={applySet}
          onCancel={() => setPicker(null)}
        />
      )}
      {detail && (
        <div className="backdrop" onClick={() => setDetailId(null)}>
          <div className="detail" onClick={(e) => e.stopPropagation()}>
            <div className="grab" />
            <img src={detail.image} alt={detail.name} />
            <h2>{detail.name}</h2>
            <p className="meta-line">
              {detail.setName} · #{detail.number}
              {detail.rarity ? ` · ${detail.rarity}` : ''}
            </p>
            <p className="price-big">{detail.price != null ? money(detail.price) : 'No price'}</p>
            <div className="stepper">
              <button onClick={() => changeQty(detail.id, -1)} aria-label="Fewer">−</button>
              <b>×{detail.qty}</b>
              <button onClick={() => changeQty(detail.id, 1)} aria-label="More">+</button>
            </div>
            <button className="big ghost" onClick={() => setDetailId(null)}>Done</button>
            <button className="danger-link" style={{ width: '100%' }} onClick={() => removeCard(detail.id)}>
              Remove from collection
            </button>
          </div>
        </div>
      )}
    </>
  )

  const addButton = state.collections.length > 0 && (
    <button className="fab" onClick={() => setAdding(true)}>
      <span style={{ fontSize: 22, lineHeight: 1 }}>＋</span> Add cards
    </button>
  )

  if (open) {
    const q = filter.trim().toLowerCase()
    const cards = state.cards
      .filter((c) => c.collectionId === open.id)
      .filter((c) => !q || `${c.name} ${c.setName}`.toLowerCase().includes(q))
      .sort((a, b) => a.setName.localeCompare(b.setName) || a.name.localeCompare(b.name))
    const t = totals.get(open.id)
    const unique = t?.unique.size ?? 0
    const pct = open.setTotal ? Math.min(100, Math.round((unique / open.setTotal) * 100)) : 0

    return (
      <div className="app">
        <header className="topbar slim">
          <button className="icon-btn" onClick={() => { setOpenId(null); setFilter('') }} aria-label="Back">‹</button>
          <h1>{open.name}</h1>
          <span style={{ width: 44 }} />
        </header>

        <div style={{ textAlign: 'center' }}>
          <button className="setpill" onClick={() => setPicker({ mode: 'edit', id: open.id })}>
            {open.setName ?? 'Any set'} <small>Change ›</small>
          </button>
        </div>

        <div className="stats">
          <div className="stat"><b>{t?.count ?? 0}</b><span>Cards</span></div>
          <div className="stat"><b>{unique}</b><span>Unique</span></div>
          <div className="stat value"><b>{money(t?.value ?? 0)}</b><span>Value</span></div>
        </div>

        {open.setTotal ? (
          <div className="progress-row">
            <div className="progress"><i style={{ width: `${pct}%` }} /></div>
            <span>{unique}/{open.setTotal} · {pct}%</span>
          </div>
        ) : null}

        {state.cards.some((c) => c.collectionId === open.id) && (
          <input
            className="search"
            placeholder="Search this collection"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        )}

        {cards.length === 0 ? (
          <div className="empty">
            <Pokeball />
            <b>{filter ? 'No matches' : 'No cards yet'}</b>
            {filter ? 'Try a different search.' : 'Tap Add cards to scan your first one.'}
          </div>
        ) : (
          <div className="grid">
            {cards.map((c) => (
              <button className="ctile" key={c.id} onClick={() => setDetailId(c.id)}>
                <img src={c.image} alt={c.name} loading="lazy" />
                {c.price != null && <span className="price">{money(c.price)}</span>}
                {c.qty > 1 && <span className="qty">×{c.qty}</span>}
                <span className="name">{c.name}</span>
                <span className="num">#{c.number}</span>
              </button>
            ))}
          </div>
        )}

        <div className="footer">
          <button className="danger-link" onClick={() => deleteCollection(open.id)}>Delete collection</button>
        </div>
        {addButton}
        {sheets}
      </div>
    )
  }

  const totalCount = [...totals.values()].reduce((s, t) => s + t.count, 0)
  const totalValue = [...totals.values()].reduce((s, t) => s + t.value, 0)
  const totalUnique = [...totals.values()].reduce((s, t) => s + t.unique.size, 0)

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">Pokémon TCG</p>
          <h1>CardVault</h1>
        </div>
        <button className="icon-btn accent" onClick={newCollection} aria-label="New collection">＋</button>
      </header>

      <div className="stats">
        <div className="stat"><b>{totalCount}</b><span>Cards</span></div>
        <div className="stat"><b>{totalUnique}</b><span>Unique</span></div>
        <div className="stat value"><b>{money(totalValue)}</b><span>Value</span></div>
      </div>

      <h2 className="section">Collections</h2>
      {state.collections.length === 0 ? (
        <div className="empty">
          <Pokeball />
          <b>Start your first collection</b>
          Tap ＋ to create one, then scan cards straight into it.
        </div>
      ) : (
        <div className="tiles">
          {state.collections.map((c: Collection) => {
            const t = totals.get(c.id)
            const thumbs = state.cards.filter((x) => x.collectionId === c.id).slice(0, 3)
            const unique = t?.unique.size ?? 0
            const pct = c.setTotal ? Math.min(100, Math.round((unique / c.setTotal) * 100)) : 0
            return (
              <button className="tile" key={c.id} onClick={() => setOpenId(c.id)}>
                <div className="fan">
                  {thumbs.length ? thumbs.map((x) => <img key={x.id} src={x.image} alt="" />) : <div className="ghost">＋</div>}
                </div>
                <strong>{c.name}</strong>
                <span className="sub">{t?.count ?? 0} cards{c.setName ? ` · ${c.setName}` : ''}</span>
                <span className="sub gold">{money(t?.value ?? 0)}</span>
                {c.setTotal ? (
                  <>
                    <div className="progress"><i style={{ width: `${pct}%` }} /></div>
                    <span className="sub">{unique}/{c.setTotal} · {pct}%</span>
                  </>
                ) : null}
              </button>
            )
          })}
          <button className="tile new" onClick={newCollection}>＋ New collection</button>
        </div>
      )}

      <div className="footer">
        <div className="row">
          <button className="ghost" onClick={() => exportJson(state)}>Export backup</button>
          <button className="ghost" onClick={() => importRef.current?.click()}>Import backup</button>
          <input
            ref={importRef}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => {
              onImport(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>
        <small>Version {__BUILD__} UTC</small>
      </div>

      {addButton}
      {sheets}
    </div>
  )
}
