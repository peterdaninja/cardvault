import { useEffect, useMemo, useState } from 'react'
import type { CatalogSet } from './lib/catalog'
import { adapterFor } from './lib/games'
import type { Game } from './lib/types'

interface Props {
  game: Game
  title: string
  currentId?: string
  onPick: (set: CatalogSet | null) => void // null = any set
  onCancel: () => void
}

const INITIAL_ROWS = 120

/** Searchable list of official sets. Picking one limits a collection's searches to that set. */
export default function SetPicker({ game, title, currentId, onPick, onCancel }: Props) {
  const [sets, setSets] = useState<CatalogSet[] | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')

  function load() {
    setError('')
    adapterFor(game)
      .getSets()
      .then(setSets)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load sets'))
  }
  useEffect(load, [game]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!sets) return []
    if (!t) return sets.slice(0, INITIAL_ROWS)
    return sets.filter((s) => `${s.name} ${s.series ?? ''} ${s.id}`.toLowerCase().includes(t)).slice(0, 300)
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
          placeholder={game === 'yugioh' ? 'Search sets (e.g. Kaiba, LOB, Metal Raiders)' : 'Search sets (e.g. Base, 151, Celebration)'}
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
            <li key={s.id + s.name} onClick={() => onPick(s)}>
              {s.symbol && <img src={s.symbol} alt="" className="sym" loading="lazy" />}
              <div className="meta">
                <strong>{s.name}{s.id === currentId ? ' ✓' : ''}</strong>
                <span>
                  {[s.series, s.releaseDate?.slice(0, 4), s.id, s.total ? `${s.total} cards` : ''].filter(Boolean).join(' · ')}
                </span>
              </div>
            </li>
          ))}
        </ul>
        {sets && !q && sets.length > INITIAL_ROWS && (
          <p className="hint">Showing the newest {INITIAL_ROWS} of {sets.length} sets. Search to find the rest.</p>
        )}
      </div>
    </div>
  )
}
