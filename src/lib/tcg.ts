import type { TcgCard } from './types'

const API = 'https://api.pokemontcg.io/v2/cards'

async function query(q: string): Promise<TcgCard[]> {
  const url = `${API}?q=${encodeURIComponent(q)}&pageSize=24&orderBy=-set.releaseDate`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Card lookup failed (${res.status})`)
  const json = await res.json()
  return json.data as TcgCard[]
}

const clean = (s: string) => s.replace(/["\\]/g, '').trim()

/** Find cards by name and/or collector number. Falls back to looser queries. */
export async function findCards(name: string, number?: string): Promise<TcgCard[]> {
  const n = clean(name)
  const num = number ? String(parseInt(number, 10)) : ''
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

export function marketPrice(card: TcgCard): number | null {
  const prices = card.tcgplayer?.prices
  if (!prices) return null
  for (const variant of Object.values(prices)) {
    if (variant.market != null) return variant.market
  }
  return null
}
