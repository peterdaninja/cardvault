import { get, set } from 'idb-keyval'
import type { CatalogCard } from './catalog'

/**
 * Recognise a card by its artwork, instead of reading its text.
 *
 * For a collection tied to one set there are only about 100-300 possible cards, so a rough comparison
 * of the artwork is enough to tell them apart, and it is not thrown off by glare on small print.
 * Each card in the set is turned into a small fingerprint of its artwork (once, then stored on the
 * phone). A scanned card gets the same fingerprint and is compared with all of them.
 */

// Where the artwork sits on a card, as fractions of the card. The same region is used on the official
// picture and on the photo, so small differences between card layouts do not matter.
const ART = { x0: 0.1, y0: 0.08, x1: 0.9, y1: 0.46 }
const GW = 24 // brightness grid
const GH = 16
const CW = 6 // color grid
const CH = 4
const CHROMA_WEIGHT = 0.25
const SHIFTS = [-0.025, 0, 0.025] // the photo may be cropped a little off, so also try small shifts

export interface Fingerprint {
  luma: Float32Array // zero-mean, unit-length
  chroma: Float32Array
}

function normalise(v: Float32Array): Float32Array {
  let mean = 0
  for (let i = 0; i < v.length; i++) mean += v[i]
  mean /= v.length
  let norm = 0
  for (let i = 0; i < v.length; i++) {
    v[i] -= mean
    norm += v[i] * v[i]
  }
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < v.length; i++) v[i] /= norm
  return v
}

let scratch: HTMLCanvasElement | null = null

/** Draw part of a canvas/image into a w×h grid and return its RGB pixels. */
function grid(src: CanvasImageSource, sw: number, sh: number, sx: number, sy: number, cw: number, ch: number, w: number, h: number) {
  scratch ??= document.createElement('canvas')
  scratch.width = w
  scratch.height = h
  const ctx = scratch.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // Shrink in a couple of steps so averaging (not skipping) picks the pixel values.
  ctx.drawImage(src, Math.max(0, sx), Math.max(0, sy), Math.min(cw, sw - Math.max(0, sx)), Math.min(ch, sh - Math.max(0, sy)), 0, 0, w, h)
  void sw
  void sh
  return ctx.getImageData(0, 0, w, h).data
}

/** Fingerprint of the artwork of a card picture, optionally nudged by a fraction of the card size. */
export function fingerprint(card: CanvasImageSource & { width: number; height: number }, dx = 0, dy = 0): Fingerprint {
  const W = card.width
  const H = card.height
  const sx = (ART.x0 + dx) * W
  const sy = (ART.y0 + dy) * H
  const cw = (ART.x1 - ART.x0) * W
  const ch = (ART.y1 - ART.y0) * H

  const a = grid(card, W, H, sx, sy, cw, ch, GW, GH)
  const luma = new Float32Array(GW * GH)
  for (let i = 0; i < luma.length; i++) luma[i] = (a[i * 4] * 299 + a[i * 4 + 1] * 587 + a[i * 4 + 2] * 114) / 1000

  const b = grid(card, W, H, sx, sy, cw, ch, CW, CH)
  const chroma = new Float32Array(CW * CH * 2)
  for (let i = 0; i < CW * CH; i++) {
    const r = b[i * 4]
    const g = b[i * 4 + 1]
    const bl = b[i * 4 + 2]
    chroma[i * 2] = r - g
    chroma[i * 2 + 1] = bl - (r + g) / 2
  }
  return { luma: normalise(luma), chroma: normalise(chroma) }
}

const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/** 1 = identical artwork, around 0 = unrelated. */
export function similarity(a: Fingerprint, b: Fingerprint): number {
  return (1 - CHROMA_WEIGHT) * dot(a.luma, b.luma) + CHROMA_WEIGHT * dot(a.chroma, b.chroma)
}

export interface ImageMatch {
  card: CatalogCard
  score: number
}

export interface MatchResult {
  best: ImageMatch
  second: ImageMatch | null
  margin: number // how far the best is ahead of the runner-up
  top: ImageMatch[]
}

export class SetMatcher {
  private cards: CatalogCard[]
  private prints: Fingerprint[]

  private constructor(cards: CatalogCard[], prints: Fingerprint[]) {
    this.cards = cards
    this.prints = prints
  }

  get size() {
    return this.prints.length
  }

  /** Compare a photographed card with every card in the set. */
  match(photo: HTMLCanvasElement): MatchResult | null {
    if (!this.prints.length) return null
    const probes = SHIFTS.flatMap((dy) => SHIFTS.map((dx) => fingerprint(photo, dx, dy)))
    const scored = this.cards.map((card, i) => ({ card, score: Math.max(...probes.map((p) => similarity(p, this.prints[i]))) }))
    scored.sort((a, b) => b.score - a.score)
    const best = scored[0]
    const second = scored[1] ?? null
    return { best, second, margin: second ? best.score - second.score : best.score, top: scored.slice(0, 5) }
  }

  /**
   * Build fingerprints for a set's cards. Pictures are fetched once and the fingerprints are kept on the
   * phone, so afterwards this is instant and needs no internet.
   */
  static async build(setId: string, cards: CatalogCard[], onProgress?: (done: number, total: number) => void): Promise<SetMatcher> {
    const KEY = `imgprint-v1-${setId}`
    type Stored = Record<string, { l: Float32Array; c: Float32Array }>
    let stored: Stored = {}
    try {
      stored = (await get<Stored>(KEY)) ?? {}
    } catch {
      /* storage unavailable: build from scratch each time */
    }

    const usable: CatalogCard[] = []
    const prints: Fingerprint[] = []
    const todo = cards.filter((c) => !stored[c.id])
    let done = cards.length - todo.length
    onProgress?.(done, cards.length)

    const pool = 6
    let next = 0
    await Promise.all(
      Array.from({ length: Math.min(pool, todo.length) }, async () => {
        while (next < todo.length) {
          const card = todo[next++]
          try {
            const img = await loadImage(card.image)
            const fp = fingerprint(img)
            stored[card.id] = { l: fp.luma, c: fp.chroma }
          } catch {
            /* this card's picture could not be loaded; it just won't be matchable by picture */
          }
          onProgress?.(++done, cards.length)
        }
      }),
    )
    if (todo.length) await set(KEY, stored).catch(() => {})

    for (const c of cards) {
      const s = stored[c.id]
      if (s) {
        usable.push(c)
        prints.push({ luma: s.l, chroma: s.c })
      }
    }
    return new SetMatcher(usable, prints)
  }

  /** For tests: build straight from already-loaded pictures. */
  static fromImages(items: { card: CatalogCard; img: HTMLImageElement | HTMLCanvasElement }[]) {
    return new SetMatcher(
      items.map((i) => i.card),
      items.map((i) => fingerprint(i.img as CanvasImageSource & { width: number; height: number })),
    )
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image failed'))
    img.src = url
  })
}
