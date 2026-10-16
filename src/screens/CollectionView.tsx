import { useEffect, useMemo, useState } from 'react'
import { getSetCards } from '../lib/setcards'
import { getSets } from '../lib/sets'
import { marketPrice } from '../lib/tcg'
import type { Collection, OwnedCard, TcgCard } from '../lib/types'
import { money } from '../ui/format'
import { ChevronLeft, SearchIcon } from '../ui/icons'

interface Props {
  collection: Collection
  owned: OwnedCard[] // cards owned in this collection
  onBack: () => void
  onChangeSet: () => void
  onCard: (id: string) => void
  onQty: (id: string, delta: number) => void
  onCollect: (card: TcgCard) => void
  onPatch: (patch: Partial<Collection>) => void
  onDelete: () => void
}

interface Item {
  key: string
  name: string
  number: string
  rarity: string
  image: string
  price: number | null
  owned?: OwnedCard
  tcg?: TcgCard
}

type View = 'all' | 'owned' | 'missing'
type Sort = 'number' | 'value'

export default function CollectionView({ collection, owned, onBack, onChangeSet, onCard, onQty, onCollect, onPatch, onDelete }: Props) {
  const [setCards, setSetCards] = useState<TcgCard[] | null>(null)
  const [error, setError] = useState('')
  const [view, setView] = useState<View>('all')
  const [sort, setSort] = useState<Sort>('number')
  const [rarity, setRarity] = useState('')
  const [q, setQ] = useState('')
  const setId = collection.setId

  function load() {
    if (!setId) return
    setError('')
    setSetCards(null)
    getSetCards(setId).then(setSetCards).catch((e) => setError(e instanceof Error ? e.message : 'Could not load this set'))
  }
  useEffect(load, [setId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Collections made before logos existed pick up the set logo and full card count here.
  useEffect(() => {
    if (!setId || (collection.setLogo && collection.setTotal)) return
    getSets()
      .then((sets) => {
        const s = sets.find((x) => x.id === setId)
        if (s) onPatch({ setLogo: s.logo, setTotal: s.total ?? s.printedTotal })
      })
      .catch(() => {})
  }, [setId]) // eslint-disable-line react-hooks/exhaustive-deps

  const ownedByCard = useMemo(() => new Map(owned.map((c) => [c.cardId, c])), [owned])

  const items: Item[] = useMemo(() => {
    if (setId) {
      return (setCards ?? []).map((c) => ({
        key: c.id,
        name: c.name,
        number: c.number,
        rarity: c.rarity ?? '',
        image: c.images.small,
        price: marketPrice(c),
        owned: ownedByCard.get(c.id),
        tcg: c,
      }))
    }
    return [...owned]
      .sort((a, b) => a.setName.localeCompare(b.setName) || a.name.localeCompare(b.name))
      .map((c) => ({ key: c.id, name: c.name, number: c.number, rarity: c.rarity, image: c.image, price: c.price, owned: c }))
  }, [setId, setCards, owned, ownedByCard])

  const rarities = useMemo(() => [...new Set(items.map((i) => i.rarity).filter(Boolean))].sort(), [items])

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    let list = items.filter((i) => {
      if (view === 'owned' && !i.owned) return false
      if (view === 'missing' && i.owned) return false
      if (rarity && i.rarity !== rarity) return false
      return !t || `${i.name} ${i.number}`.toLowerCase().includes(t)
    })
    if (sort === 'value') list = [...list].sort((a, b) => (b.price ?? -1) - (a.price ?? -1))
    return list
  }, [items, view, rarity, q, sort])

  const uniqueOwned = ownedByCard.size
  const totalCards = setCards?.length || collection.setTotal || 0
  const pct = totalCards ? Math.min(100, Math.round((uniqueOwned / totalCards) * 100)) : 0
  const value = owned.reduce((s, c) => s + (c.price ?? 0) * c.qty, 0)
  const release = setCards?.[0]?.set.releaseDate

  return (
    <>
      <div className="cv-top">
        <button className="icon-btn" onClick={onBack} aria-label="Back"><ChevronLeft /></button>
        <button className="setpill" onClick={onChangeSet}>{collection.setName ?? 'Any set'} <small>Change ›</small></button>
      </div>

      <header className="cv-head">
        {collection.setLogo && <img className="setlogo" src={collection.setLogo} alt={collection.setName} />}
        <h1>{collection.name}</h1>
        <p className="cv-sub">
          {setId ? (
            <>
              <b>{uniqueOwned}</b> of {totalCards || '…'} cards
              {release && <> · {new Date(release.replaceAll('/', '-')).toLocaleDateString('en-US')} release</>}
            </>
          ) : (
            <><b>{owned.reduce((s, c) => s + c.qty, 0)}</b> cards</>
          )}
          {' · '}
          <b className="gold">{money(value)}</b>
        </p>
      </header>

      {setId && totalCards > 0 && (
        <div className="pbar" role="progressbar" aria-valuenow={pct}>
          <i style={{ width: `${Math.max(pct, 2)}%` }} />
          <span>{pct}% complete</span>
        </div>
      )}

      <div className="searchbox">
        <SearchIcon />
        <input
          placeholder={setId ? `Search ${collection.setName ?? 'set'} cards` : 'Search this collection'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="filters">
        {setId && (
          <div className="seg" role="tablist">
            {(['all', 'owned', 'missing'] as View[]).map((v) => (
              <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
                {v === 'all' ? 'All' : v === 'owned' ? 'Owned' : 'Missing'}
              </button>
            ))}
          </div>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          <option value="number">Number</option>
          <option value="value">Value (high to low)</option>
        </select>
        {rarities.length > 1 && (
          <select value={rarity} onChange={(e) => setRarity(e.target.value)} aria-label="Rarity">
            <option value="">All rarities</option>
            {rarities.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        )}
      </div>

      {setId && !setCards && !error && <p className="status">Loading the full set…</p>}
      {error && (
        <p className="error">{error} <button onClick={load}>Retry</button></p>
      )}

      {shown.length === 0 && (setCards || !setId) ? (
        <div className="empty">
          <b>{items.length === 0 ? 'No cards yet' : 'Nothing matches'}</b>
          {items.length === 0 ? 'Tap the scan button below to add your first card.' : 'Try a different filter.'}
        </div>
      ) : (
        <div className="sgrid">
          {shown.map((i) => (
            <div className={`stile ${i.owned ? '' : 'missing'}`} key={i.key}>
              <button className="simg" disabled={!i.owned} onClick={() => i.owned && onCard(i.owned.id)}>
                <img src={i.image} alt={i.name} loading="lazy" />
              </button>
              {i.owned ? (
                <div className="act owned">
                  <span>{i.owned.qty} owned</span>
                  <button onClick={() => onQty(i.owned!.id, 1)} aria-label="Add one more">＋</button>
                </div>
              ) : (
                <button className="act collect" onClick={() => i.tcg && onCollect(i.tcg)}>Collect</button>
              )}
              <div className="cap">
                <span className="n">{i.name}</span>
                <b className={i.price == null ? 'muted' : ''}>{i.price != null ? money(i.price) : '—'}</b>
              </div>
              <span className="num">#{i.number}</span>
            </div>
          ))}
        </div>
      )}

      <div className="footer">
        <button className="danger-link" onClick={onDelete}>Delete collection</button>
      </div>
    </>
  )
}
