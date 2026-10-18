import { scanCanvas, type ScanResult } from './ocr'
import { scanYgo } from './ocrYgo'
import type { Game } from './types'

export type { ScanResult }

/** Read a card photo that has been cropped to the card edges, using the right layout for the game. */
export function scanFor(
  game: Game,
  card: HTMLCanvasElement,
  onProgress?: (msg: string) => void,
  fast = false,
  /** Names of the cards in the collection's set, when it has one. */
  vocabulary?: string[],
): Promise<ScanResult> {
  return game === 'yugioh' ? scanYgo(card, onProgress, fast) : scanCanvas(card, onProgress, fast, vocabulary)
}
