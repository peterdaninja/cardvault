import { adapterFor } from './games'
import { pokemonSetIdOf } from './pokemon'
import type { Game, OwnedCard } from './types'

const gameOfCard = (c: OwnedCard): Game => c.game ?? 'pokemon'
const setIdOfCard = (c: OwnedCard) => c.setId ?? (gameOfCard(c) === 'pokemon' ? pokemonSetIdOf(c.cardId) : c.cardId.split('-')[0])

/**
 * Re-price owned cards from each game's card database. It fetches each affected set once (the
 * same data the set pages use) rather than one request per card. Sets that fail keep their old prices.
 */
export async function refreshPrices(cards: OwnedCard[]): Promise<{ cards: OwnedCard[]; failedSets: number }> {
  const groups = new Map<string, { game: Game; setId: string }>()
  for (const c of cards) {
    const game = gameOfCard(c)
    const setId = setIdOfCard(c)
    if (setId) groups.set(`${game}:${setId}`, { game, setId })
  }

  const prices = new Map<string, number>() // `${game}:${cardId}` -> price
  let failedSets = 0
  for (const { game, setId } of groups.values()) {
    try {
      for (const c of await adapterFor(game).getSetCards(setId, true)) {
        if (c.price != null) prices.set(`${game}:${c.id}`, c.price)
      }
    } catch {
      failedSets++
    }
  }
  return {
    cards: cards.map((c) => {
      const p = prices.get(`${gameOfCard(c)}:${c.cardId}`)
      return p != null ? { ...c, price: p } : c
    }),
    failedSets,
  }
}
