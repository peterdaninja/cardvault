import { useEffect, useMemo, useRef, useState } from 'react'
import AddCard from './AddCard'
import BulkScan from './BulkScan'
import SetPicker from './SetPicker'
import { withSnapshot } from './lib/history'
import { refreshPrices } from './lib/prices'
import type { TcgSet } from './lib/sets'
import { exportJson, loadState, parseImport, saveState, uid } from './lib/store'
import { toOwned } from './lib/tcg'
import type { AppState, Collection, OwnedCard, TcgCard } from './lib/types'
import CollectionView from './screens/CollectionView'
import Home from './screens/Home'
import Settings from './screens/Settings'
import BottomNav, { type Tab } from './ui/BottomNav'
import { money } from './ui/format'
import { PlusIcon } from './ui/icons'
import './App.css'
import './screens.css'

type PickerState = { mode: 'new'; name: string } | { mode: 'edit'; id: string } | null

const PRICE_REFRESH_MS = 20 * 60 * 60 * 1000

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [tab, setTab] = useState<Tab>('home')
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [bulk, setBulk] = useState(false)
  const [picker, setPicker] = useState<PickerState>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshNote, setRefreshNote] = useState('')
  const latest = useRef<AppState | null>(null)
  latest.current = state

  useEffect(() => {
    loadState().then((loaded) => {
      const next = withSnapshot(loaded) // builds the value history for data saved before it existed
      setState(next)
      if (next !== loaded) saveState(next)
    })
  }, [])

  // Re-price owned cards about once a day, quietly, when the app opens.
  const autoRan = useRef(false)
  useEffect(() => {
    if (!state || autoRan.current) return
    autoRan.current = true
    if (state.cards.length && Date.now() - (state.pricesUpdatedAt ?? 0) > PRICE_REFRESH_MS) runRefresh(false)
  }, [state]) // eslint-disable-line react-hooks/exhaustive-deps

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
    const withHistory = withSnapshot(next)
    setState(withHistory)
    saveState(withHistory)
  }

  /** Functional update for async callers that must not overwrite changes made in the meantime. */
  function updateWith(fn: (s: AppState) => AppState) {
    if (latest.current) update(fn(latest.current))
  }

  async function runRefresh(manual: boolean) {
    const current = latest.current
    if (!current?.cards.length) return
    setRefreshing(true)
    setRefreshNote('')
    try {
      const { cards: priced, failedSets } = await refreshPrices(current.cards)
      updateWith((s) => {
        const byId = new Map(priced.map((c) => [c.id, c.price]))
        return {
          ...s,
          cards: s.cards.map((c) => (byId.has(c.id) ? { ...c, price: byId.get(c.id) ?? c.price } : c)),
          pricesUpdatedAt: failedSets === 0 ? Date.now() : s.pricesUpdatedAt,
        }
      })
      if (manual) {
        setRefreshNote(failedSets ? `${failedSets} set${failedSets === 1 ? '' : 's'} couldn't be reached, try again soon.` : 'Prices are up to date.')
      }
    } finally {
      setRefreshing(false)
    }
  }

  const open = state.collections.find((c) => c.id === openId)
  const detail = state.cards.find((c) => c.id === detailId)

  function newCollection() {
    const name = prompt('Collection name (e.g. Base Set, Charizard, Binder 1)')?.trim()
    if (!name) return
    setTab('collections')
    setPicker({ mode: 'new', name }) // next: optionally limit it to one set
  }

  function applySet(picked: TcgSet | null) {
    if (!picker) return
    const setFields = {
      setId: picked?.id,
      setName: picked?.name,
      setTotal: picked ? (picked.total ?? picked.printedTotal) : undefined,
      setLogo: picked?.logo,
    }
    if (picker.mode === 'new') {
      const id = uid()
      update({ ...state!, collections: [...state!.collections, { id, name: picker.name, createdAt: Date.now(), ...setFields }] })
      setOpenId(id)
    } else {
      patchCollection(picker.id, setFields)
    }
    setPicker(null)
  }

  function patchCollection(id: string, patch: Partial<Collection>) {
    updateWith((s) => ({ ...s, collections: s.collections.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
  }

  function deleteCollection(id: string) {
    if (!confirm('Delete this collection and all its cards?')) return
    update({
      ...state!,
      collections: state!.collections.filter((c) => c.id !== id),
      cards: state!.cards.filter((c) => c.collectionId !== id),
    })
    setOpenId(null)
  }

  function addCard(card: OwnedCard) {
    updateWith((s) => {
      // Same card already in this collection? Bump quantity instead of duplicating.
      const dupe = s.cards.find((c) => c.collectionId === card.collectionId && c.cardId === card.cardId)
      return dupe
        ? { ...s, cards: s.cards.map((c) => (c.id === dupe.id ? { ...c, qty: c.qty + 1 } : c)) }
        : { ...s, cards: [...s.cards, card] }
    })
  }

  function changeQty(id: string, delta: number) {
    update({
      ...state!,
      cards: state!.cards.map((c) => (c.id === id ? { ...c, qty: c.qty + delta } : c)).filter((c) => c.qty > 0),
    })
    if (delta < 0 && state!.cards.find((c) => c.id === id)?.qty === 1) setDetailId(null)
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
      if (confirm(`Replace current data with ${data.cards.length} cards from this backup?`)) {
        update({ ...data, history: data.history })
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Import failed')
    }
  }

  function startScan() {
    if (!state!.collections.length) newCollection()
    else setAdding(true)
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
        <BulkScan collections={state.collections} defaultCollectionId={defaultCol} onAdd={addCard} onClose={() => setBulk(false)} />
      )}
      {picker && (
        <SetPicker
          title={picker.mode === 'new' ? 'Limit to a set?' : 'Collection set'}
          currentId={picker.mode === 'edit' ? state.collections.find((c) => c.id === picker.id)?.setId : undefined}
          onPick={applySet}
          onCancel={() => {
            // Cancelling while creating still creates the collection, just without a set.
            if (picker.mode === 'new') applySet(null)
            else setPicker(null)
          }}
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

  let body: React.ReactNode
  if (tab === 'settings') {
    body = (
      <Settings
        state={state}
        refreshing={refreshing}
        refreshNote={refreshNote}
        onRefresh={() => runRefresh(true)}
        onExport={() => exportJson(state)}
        onImport={onImport}
      />
    )
  } else if (tab === 'collections' && open) {
    body = (
      <CollectionView
        key={open.id}
        collection={open}
        owned={state.cards.filter((c) => c.collectionId === open.id)}
        onBack={() => setOpenId(null)}
        onChangeSet={() => setPicker({ mode: 'edit', id: open.id })}
        onCard={setDetailId}
        onQty={changeQty}
        onCollect={(c: TcgCard) => addCard(toOwned(c, open.id))}
        onPatch={(p) => patchCollection(open.id, p)}
        onDelete={() => deleteCollection(open.id)}
      />
    )
  } else if (tab === 'collections') {
    body = (
      <>
        <header className="topbar">
          <div>
            <p className="eyebrow">Your sets &amp; binders</p>
            <h1>Collections</h1>
          </div>
          <button className="icon-btn accent" onClick={newCollection} aria-label="New collection"><PlusIcon /></button>
        </header>
        {state.collections.length === 0 ? (
          <div className="empty">
            <b>No collections yet</b>
            Tap + to make one, like "Base Set" or "My Binder".
          </div>
        ) : (
          <div className="tiles">
            {state.collections.map((c) => {
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
          </div>
        )}
      </>
    )
  } else {
    body = <Home state={state} onCard={setDetailId} onStart={newCollection} />
  }

  return (
    <div className="app">
      {body}
      <BottomNav
        tab={tab}
        onTab={(t) => {
          if (t === tab && t === 'collections') setOpenId(null)
          setTab(t)
        }}
        onScan={startScan}
      />
      {sheets}
    </div>
  )
}
