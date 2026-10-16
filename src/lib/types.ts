export interface Collection {
  id: string
  name: string
  createdAt: number
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
}

export interface AppState {
  collections: Collection[]
  cards: OwnedCard[]
}

export interface TcgCard {
  id: string
  name: string
  number: string
  rarity?: string
  set: { name: string; printedTotal?: number; releaseDate?: string }
  images: { small: string; large: string }
  tcgplayer?: { prices?: Record<string, { market?: number | null }> }
}
