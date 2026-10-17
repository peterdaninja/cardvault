import type { CatalogCard, CatalogSet, GameAdapter } from './catalog'
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
    return (await findRawCards(name, number, total, trustName, setId)).map(fromTcg)
  },
}
