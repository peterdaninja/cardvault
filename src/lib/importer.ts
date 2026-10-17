import type { CatalogCard } from './catalog'
import { adapterFor } from './games'
import { levenshtein, norm } from './names'
import { printingByCode } from './ygo'
import type { Game } from './types'

export interface ImportEntry {
  raw: string
  qty: number
  name: string // without any "(UTR)"-style note
  note?: string // the "(UTR)" part, kept as a hint
  setAbbr?: string // the "[SDK]" part
  code?: string // set code (Yu-Gi-Oh!) or card id (Pokémon)
  game?: Game // known from the code; undefined when the line has no code
}

export interface ParseResult {
  entries: ImportEntry[] // duplicates already merged
  lines: number
  copies: number
  skipped: string[] // lines that did not look like cards
}

const LINE_RE = /^\s*(\d+)\s*[xX×]?\s+(.+?)\s*$/
const CODE_TAIL_RE = /^(.*?)\s+(?:\[([^\]]+)\]\s+)?([A-Za-z0-9]{2,8}-[A-Za-z0-9]{1,8})\s*$/
const YGO_CODE_RE = /^[A-Z0-9]{2,6}-[A-Z]{0,4}\d{1,4}$/

/** Read a text list like "2 Dark Hole [SDK] SDK-022", one card per line, merging repeated cards. */
export function parseList(text: string): ParseResult {
  const merged = new Map<string, ImportEntry>()
  const skipped: string[] = []
  let lines = 0
  let copies = 0

  for (const rawLine of text.split(/\r?\n/)) {
    const raw = rawLine.trim()
    if (!raw || raw.startsWith('#') || raw.startsWith('//')) continue
    lines++
    const m = raw.match(LINE_RE)
    if (!m) {
      skipped.push(raw)
      continue
    }
    const qty = parseInt(m[1], 10)
    let rest = m[2]
    let setAbbr: string | undefined
    let code: string | undefined
    const c = rest.match(CODE_TAIL_RE)
    if (c) {
      rest = c[1]
      setAbbr = c[2]
      code = c[3]
    }
    const noteMatch = rest.match(/\s*\(([^)]+)\)\s*$/)
    const note = noteMatch?.[1]
    const name = (noteMatch ? rest.slice(0, noteMatch.index) : rest).trim()
    if (!name || qty <= 0) {
      skipped.push(raw)
      continue
    }

    let game: Game | undefined
    if (code) game = YGO_CODE_RE.test(code) ? 'yugioh' : /[a-z]/.test(code) ? 'pokemon' : undefined
    if (code && game === 'yugioh') code = code.toUpperCase()

    copies += qty
    const key = code ? `${game ?? '?'}:${code}` : `name:${norm(name)}`
    const existing = merged.get(key)
    if (existing) existing.qty += qty
    else merged.set(key, { raw, qty, name, note, setAbbr, code, game })
  }
  return { entries: [...merged.values()], lines, copies, skipped }
}

export type ItemStatus = 'matched' | 'review' | 'missing'

export interface ImportItem {
  key: string
  entry: ImportEntry
  game: Game
  status: ItemStatus
  card?: CatalogCard // the chosen match
  candidates: CatalogCard[] // alternatives to choose from when unsure
  note?: string
}

const nameSim = (a: string, b: string) => {
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return 0
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length)
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>, signal?: AbortSignal) {
  let next = 0
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length && !signal?.aborted) {
      const i = next++
      await fn(items[i])
    }
  })
  await Promise.all(workers)
}

async function resolveOne(entry: ImportEntry, key: string, defaultGame: Game): Promise<ImportItem> {
  const game = entry.game ?? defaultGame
  const adapter = adapterFor(game)
  const base = { key, entry, game, candidates: [] as CatalogCard[] }

  try {
    if (game === 'yugioh' && entry.code) {
      const exact = await printingByCode(entry.code)
      if (exact) {
        // A list can spell names differently from the database, so only flag big disagreements.
        if (nameSim(entry.name, exact.name) >= 0.5) return { ...base, status: 'matched', card: exact }
        return { ...base, status: 'review', card: exact, candidates: [exact], note: `Code matches "${exact.name}", not "${entry.name}"` }
      }
    }

    if (game === 'pokemon' && entry.code) {
      const dash = entry.code.lastIndexOf('-')
      const found = await adapter.findCards({ name: entry.name, number: entry.code.slice(dash + 1), setId: entry.code.slice(0, dash) })
      if (found.length === 1) return { ...base, status: 'matched', card: found[0] }
      if (found.length) return { ...base, status: 'review', candidates: found.slice(0, 6) }
    }

    // No usable code, or it was not found: search by name and let the user choose.
    const found = await adapter.findCards({ name: entry.name, number: entry.code })
    if (found.length === 1 && !entry.code) return { ...base, status: 'review', card: found[0], candidates: found }
    if (found.length) {
      return { ...base, status: 'review', candidates: found.slice(0, 8), note: entry.code ? `Code ${entry.code} not found` : undefined }
    }
    return { ...base, status: 'missing', note: entry.code ? `Code ${entry.code} not found` : 'No match found' }
  } catch (e) {
    return { ...base, status: 'missing', note: e instanceof Error ? e.message : 'Lookup failed' }
  }
}

/**
 * Match every entry against the card databases. Set-code lookups are cached on the device, so a
 * list you have already matched comes back instantly the next time.
 */
export async function resolveEntries(
  entries: ImportEntry[],
  defaultGame: Game,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ImportItem[]> {
  const out: ImportItem[] = new Array(entries.length)
  let done = 0
  await pool(
    entries.map((entry, i) => ({ entry, i })),
    6,
    async ({ entry, i }) => {
      out[i] = await resolveOne(entry, `${i}`, defaultGame)
      onProgress(++done, entries.length)
    },
    signal,
  )
  return out.filter(Boolean)
}
