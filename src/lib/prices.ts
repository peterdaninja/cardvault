import { getSetCards } from './setcards'
import { marketPrice } from './tcg'
import type { OwnedCard } from './types'

/** Card ids look like "base1-4" or "swsh12pt5-TG05"; everything before the last dash is the set id. */
export const setIdOf = (cardId: string) => cardId.slice(0, cardId.lastIndexOf('-'))

/**
 * Re-price owned cards from the card database. It fetches each affected set once (the same
 * data the set pages use) rather than one request per card. Sets that fail keep their old prices.
 */
export async function refreshPrices(cards: OwnedCard[]): Promise<{ cards: OwnedCard[]; failedSets: number }> {
  const setIds = [...new Set(cards.map((c) => setIdOf(c.cardId)).filter(Boolean))]
  const prices = new Map<string, number | null>()
  let failedSets = 0
  for (const id of setIds) {
    try {
      for (const c of await getSetCards(id, true)) prices.set(c.id, marketPrice(c))
    } catch {
      failedSets++
    }
  }
  return {
    cards: cards.map((c) => (prices.has(c.cardId) && prices.get(c.cardId) != null ? { ...c, price: prices.get(c.cardId)! } : c)),
    failedSets,
  }
}
