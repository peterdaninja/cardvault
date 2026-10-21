import { useMemo, useState } from 'react'
import { RANGES, seriesFor, totalCount, totalValue, type RangeKey } from '../lib/history'
import type { AppState, OwnedCard } from '../lib/types'
import Chart from '../ui/Chart'
import { dateLabel, money, moneyShort, signedMoney } from '../ui/format'
import Logo from '../ui/Logo'

interface Props {
  state: AppState
  onCard: (id: string) => void
  onStart: () => void
  readOnly?: boolean // viewing someone else's shared vault
}

export default function Home({ state, onCard, onStart, readOnly }: Props) {
  const [range, setRange] = useState<RangeKey>('1M')
  const [hover, setHover] = useState<number | null>(null)

  const value = totalValue(state.cards)
  const count = totalCount(state.cards)
  const unique = new Set(state.cards.map((c) => c.cardId)).size

  const points = useMemo(() => seriesFor(state.history ?? [], range), [state.history, range])
  const first = points[0]
  const shown = hover != null ? points[hover] : null
  const headline = shown ? shown.value : value
  const refValue = first?.value ?? 0
  const change = headline - refValue
  const pct = refValue > 0 ? (change / refValue) * 100 : null
  const up = change >= 0

  const top = useMemo(() => {
    const seen = new Set<string>()
    return [...state.cards]
      .filter((c) => c.price != null)
      .sort((a, b) => (b.price ?? 0) - (a.price ?? 0))
      .filter((c) => (seen.has(c.cardId) ? false : (seen.add(c.cardId), true)))
      .slice(0, 12)
  }, [state.cards])

  const recent = useMemo(() => [...state.cards].sort((a, b) => b.addedAt - a.addedAt).slice(0, 12), [state.cards])

  if (!state.cards.length) {
    return (
      <>
        <header className="brand"><Logo height={44} /></header>
        <div className="empty big-empty">
          <b>Welcome to SLOWTCG</b>
          {readOnly ? 'This vault has no cards yet.' : 'Create a collection, pick a set, then scan your cards in. Your value chart and top cards will show up here.'}
          {!readOnly && <button className="primary big" onClick={onStart} style={{ marginTop: 16 }}>Get started</button>}
        </div>
      </>
    )
  }

  return (
    <>
      <header className="brand"><Logo height={44} /></header>

      <section className="hero">
        <p className="eyebrow">{shown ? dateLabel(shown.t, true) : 'Collection value'}</p>
        <h1 className="big-value">{money(headline)}</h1>
        <p className={`delta ${up ? 'up' : 'down'}`}>
          {signedMoney(change)}
          {pct != null && ` (${up ? '+' : '−'}${Math.abs(pct).toFixed(1)}%)`}
          <span> {range === 'ALL' ? 'all time' : `past ${range}`}</span>
        </p>
        <Chart points={points} up={up} hover={hover} onHover={setHover} />
        <div className="axis">
          <span>{first ? dateLabel(first.t) : ''}</span>
          <span>Today</span>
        </div>
        <div className="ranges">
          {RANGES.map((r) => (
            <button key={r.key} className={r.key === range ? 'on' : ''} onClick={() => setRange(r.key)}>
              {r.key}
            </button>
          ))}
        </div>
      </section>

      <div className="stats">
        <div className="stat"><b>{count}</b><span>Cards</span></div>
        <div className="stat"><b>{unique}</b><span>Unique</span></div>
        <div className="stat"><b>{state.collections.length}</b><span>Collections</span></div>
      </div>

      {top.length > 0 && (
        <>
          <h2 className="section">Top value</h2>
          <CardRow cards={top} onCard={onCard} badge="price" />
        </>
      )}
      <h2 className="section">Recently added</h2>
      <CardRow cards={recent} onCard={onCard} badge="none" />
      {top.length === 0 && <p className="hint">No prices yet. Open Settings and tap Refresh prices.</p>}
      <p className="hint" style={{ textAlign: 'center', marginTop: 18 }}>
        {moneyShort(value)} across {state.collections.length} collection{state.collections.length === 1 ? '' : 's'}
      </p>
    </>
  )
}

function CardRow({ cards, onCard, badge }: { cards: OwnedCard[]; onCard: (id: string) => void; badge: 'price' | 'none' }) {
  return (
    <div className="hrow">
      {cards.map((c, i) => (
        <button key={c.id} className="hcard" onClick={() => onCard(c.id)}>
          <div className="himg">
            <img src={c.image} alt={c.name} loading="lazy" />
            {badge === 'price' && <span className="rank">{i + 1}</span>}
            {c.qty > 1 && <span className="qty">×{c.qty}</span>}
          </div>
          <span className="name">{c.name}</span>
          <span className={`pr ${c.price == null ? 'muted' : ''}`}>{c.price != null ? money(c.price) : '—'}</span>
        </button>
      ))}
    </div>
  )
}
