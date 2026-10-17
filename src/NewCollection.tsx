import { useState } from 'react'
import { GAME_LIST } from './lib/games'
import type { Game } from './lib/types'

interface Props {
  onNext: (name: string, game: Game) => void
  onCancel: () => void
}

/** First step of making a collection: a name and which game it is for. */
export default function NewCollection({ onNext, onCancel }: Props) {
  const [name, setName] = useState('')
  const [game, setGame] = useState<Game>('pokemon')
  const ready = name.trim().length > 0

  return (
    <div className="backdrop" onClick={onCancel}>
      <form
        className="detail newcol"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) onNext(name.trim(), game)
        }}
      >
        <div className="grab" />
        <h2>New collection</h2>

        <label className="field" style={{ marginTop: 16 }}>
          Name
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Base Set, Binder 1, Kaiba deck"
          />
        </label>

        <div className="field">
          Game
          <div className="seg wide" role="tablist">
            {GAME_LIST.map((g) => (
              <button type="button" key={g.key} className={g.key === game ? 'on' : ''} onClick={() => setGame(g.key)}>
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <button type="submit" className="primary big" disabled={!ready}>Next: choose a set</button>
        <button type="button" className="danger-link" style={{ width: '100%', color: 'var(--muted)' }} onClick={onCancel}>
          Cancel
        </button>
      </form>
    </div>
  )
}
