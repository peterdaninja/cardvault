import { uid } from './store'
import type { Collection, Game, OwnedCard } from './types'

/** A card from any supported game, in one shape the screens can share. */
export interface CatalogCard {
  game: Game
  id: string // Pokémon: "base1-4". Yu-Gi-Oh!: the set code, e.g. "SDK-001"
  name: string
  number: string // Pokémon: collector number. Yu-Gi-Oh!: the set code
  rarity: string
  image: string
  price: number | null // USD market price, if known
  setId: string // Pokémon: "base1". Yu-Gi-Oh!: the set code prefix, e.g. "SDK"
  setName: string
  setPrintedTotal?: number // Pokémon only: the "/102" printed on cards
  releaseDate?: string
}

export interface CatalogSet {
  id: string
  name: string
  series?: string
  releaseDate?: string
  total?: number // cards in the set
  logo?: string
  symbol?: string
}

export interface FindArgs {
  name: string
  /** Pokémon: collector number. Yu-Gi-Oh!: set code or part of one. */
  number?: string
  total?: string // Pokémon printed set total
  trustName?: boolean
  setId?: string // restrict to one set
}

export interface GameAdapter {
  key: Game
  label: string
  /** What the "number" box should say for this game. */
  numberLabel: string
  numberPlaceholder: string
  getSets(): Promise<CatalogSet[]>
  getSetCards(setId: string, fresh?: boolean): Promise<CatalogCard[]>
  findCards(args: FindArgs): Promise<CatalogCard[]>
}

export const gameOf = (c: Pick<Collection, 'game'> | Pick<OwnedCard, 'game'>): Game => c.game ?? 'pokemon'

export function toOwned(c: CatalogCard, collectionId: string): OwnedCard {
  return {
    id: uid(),
    collectionId,
    cardId: c.id,
    name: c.name,
    setName: c.setName,
    number: c.number,
    rarity: c.rarity,
    image: c.image,
    price: c.price,
    qty: 1,
    addedAt: Date.now(),
    game: c.game,
    setId: c.setId,
  }
}
