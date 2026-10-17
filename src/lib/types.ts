export type Game = 'pokemon' | 'yugioh'

export interface Collection {
  game?: Game // missing on older data, which is all Pokémon
  id: string
  name: string
  createdAt: number
  setId?: string // when set, searches in this collection only look inside that set
  setName?: string
  setTotal?: number // printed card count of the set
  setLogo?: string
}

export interface OwnedCard {
  id: string
  collectionId: string
  cardId: string // Pokémon TCG API id, e.g. "base1-4"
  name: string
  setName: string
  number: string
  rarity: string
  image: string
  price: number | null // USD market price, if known
  qty: number
  addedAt: number
  game?: Game // missing on older cards, which are all Pokémon
  setId?: string // set id within the game (derived from cardId on older cards)
}

/** One point on the collection-value chart. */
export interface Snapshot {
  t: number // ms since epoch
  value: number // total USD value of everything owned
  count: number // total cards owned (including duplicates)
}

export interface AppState {
  collections: Collection[]
  cards: OwnedCard[]
  history?: Snapshot[]
  pricesUpdatedAt?: number
}

export interface TcgCard {
  id: string
  name: string
  number: string
  rarity?: string
  set: {
    id?: string
    name: string
    printedTotal?: number
    total?: number
    releaseDate?: string
    images?: { logo?: string; symbol?: string }
  }
  images: { small: string; large: string }
  tcgplayer?: { prices?: Record<string, { market?: number | null }> }
}
