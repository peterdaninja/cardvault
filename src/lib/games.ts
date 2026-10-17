import type { GameAdapter } from './catalog'
import { pokemon } from './pokemon'
import type { Game } from './types'
import { yugioh } from './ygo'

export const ADAPTERS: Record<Game, GameAdapter> = { pokemon, yugioh }
export const GAME_LIST: GameAdapter[] = [pokemon, yugioh]
export const adapterFor = (game: Game | undefined): GameAdapter => ADAPTERS[game ?? 'pokemon']
