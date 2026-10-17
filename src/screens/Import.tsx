import { useMemo, useRef, useState } from 'react'
import type { CatalogCard } from '../lib/catalog'
import { adapterFor, GAME_LIST } from '../lib/games'
import { parseList, resolveEntries, type ImportItem, type ParseResult } from '../lib/importer'
import type { Collection, Game } from '../lib/types'
import { money } from '../ui/format'

interface Row {
  card: CatalogCard
  qty: number
}

interface Props {
  collections: Collection[]
  onImport: (rows: Row[], collectionId: string) => void
  /** Make a collection tied to a set (or any set when `set` is undefined). Returns its id. */
  onCreateCollection: (game: Game, set: { id: string; name: string } | undefined, name: string) => string
  onClose: () => void
}

type Stage = 'input' | 'resolving' | 'review'

interface Group {
  id: string
  title: string
  game: Game
  collection?: Collection
  setId?: string
  items: ImportItem[]
}

const SHOW_LIMIT = 60

export default function Import({ collections, onImport, onCreateCollection, onClose }: Props) {
  const [stage, setStage] = useState<Stage>('input')
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [defaultGame, setDefaultGame] = useState<Game>('yugioh')
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [items, setItems] = useState<ImportItem[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [shown, setShown] = useState<Record<string, number>>({})
  const [dest, setDest] = useState(collections[0]?.id ?? '')
  const [importedCount, setImportedCount] = useState(0)
  const [message, setMessage] = useState('')
  const abort = useRef<AbortController | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function onFile(file: File | undefined) {
    if (!file) return
    setFileName(file.name)
    setText(await file.text())
  }

  function preview() {
    setParsed(parseList(text))
  }

  /** Which of your collections should this card go to? A collection tied to the card's set. */
  function suggestion(item: ImportItem): Collection | undefined {
    if (!item.card) return undefined
    return collections.find((c) => adapterFor(c.game).key === item.game && c.setId && c.setId === item.card!.setId)
  }

  async function start() {
    if (!parsed) return
    abort.current = new AbortController()
    setStage('resolving')
    setProgress({ done: 0, total: parsed.entries.length })
    const resolved = await resolveEntries(
      parsed.entries,
      defaultGame,
      (done, total) => setProgress({ done, total }),
      abort.current.signal,
    )
    if (abort.current.signal.aborted) return
    setItems(resolved)
    // Point the "import selected" menu at a collection for the same game as the list.
    const sameGame = collections.find((c) => adapterFor(c.game).key === defaultGame)
    if (sameGame) setDest(sameGame.id)
    // Cards that already belong to one of your set collections start ticked; the rest are your call.
    setSelected(new Set(resolved.filter((i) => i.status === 'matched' && suggestion(i)).map((i) => i.key)))
    setStage('review')
  }

  function cancelResolve() {
    abort.current?.abort()
    setStage('input')
  }

  const matched = items.filter((i) => i.status === 'matched' && i.card)
  const review = items.filter((i) => i.status === 'review')
  const missing = items.filter((i) => i.status === 'missing')

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>()
    for (const item of items.filter((i) => i.status === 'matched' && i.card)) {
      const col = suggestion(item)
      const id = col ? `col:${col.id}` : `set:${item.game}:${item.card!.setId}`
      let g = map.get(id)
      if (!g) {
        g = {
          id,
          title: col ? col.name : item.card!.setName,
          game: item.game,
          collection: col,
          setId: item.card!.setId,
          items: [],
        }
        map.set(id, g)
      }
      g.items.push(item)
    }
    const all = [...map.values()]
    // Your own collections first, then sets that have no collection yet, biggest first.
    return all.sort((a, b) => Number(!!b.collection) - Number(!!a.collection) || b.items.length - a.items.length)
  }, [items, collections]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(key: string) {
    setSelected((s) => {
      const n = new Set(s)
      if (!n.delete(key)) n.add(key)
      return n
    })
  }

  function setMany(keys: string[], on: boolean) {
    setSelected((s) => {
      const n = new Set(s)
      for (const k of keys) on ? n.add(k) : n.delete(k)
      return n
    })
  }

  function finish(done: ImportItem[], collectionId: string) {
    const rows = done.map((i) => ({ card: i.card!, qty: i.entry.qty }))
    onImport(rows, collectionId)
    const gone = new Set(done.map((i) => i.key))
    setItems((all) => all.filter((i) => !gone.has(i.key)))
    setSelected((s) => new Set([...s].filter((k) => !gone.has(k))))
    setImportedCount((n) => n + rows.reduce((sum, r) => sum + r.qty, 0))
    const name = collections.find((c) => c.id === collectionId)?.name
    setMessage(`Added ${rows.length} card${rows.length === 1 ? '' : 's'}${name ? ` to ${name}` : ''}.`)
  }

  function importGroup(g: Group) {
    const picked = g.items.filter((i) => selected.has(i.key))
    if (!picked.length) return
    const id = g.collection?.id ?? onCreateCollection(g.game, g.setId ? { id: g.setId, name: g.title } : undefined, g.title)
    finish(picked, id)
  }

  function importSelected() {
    const target = collections.find((c) => c.id === dest)
    if (!target) return
    const game = adapterFor(target.game).key
    const picked = matched.filter((i) => selected.has(i.key))
    const ok = picked.filter((i) => i.game === game)
    if (!ok.length) {
      setMessage(`None of the selected cards are ${adapterFor(game).label} cards.`)
      return
    }
    finish(ok, target.id)
    if (ok.length < picked.length) setMessage(`Added ${ok.length}. Skipped ${picked.length - ok.length} from a different game.`)
  }

  function choose(item: ImportItem, card: CatalogCard) {
    setItems((all) => all.map((i) => (i.key === item.key ? { ...i, status: 'matched', card, note: undefined } : i)))
    setSelected((s) => new Set(s).add(item.key))
  }

  function drop(key: string) {
    setItems((all) => all.filter((i) => i.key !== key))
  }

  const selectedCount = matched.filter((i) => selected.has(i.key)).length

  return (
    <div className="sheet importer">
      <header className="bar">
        <button className="link" onClick={() => { abort.current?.abort(); onClose() }}>Close</button>
        <h2>Import cards</h2>
        <span />
      </header>

      <div className="pad">
        {stage === 'input' && (
          <>
            <p className="hint" style={{ marginTop: 0 }}>
              Load a text list with one card per line, like <code>2 Dark Hole [SDK] SDK-022</code>. Quantity, name and set code
              are read. Repeated cards are combined.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.csv,text/plain"
              hidden
              onChange={(e) => {
                onFile(e.target.files?.[0])
                e.target.value = ''
                setParsed(null)
              }}
            />
            <button className="big" onClick={() => fileRef.current?.click()}>
              {fileName ? `📄 ${fileName}` : '📄 Choose a .txt file'}
            </button>
            <label className="field" style={{ marginTop: 14 }}>
              Or paste a list
              <textarea
                className="paste"
                rows={6}
                value={text}
                onChange={(e) => {
                  setText(e.target.value)
                  setParsed(null)
                }}
                placeholder={'2 Dark Hole [SDK] SDK-022\n1 Pot of Greed [SYE] SYE-040'}
              />
            </label>
            <label className="field">
              Lines with no set code are
              <select value={defaultGame} onChange={(e) => setDefaultGame(e.target.value as Game)}>
                {GAME_LIST.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
              </select>
            </label>
            <button className="big" disabled={!text.trim()} onClick={preview}>Read the list</button>

            {parsed && (
              <div className="card-panel" style={{ marginTop: 14 }}>
                <p>
                  <b>{parsed.entries.length}</b> different cards, <b>{parsed.copies}</b> copies in total
                  {parsed.lines !== parsed.entries.length && <> (merged from {parsed.lines} lines)</>}.
                </p>
                {parsed.skipped.length > 0 && (
                  <p className="hint">
                    {parsed.skipped.length} line{parsed.skipped.length === 1 ? '' : 's'} could not be read and will be ignored:
                    {' '}{parsed.skipped.slice(0, 3).join(' | ')}
                  </p>
                )}
                <button className="primary big" disabled={!parsed.entries.length} onClick={start}>
                  Match {parsed.entries.length} cards
                </button>
                <p className="hint">
                  Matching looks each card up in the card database, about 8 per second. Cards matched once are remembered on this
                  phone, so repeating an import is quick.
                </p>
              </div>
            )}
          </>
        )}

        {stage === 'resolving' && (
          <div className="card-panel center">
            <p><b>Matching cards…</b></p>
            <div className="pbar" role="progressbar">
              <i style={{ width: `${progress.total ? Math.max(2, (progress.done / progress.total) * 100) : 2}%` }} />
              <span>{progress.done} / {progress.total}</span>
            </div>
            <p className="hint">Keep this screen open. You can stop at any time.</p>
            <button onClick={cancelResolve}>Stop</button>
          </div>
        )}

        {stage === 'review' && (
          <>
            <div className="stats">
              <div className="stat"><b>{matched.length}</b><span>Matched</span></div>
              <div className="stat"><b>{review.length}</b><span>Review</span></div>
              <div className="stat"><b>{importedCount}</b><span>Imported</span></div>
            </div>
            {message && <p className="status ok">{message}</p>}

            {items.length === 0 && (
              <div className="empty">
                <b>All done</b>
                {importedCount} cop{importedCount === 1 ? 'y' : 'ies'} imported.
                <button className="primary big" style={{ marginTop: 14 }} onClick={onClose}>Close</button>
              </div>
            )}

            {matched.length > 0 && (
              <div className="importbar">
                <div className="row">
                  <button onClick={() => setMany(matched.map((i) => i.key), true)}>Select all</button>
                  <button onClick={() => setSelected(new Set())}>None</button>
                  <span className="hint grow" style={{ textAlign: 'right', margin: 0 }}>{selectedCount} selected</span>
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <select className="grow" value={dest} onChange={(e) => setDest(e.target.value)} aria-label="Import into">
                    {collections.map((c) => <option key={c.id} value={c.id}>{c.name} · {adapterFor(c.game).label}</option>)}
                  </select>
                  <button className="primary" disabled={!selectedCount || !dest} onClick={importSelected}>
                    Import selected
                  </button>
                </div>
              </div>
            )}

            {review.length > 0 && (
              <section>
                <h3 className="section">Needs review ({review.length})</h3>
                <ul className="results">
                  {review.map((item) => (
                    <li key={item.key} className="rv">
                      <div className="meta">
                        <strong>{item.entry.qty}× {item.entry.name}</strong>
                        <span>{item.entry.code ?? 'no set code'}{item.entry.note ? ` · ${item.entry.note}` : ''}</span>
                        {item.note && <span className="warn">{item.note}</span>}
                        <div className="cands">
                          {item.candidates.map((c) => (
                            <button key={c.id + c.setName} onClick={() => choose(item, c)}>
                              {c.name} · {c.setName} {c.number}{c.price != null ? ` · ${money(c.price)}` : ''}
                            </button>
                          ))}
                        </div>
                      </div>
                      <button onClick={() => drop(item.key)}>Skip</button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {groups.map((g) => {
              const keys = g.items.map((i) => i.key)
              const sel = g.items.filter((i) => selected.has(i.key)).length
              const isOpen = open[g.id] ?? g.items.length <= 12
              const limit = shown[g.id] ?? SHOW_LIMIT
              const copies = g.items.reduce((n, i) => n + i.entry.qty, 0)
              return (
                <section key={g.id} className="grp">
                  <div className="grp-head">
                    <button className="grp-title" onClick={() => setOpen((o) => ({ ...o, [g.id]: !isOpen }))}>
                      <span>{isOpen ? '▾' : '▸'}</span>
                      <span>
                        <b>{g.title}</b>
                        <small>
                          {g.items.length} card{g.items.length === 1 ? '' : 's'} · {copies} cop{copies === 1 ? 'y' : 'ies'}
                          {g.collection ? ' · matches your collection' : ' · no collection yet'}
                        </small>
                      </span>
                    </button>
                    <button onClick={() => setMany(keys, sel < keys.length)}>{sel < keys.length ? 'All' : 'None'}</button>
                    <button className="primary" disabled={!sel} onClick={() => importGroup(g)}>
                      {g.collection ? `Add ${sel}` : `Create + add ${sel}`}
                    </button>
                  </div>
                  {isOpen && (
                    <ul className="results">
                      {g.items.slice(0, limit).map((item) => (
                        <li key={item.key} className="irow" onClick={() => toggle(item.key)}>
                          <input type="checkbox" checked={selected.has(item.key)} readOnly aria-label={`Select ${item.card!.name}`} />
                          <img src={item.card!.image} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                          <div className="meta">
                            <strong>{item.card!.name}</strong>
                            <span>{item.card!.number}{item.card!.rarity ? ` · ${item.card!.rarity}` : ''}</span>
                            <span>{item.card!.price != null ? money(item.card!.price) : 'No price'}</span>
                          </div>
                          <b className="qtybadge">×{item.entry.qty}</b>
                        </li>
                      ))}
                      {g.items.length > limit && (
                        <li className="more">
                          <button onClick={() => setShown((s) => ({ ...s, [g.id]: limit + SHOW_LIMIT }))}>
                            Show {Math.min(SHOW_LIMIT, g.items.length - limit)} more
                          </button>
                        </li>
                      )}
                    </ul>
                  )}
                </section>
              )
            })}

            {missing.length > 0 && (
              <section>
                <h3 className="section">Not found ({missing.length})</h3>
                <ul className="results">
                  {missing.slice(0, 30).map((item) => (
                    <li key={item.key}>
                      <div className="meta">
                        <strong>{item.entry.qty}× {item.entry.name}</strong>
                        <span>{item.entry.code ?? 'no set code'} · {item.note}</span>
                      </div>
                      <button onClick={() => drop(item.key)}>Hide</button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
