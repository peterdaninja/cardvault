import { levenshtein, norm } from './names'
import { uid } from './store'
import type { OwnedCard, TcgCard } from './types'

const API = 'https://api.pokemontcg.io/v2/cards'

export const FIELDS = 'id,name,number,rarity,set,images,tcgplayer'
const cache = new Map<string, TcgCard[]>()
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The free card API returns occasional 500/502/504s, so retry those with a short backoff. */
export interface QueryOpts {
  pageSize?: number
  page?: number
  orderBy?: string
}

export async function queryCards(q: string, opts: QueryOpts = {}): Promise<TcgCard[]> {
  const { pageSize = 36, page = 1, orderBy = '-set.releaseDate' } = opts
  const key = `${q}|${pageSize}|${page}|${orderBy}`
  const hit = cache.get(key)
  if (hit) return hit
  const url = `${API}?q=${encodeURIComponent(q)}&pageSize=${pageSize}&page=${page}&orderBy=${orderBy}&select=${FIELDS}`
  let lastStatus = 0
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await sleep(500 * 2 ** (attempt - 1))
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
      if (res.ok) {
        const data = ((await res.json()).data ?? []) as TcgCard[]
        cache.set(key, data)
        return data
      }
      lastStatus = res.status
      if (res.status < 500 && res.status !== 429) break // a real client error, retrying won't help
    } catch {
      lastStatus = 0 // network error or timeout
    }
  }
  throw new Error(
    lastStatus
      ? `The card database is busy right now (error ${lastStatus}). Tap Search to try again.`
      : 'Could not reach the card database. Check your connection and tap Search to try again.',
  )
}

const clean = (s: string) => s.replace(/["\\]/g, '').trim()

/** Find cards by name, collector number and printed set total. Falls back to looser queries. */
export async function findCards(
  name: string,
  number?: string,
  total?: string,
  trustName = true,
  /** Restrict every search to one set, e.g. "me55". Within a set the collector number is unique. */
  setId?: string,
): Promise<TcgCard[]> {
  const n = clean(name)
  const num = number ? (/^\d+$/.test(number) ? String(parseInt(number, 10)) : number) : ''
  const tot = total && /^\d+$/.test(total) ? String(parseInt(total, 10)) : ''

  if (setId) {
    const inSet = `set.id:${setId}`
    const attempts: string[] = []
    if (n && num) attempts.push(`name:"${n}*" number:${num} ${inSet}`)
    if (num) attempts.push(`number:${num} ${inSet}`)
    if (n) attempts.push(`name:"${n}*" ${inSet}`)
    for (const q of attempts) {
      const found = await queryCards(q)
      if (found.length) return rankByName(found, n)
    }
    return [] // never fall back to cards outside the chosen set
  }

  // A number plus printed set total (e.g. 4/102) pins down one card per set, so trust it over a
  // possibly misread name and only use the name to rank the results.
  if (num && tot && !trustName) {
    const found = await queryCards(`number:${num} set.printedTotal:${tot}`)
    if (found.length) return rankByName(found, n)
  }

  const attempts: string[] = []
  if (n && num) attempts.push(`name:"${n}*" number:${num}`)
  if (n) attempts.push(`name:"${n}*"`)
  if (!n && num) attempts.push(`number:${num}`)

  for (const q of attempts) {
    const found = await queryCards(q)
    if (found.length) {
      // The printed total can be misread, so use it only to float matching sets to the top.
      if (tot) {
        found.sort(
          (a, b) =>
            Number(String(b.set.printedTotal) === tot) - Number(String(a.set.printedTotal) === tot),
        )
      }
      return found
    }
  }
  return []
}

function rankByName(cards: TcgCard[], name: string): TcgCard[] {
  if (!name) return cards
  const n = norm(name)
  const sim = (c: TcgCard) => 1 - levenshtein(n, norm(c.name)) / Math.max(n.length, norm(c.name).length)
  return [...cards].sort((a, b) => sim(b) - sim(a))
}

export function marketPrice(card: TcgCard): number | null {
  const prices = card.tcgplayer?.prices
  if (!prices) return null
  for (const variant of Object.values(prices)) {
    if (variant.market != null) return variant.market
  }
  return null
}

export function toOwned(c: TcgCard, collectionId: string): OwnedCard {
  return {
    id: uid(),
    collectionId,
    cardId: c.id,
    name: c.name,
    setName: c.set.name,
    number: c.number,
    rarity: c.rarity ?? '',
    image: c.images.small,
    price: marketPrice(c),
    qty: 1,
    addedAt: Date.now(),
  }
}
