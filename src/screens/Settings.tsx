import { useRef, useState } from 'react'
import { THEMES, applyTheme, getTheme } from '../lib/theme'
import type { AppState } from '../lib/types'
import { dateLabel } from '../ui/format'
import Logo from '../ui/Logo'

declare const __BUILD__: string

interface Props {
  state: AppState
  refreshing: boolean
  refreshNote: string
  onRefresh: () => void
  onExport: () => void
  onImport: (file: File | undefined) => void
}

export default function Settings({ state, refreshing, refreshNote, onRefresh, onExport, onImport }: Props) {
  const importRef = useRef<HTMLInputElement>(null)
  const [theme, setTheme] = useState(getTheme())
  return (
    <>
      <header className="brand"><Logo height={44} /></header>
      <h2 className="section">Appearance</h2>
      <div className="themes">
        {THEMES.map((t) => (
          <button
            key={t.key}
            className={`theme-opt ${t.key === theme ? 'on' : ''}`}
            onClick={() => {
              applyTheme(t.key)
              setTheme(t.key)
            }}
            aria-pressed={t.key === theme}
          >
            <span className="swatch">
              {t.swatch.map((c) => <i key={c} style={{ background: c }} />)}
            </span>
            <span>
              <b>{t.label}{t.key === theme ? ' ✓' : ''}</b>
              <small>{t.blurb}</small>
            </span>
          </button>
        ))}
      </div>

      <h2 className="section">Prices</h2>
      <div className="card-panel">
        <p>
          Prices come from TCGplayer market data. They refresh automatically about once a day when you open the app.
        </p>
        <p className="hint">
          {state.pricesUpdatedAt ? `Last updated ${dateLabel(state.pricesUpdatedAt, true)}.` : 'Not refreshed yet.'}
          {refreshNote && ` ${refreshNote}`}
        </p>
        <button className="big" onClick={onRefresh} disabled={refreshing || !state.cards.length}>
          {refreshing ? 'Refreshing prices…' : 'Refresh prices now'}
        </button>
      </div>

      <h2 className="section">Backup</h2>
      <div className="card-panel">
        <p>Your collection lives on this phone only. Export a backup file now and then, especially before clearing Safari data.</p>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="grow" onClick={onExport}>Export backup</button>
          <button className="grow" onClick={() => importRef.current?.click()}>Import backup</button>
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
      </div>

      <p className="hint" style={{ textAlign: 'center', marginTop: 28 }}>
        SLOWTCG · Version {__BUILD__} UTC
      </p>
    </>
  )
}
