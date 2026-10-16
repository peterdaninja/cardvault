import { levenshtein, norm } from './names'
import type { TcgCard } from './types'

const API = 'https://api.pokemontcg.io/v2/cards'

async function query(q: string): Promise<TcgCard[]> {
  const url = `${API}?q=${encodeURIComponent(q)}&pageSize=36&orderBy=-set.releaseDate`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Card lookup failed (${res.status})`)
  const json = await res.json()
  return json.data as TcgCard[]
}

const clean = (s: string) => s.replace(/["\\]/g, '').trim()

/** Find cards by name, collector number and printed set total. Falls back to looser queries. */
export async function findCards(name: string, number?: string, total?: string): Promise<TcgCard[]> {
  const n = clean(name)
  const num = number ? (/^\d+$/.test(number) ? String(parseInt(number, 10)) : number) : ''
  const tot = total && /^\d+$/.test(total) ? String(parseInt(total, 10)) : ''

  // A number plus printed set total (e.g. 4/102) pins down one card per set, so trust it over a
  // possibly misread name and only use the name to rank the results.
  if (num && tot) {
    const found = await query(`number:${num} set.printedTotal:${tot}`)
    if (found.length) return rankByName(found, n)
  }

  const attempts: string[] = []
  if (n && num) attempts.push(`name:"${n}*" number:${num}`)
  if (n) attempts.push(`name:"${n}*"`)
  if (!n && num) attempts.push(`number:${num}`)

  for (const q of attempts) {
    const found = await query(q)
    if (found.length) return found
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
