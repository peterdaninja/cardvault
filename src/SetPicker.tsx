import { useEffect, useMemo, useState } from 'react'
import { getSets, type TcgSet } from './lib/sets'

interface Props {
  title: string
  currentId?: string
  onPick: (set: TcgSet | null) => void // null = any set
  onCancel: () => void
}

/** Searchable list of official sets. Picking one limits a collection's searches to that set. */
export default function SetPicker({ title, currentId, onPick, onCancel }: Props) {
  const [sets, setSets] = useState<TcgSet[] | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')

  function load() {
    setError('')
    getSets().then(setSets).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load sets'))
  }
  useEffect(load, [])

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t || !sets) return sets ?? []
    return sets.filter((s) => `${s.name} ${s.series} ${s.id}`.toLowerCase().includes(t))
  }, [sets, q])

  return (
    <div className="sheet picker">
      <header className="bar">
        <button className="link" onClick={onCancel}>Cancel</button>
        <h2>{title}</h2>
        <span />
      </header>
      <div className="pad">
        <input
          className="search"
          autoFocus
          placeholder="Search sets (e.g. Base, 151, Celebration)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="big" onClick={() => onPick(null)}>
          Any set (search everything){!currentId ? ' ✓' : ''}
        </button>

        {error && (
          <p className="error">
            {error} <button onClick={load}>Retry</button>
          </p>
        )}
        {!sets && !error && <p className="status">Loading sets…</p>}

        <ul className="results">
          {shown.map((s) => (
            <li key={s.id} onClick={() => onPick(s)}>
              {s.symbol && <img src={s.symbol} alt="" className="sym" loading="lazy" />}
              <div className="meta">
                <strong>{s.name}{s.id === currentId ? ' ✓' : ''}</strong>
                <span>{s.series} · {s.releaseDate.slice(0, 4)}{s.printedTotal ? ` · ${s.printedTotal} cards` : ''}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
