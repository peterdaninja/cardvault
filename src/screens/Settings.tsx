import { useRef, useState } from 'react'
import { cloudAvailable } from '../lib/syncClient'
import { getAutoAdd, setAutoAdd } from '../lib/prefs'
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
  onImportList: () => void
  onOpenShare: () => void
}

export default function Settings({ state, refreshing, refreshNote, onRefresh, onExport, onImport, onImportList, onOpenShare }: Props) {
  const importRef = useRef<HTMLInputElement>(null)
  const [theme, setTheme] = useState(getTheme())
  const [autoAdd, setAutoAddState] = useState(getAutoAdd())
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

      <h2 className="section">Scanning</h2>
      <label className="card-panel toggle">
        <span>
          <b>Add automatically when sure</b>
          <small>After a scan, a clear single match is added right away, with an Undo. Anything unclear still asks you to choose.</small>
        </span>
        <input
          type="checkbox"
          checked={autoAdd}
          onChange={(e) => {
            setAutoAdd(e.target.checked)
            setAutoAddState(e.target.checked)
          }}
        />
      </label>

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

      <h2 className="section">Import cards</h2>
      <div className="card-panel">
        <p>Add cards from a text list, like an export from another app. You preview the matches, tick what you want, and send them to your collections.</p>
        <button className="big" style={{ marginTop: 12 }} onClick={onImportList}>Import a card list</button>
      </div>

      <h2 className="section">Backup</h2>
      <div className="card-panel">
        <p>Your collection lives on this phone unless you turn on cloud backup. Export a backup file now and then, especially before clearing Safari data.</p>
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

      {cloudAvailable && (
        <>
          <h2 className="section">Account &amp; sharing</h2>
          <div className="card-panel">
            <p>Optional. Sign in to back up your collection and let friends view it (view only). Until you do, nothing leaves this phone.</p>
            <button className="big" style={{ marginTop: 12 }} onClick={onOpenShare}>Account &amp; sharing</button>
          </div>
        </>
      )}

      <p className="hint" style={{ textAlign: 'center', marginTop: 28 }}>
        SLOWTCG · Version {__BUILD__} UTC
      </p>
    </>
  )
}
