import type { CatalogCard } from './catalog'
import { levenshtein, norm } from './names'
import type { ScanResult } from './scan'
import type { Game } from './types'

export const nameSim = (x: string, y: string) => {
  const a = norm(x)
  const b = norm(y)
  return a && b ? 1 - levenshtein(a, b) / Math.max(a.length, b.length) : 0
}

/**
 * Decide whether a scan found its card clearly enough to add it without asking.
 * Anything less returns null so the person gets to choose.
 *  - Pokémon: a confidently read name plus number that leads to exactly one card, or to one card
 *    whose set total agrees with the printed total. In a set-locked collection a number is unique.
 *  - Yu-Gi-Oh!: the set code must match a printing exactly, and the name must roughly agree.
 */
export function confidentMatch(
  results: CatalogCard[],
  game: Game,
  scan: ScanResult,
  setLocked: boolean,
): CatalogCard | null {
  if (!results.length) return null

  if (game === 'yugioh') {
    const r = results[0]
    if (!scan.number || r.number.toUpperCase() !== scan.number.toUpperCase()) return null
    const s = nameSim(scan.name, r.name)
    if (scan.name.length >= 4 && s < 0.5) return null // the code and the name disagree
    return scan.nameConfident || s >= 0.6 ? r : null
  }

  if (setLocked && results.length === 1) {
    // Inside one set a collector number, or a name, points to a single card.
    const r = results[0]
    const sim = nameSim(scan.name, r.name)
    if (scan.number) {
      if (scan.nameConfident || sim >= 0.6) return r
      // A number read twice is trustworthy; only refuse if a clearly different name was read.
      if (scan.numberConfident && (scan.name.length < 4 || sim >= 0.35)) return r
    } else if (scan.nameConfident) {
      return r
    }
  }
  if (!(scan.nameConfident && !!scan.number)) return null
  if (results.length === 1) return results[0]
  if (scan.total) {
    const sameTotal = results.filter((c) => String(c.setPrintedTotal) === scan.total)
    if (sameTotal.length === 1) return sameTotal[0]
  }
  return null
}
