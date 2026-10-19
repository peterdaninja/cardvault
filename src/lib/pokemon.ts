import type { CatalogCard, CatalogSet, GameAdapter } from './catalog'
import { levenshtein, norm } from './names'
import { getSetCards as getRawSetCards } from './setcards'
import { getSets as getRawSets } from './sets'
import { findCards as findRawCards, marketPrice } from './tcg'
import type { TcgCard } from './types'

/** Card ids look like "base1-4" or "swsh12pt5-TG05"; everything before the last dash is the set id. */
export const pokemonSetIdOf = (cardId: string) => cardId.slice(0, cardId.lastIndexOf('-'))

export function fromTcg(c: TcgCard): CatalogCard {
  return {
    game: 'pokemon',
    id: c.id,
    name: c.name,
    number: c.number,
    rarity: c.rarity ?? '',
    image: c.images.small,
    price: marketPrice(c),
    setId: c.set.id ?? pokemonSetIdOf(c.id),
    setName: c.set.name,
    setPrintedTotal: c.set.printedTotal,
    releaseDate: c.set.releaseDate,
  }
}

const sameNumber = (a: string, b: string) => {
  const x = a.replace(/^0+(?=\d)/, '').toUpperCase()
  const y = b.replace(/^0+(?=\d)/, '').toUpperCase()
  return x === y
}

const nameSim = (a: string, b: string) => {
  const x = norm(a)
  const y = norm(b)
  return x && y ? 1 - levenshtein(x, y) / Math.max(x.length, y.length) : 0
}

/**
 * Find a card among the ones in a set that are already stored on the phone. Mirrors what the online
 * search does (name and number, then number, then name) but needs no internet and is instant.
 */
function searchSetCards(cards: CatalogCard[], name: string, number?: string): CatalogCard[] {
  const n = name.trim().toLowerCase()
  const byNumber = number ? cards.filter((c) => sameNumber(c.number, number)) : []
  const byName = n ? cards.filter((c) => c.name.toLowerCase().startsWith(n)) : []

  if (byNumber.length && byName.length) {
    const both = byNumber.filter((c) => byName.includes(c))
    if (both.length) return both
  }
  if (byNumber.length) return [...byNumber].sort((a, b) => nameSim(name, b.name) - nameSim(name, a.name))
  if (byName.length) return byName
  if (n.length >= 3) {
    // A slightly misread name: offer the closest names in the set.
    return cards
      .map((c) => ({ c, s: nameSim(name, c.name) }))
      .filter((x) => x.s >= 0.6)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8)
      .map((x) => x.c)
  }
  return []
}

export const pokemon: GameAdapter = {
  key: 'pokemon',
  label: 'Pokémon',
  numberLabel: 'No.',
  numberPlaceholder: 'e.g. 120',

  async getSets(): Promise<CatalogSet[]> {
    const sets = await getRawSets()
    return sets.map((s) => ({
      id: s.id,
      name: s.name,
      series: s.series,
      releaseDate: s.releaseDate,
      total: s.total ?? s.printedTotal,
      logo: s.logo,
      symbol: s.symbol,
    }))
  },

  async getSetCards(setId, fresh = false) {
    return (await getRawSetCards(setId, fresh)).map(fromTcg)
  },

  async findCards({ name, number, total, trustName = true, setId }) {
    if (setId) {
      // A collection tied to one set: its whole card list is stored on the phone, so search that.
      try {
        const cards = (await getRawSetCards(setId)).map(fromTcg)
        if (cards.length) return searchSetCards(cards, name, number)
      } catch {
        /* not stored yet and no connection: fall through to the online search */
      }
    }
    return (await findRawCards(name, number, total, trustName, setId)).map(fromTcg)
  },
}
