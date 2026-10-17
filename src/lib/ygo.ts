import { get, set } from 'idb-keyval'
import type { CatalogCard, CatalogSet, GameAdapter } from './catalog'
import { levenshtein, norm } from './names'

const BASE = 'https://db.ygoprodeck.com/api/v7'
const DAY = 24 * 60 * 60 * 1000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ───────── Polite, rate-limited requests ─────────
// The database allows 20 requests a second and blocks clients that go over, so keep well under.
const MIN_GAP_MS = 120
let lastAt = 0
let chain: Promise<void> = Promise.resolve()

function throttle(): Promise<void> {
  const turn = chain.then(async () => {
    const wait = Math.max(0, lastAt + MIN_GAP_MS - Date.now())
    if (wait) await sleep(wait)
    lastAt = Date.now()
  })
  chain = turn.catch(() => {})
  return turn
}

/** GET a JSON endpoint. Returns null when the database says "no match" (it answers 400 for that). */
async function api<T>(path: string): Promise<T | null> {
  let lastStatus = 0
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await sleep(500 * 2 ** (attempt - 1))
    await throttle()
    try {
      const res = await fetch(BASE + path, { signal: AbortSignal.timeout(25000) })
      if (res.ok) return (await res.json()) as T
      lastStatus = res.status
      if (res.status === 400 || res.status === 404) return null
      if (res.status === 429) await sleep(4000)
    } catch {
      lastStatus = 0
    }
  }
  throw new Error(
    lastStatus
      ? `The Yu-Gi-Oh! card database is busy right now (error ${lastStatus}). Try again in a moment.`
      : 'Could not reach the Yu-Gi-Oh! card database. Check your connection and try again.',
  )
}

// ───────── Shapes from the database ─────────
interface YPrinting {
  set_name: string
  set_code: string
  set_rarity: string
  set_price: string
}
interface YCard {
  id: number
  name: string
  card_sets?: YPrinting[]
  card_images?: { image_url_small: string }[]
}
interface YSetInfo {
  id: number
  name: string
  set_name: string
  set_code: string
  set_rarity: string
  set_price: string
}
interface YSet {
  set_name: string
  set_code: string
  num_of_cards: number
  tcg_date?: string
  set_image?: string
}

const imageFor = (id: number) => `https://images.ygoprodeck.com/images/cards_small/${id}.jpg`
const priceOf = (s: string | undefined) => {
  const p = parseFloat(s ?? '')
  return p > 0 ? p : null
}

// ───────── Sets ─────────
let setsPromise: Promise<CatalogSet[]> | null = null

export function getSets(): Promise<CatalogSet[]> {
  return (setsPromise ??= loadSets().catch((e) => {
    setsPromise = null
    throw e
  }))
}

async function loadSets(): Promise<CatalogSet[]> {
  const KEY = 'ygo-sets-v1'
  let saved: { at: number; sets: CatalogSet[] } | undefined
  try {
    saved = await get(KEY)
  } catch {
    /* storage unavailable */
  }
  if (saved && Date.now() - saved.at < 7 * DAY) return saved.sets
  try {
    const raw = (await api<YSet[]>('/cardsets.php')) ?? []
    const sets: CatalogSet[] = raw
      .map((s) => ({
        id: s.set_code,
        name: s.set_name,
        releaseDate: s.tcg_date,
        total: s.num_of_cards,
        logo: s.set_image,
      }))
      .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''))
    await set(KEY, { at: Date.now(), sets }).catch(() => {})
    return sets
  } catch (e) {
    if (saved) return saved.sets
    throw e
  }
}

async function setIndex() {
  const sets = await getSets()
  return {
    byName: new Map(sets.map((s) => [s.name, s])),
    byId: new Map(sets.map((s) => [s.id, s])),
  }
}

// ───────── Set codes ─────────
const CODE_RE = /^[A-Z0-9]{2,6}-[A-Z]{0,4}\d{1,4}$/

/** Normalise typed or scanned text into a set code like "SDK-001", or '' if it isn't one. */
export function normalizeCode(text: string | undefined): string {
  const t = (text ?? '').toUpperCase().replace(/\s+/g, '').replace(/[–—_]/g, '-')
  return CODE_RE.test(t) ? t : ''
}

/** Find a set code anywhere in noisy text (OCR output). */
export function findCodeIn(text: string): string {
  const m = text.toUpperCase().match(/[A-Z0-9]{2,6}\s?-\s?[A-Z]{0,4}\s?\d{1,4}/)
  return m ? normalizeCode(m[0]) : ''
}

const codeMemo = new Map<string, CatalogCard | null>()
let codeStoreLoaded: Promise<void> | null = null
let saveTimer = 0

async function loadCodeStore() {
  try {
    const saved = await get<Record<string, CatalogCard | null>>('ygo-codes-v1')
    for (const [k, v] of Object.entries(saved ?? {})) codeMemo.set(k, v)
  } catch {
    /* storage unavailable */
  }
}

function persistCodes() {
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    set('ygo-codes-v1', Object.fromEntries(codeMemo)).catch(() => {})
  }, 1500)
}

/** Exact lookup of one printing by its set code. Cached on the device, including "not found". */
export async function printingByCode(code: string): Promise<CatalogCard | null> {
  await (codeStoreLoaded ??= loadCodeStore())
  if (codeMemo.has(code)) return codeMemo.get(code)!
  const info = await api<YSetInfo>(`/cardsetsinfo.php?setcode=${encodeURIComponent(code)}`)
  let card: CatalogCard | null = null
  if (info?.id) {
    const { byName } = await setIndex().catch(() => ({ byName: new Map<string, CatalogSet>() }))
    const s = byName.get(info.set_name)
    card = {
      game: 'yugioh',
      id: info.set_code,
      name: info.name,
      number: info.set_code,
      rarity: info.set_rarity,
      image: imageFor(info.id),
      price: priceOf(info.set_price),
      setId: s?.id ?? info.set_code.split('-')[0],
      setName: info.set_name,
      releaseDate: s?.releaseDate,
    }
  }
  codeMemo.set(code, card)
  persistCodes()
  return card
}

// ───────── Cards in a set ─────────
const setCardMemo = new Map<string, Promise<CatalogCard[]>>()

export function getSetCards(setId: string, fresh = false): Promise<CatalogCard[]> {
  const key = setId + (fresh ? ':fresh' : '')
  let p = setCardMemo.get(key)
  if (!p) {
    p = loadSetCards(setId, fresh)
    setCardMemo.set(key, p)
    p.catch(() => setCardMemo.delete(key))
  }
  return p
}

function printingsToCards(cards: YCard[], setName: string, setId: string, releaseDate?: string): CatalogCard[] {
  const byCode = new Map<string, CatalogCard>()
  for (const c of cards) {
    for (const p of c.card_sets ?? []) {
      if (p.set_name !== setName) continue
      const price = priceOf(p.set_price)
      const existing = byCode.get(p.set_code)
      // Several rarities can share a code; show the base (cheapest priced) printing.
      if (existing && !(price != null && (existing.price == null || price < existing.price))) continue
      byCode.set(p.set_code, {
        game: 'yugioh',
        id: p.set_code,
        name: c.name,
        number: p.set_code,
        rarity: p.set_rarity,
        image: c.card_images?.[0]?.image_url_small ?? imageFor(c.id),
        price,
        setId,
        setName,
        releaseDate,
      })
    }
  }
  return [...byCode.values()].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
}

async function loadSetCards(setId: string, fresh: boolean): Promise<CatalogCard[]> {
  const { byId } = await setIndex()
  const s = byId.get(setId)
  if (!s) return []
  const KEY = `ygo-setcards-v1-${setId}`
  let saved: { at: number; cards: CatalogCard[] } | undefined
  try {
    saved = await get(KEY)
  } catch {
    /* storage unavailable */
  }
  if (saved && !fresh && Date.now() - saved.at < DAY) return saved.cards
  try {
    const json = await api<{ data: YCard[] }>(`/cardinfo.php?cardset=${encodeURIComponent(s.name)}`)
    const cards = printingsToCards(json?.data ?? [], s.name, s.id, s.releaseDate)
    if (cards.length) await set(KEY, { at: Date.now(), cards }).catch(() => {})
    return cards.length || !saved ? cards : saved.cards
  } catch (e) {
    if (saved) return saved.cards
    throw e
  }
}

// ───────── Searching ─────────
const sim = (a: string, b: string) => {
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return 0
  if (y.includes(x) || x.includes(y)) return 0.9 + 0.1 * (Math.min(x.length, y.length) / Math.max(x.length, y.length))
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length)
}

async function searchByName(name: string): Promise<CatalogCard[]> {
  const q = name.trim()
  if (q.length < 2) return []
  // The database only matches whole fragments, so a misread name finds nothing. Retry with
  // shorter pieces (trimmed ends, then the longest word) and rank everything by closeness.
  const attempts = [q, q.slice(0, Math.max(4, q.length - 3)), [...q.split(/\s+/)].sort((a, b) => b.length - a.length)[0]]
  let found: YCard[] = []
  for (const attempt of [...new Set(attempts)].filter((a) => a.length >= 3)) {
    const json = await api<{ data: YCard[] }>(`/cardinfo.php?fname=${encodeURIComponent(attempt)}&num=12&offset=0`)
    if (json?.data?.length) {
      found = json.data
      break
    }
  }
  const cards = found.sort((a, b) => sim(q, b.name) - sim(q, a.name))
  const { byName } = await setIndex().catch(() => ({ byName: new Map<string, CatalogSet>() }))
  const out: CatalogCard[] = []
  for (const c of cards) {
    const seen = new Set<string>()
    for (const p of c.card_sets ?? []) {
      if (seen.has(p.set_code)) continue
      seen.add(p.set_code)
      const s = byName.get(p.set_name)
      out.push({
        game: 'yugioh',
        id: p.set_code,
        name: c.name,
        number: p.set_code,
        rarity: p.set_rarity,
        image: c.card_images?.[0]?.image_url_small ?? imageFor(c.id),
        price: priceOf(p.set_price),
        setId: s?.id ?? p.set_code.split('-')[0],
        setName: p.set_name,
        releaseDate: s?.releaseDate,
      })
    }
  }
  // Best name first, then newest printing first.
  return out
    .sort((a, b) => sim(q, b.name) - sim(q, a.name) || (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''))
    .slice(0, 40)
}

export const yugioh: GameAdapter = {
  key: 'yugioh',
  label: 'Yu-Gi-Oh!',
  numberLabel: 'Set code',
  numberPlaceholder: 'e.g. SDK-001',

  getSets,
  getSetCards,

  async findCards({ name, number, setId }) {
    const code = normalizeCode(number)
    if (code) {
      const exact = await printingByCode(code)
      if (exact && (!setId || exact.setId === setId)) return [exact]
    }

    if (setId) {
      // Inside one set the whole list is cached locally, so search it without more requests.
      const cards = await getSetCards(setId)
      const digits = (number ?? '').replace(/\D/g, '')
      let pool = cards
      if (digits) {
        const narrowed = cards.filter((c) => c.number.replace(/\D/g, '').replace(/^0+/, '').endsWith(digits.replace(/^0+/, '')))
        if (narrowed.length) pool = narrowed
      }
      if (name.trim()) {
        return pool
          .map((c) => ({ c, s: sim(name, c.name) }))
          .filter((x) => x.s >= 0.45)
          .sort((a, b) => b.s - a.s)
          .slice(0, 12)
          .map((x) => x.c)
      }
      return digits ? pool.slice(0, 12) : []
    }

    const found = await searchByName(name)
    if (!code) return found
    // The code was read slightly wrong (e.g. SK-001 for SDK-001): prefer printings whose code is closest.
    const closeness = (c: CatalogCard) => 1 - levenshtein(code, c.number.toUpperCase()) / Math.max(code.length, c.number.length)
    return [...found].sort((a, b) => closeness(b) - closeness(a))
  },
}
