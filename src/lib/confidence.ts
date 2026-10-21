import type { CatalogCard } from './catalog'
import { levenshtein, norm } from './names'
import type { ScanResult } from './scan'
import type { MatchResult } from './imagematch'
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

// How sure the picture match must be (cosine similarity after centring on the set, see imagematch.ts).
// Measured on the official 30th Celebration pictures damaged with blur, glare, low resolution, dimming, noise,
// tighter/looser crops and rotation: at these limits no wrong card passed and about 87% of the right ones did;
// the rest go to review. A real glary phone photo scored 0.63-0.78 with a lead of 0.23-0.40.
export const PICTURE_SCORE = 0.45
export const PICTURE_LEAD = 0.12
const PICTURE_STRONG_SCORE = 0.6
const PICTURE_STRONG_LEAD = 0.25

export interface Decision {
  pick: CatalogCard | null // add this one without asking
  candidates: CatalogCard[] // otherwise offer these, best first
}

/**
 * Decide what to do with a scan, using both what was read (text) and what the card looks like (picture).
 *  - Text and picture agree, or only one is available and sure: add it.
 *  - They strongly disagree, or neither is sure: ask, with the picture's best guesses first.
 */
export function decide(
  results: CatalogCard[],
  game: Game,
  scan: ScanResult,
  setLocked: boolean,
  picture: MatchResult | null,
): Decision {
  const textPick = confidentMatch(results, game, scan, setLocked)
  const pictureSure = !!picture && picture.best.score >= PICTURE_SCORE && picture.margin >= PICTURE_LEAD
  const pictureCards = picture ? picture.top.slice(0, 3).map((t) => t.card) : []
  const merge = (...lists: CatalogCard[][]) => {
    const seen = new Set<string>()
    return lists.flat().filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
  }

  if (textPick) {
    const strongDisagree =
      !!picture &&
      picture.best.card.id !== textPick.id &&
      picture.best.score >= PICTURE_STRONG_SCORE &&
      picture.margin >= PICTURE_STRONG_LEAD
    if (strongDisagree) return { pick: null, candidates: merge([picture!.best.card], [textPick], results) }
    return { pick: textPick, candidates: [] }
  }

  if (pictureSure) {
    // The text could not confirm it. Only refuse if it confidently named a clearly different card.
    const clash = scan.nameConfident && scan.name.length >= 4 && nameSim(scan.name, picture!.best.card.name) < 0.4
    if (!clash) return { pick: picture!.best.card, candidates: [] }
  }
  return { pick: null, candidates: merge(pictureCards, results) }
}
