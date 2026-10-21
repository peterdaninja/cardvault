import { get, set } from 'idb-keyval'
import type { CatalogCard } from './catalog'
import { EMBED_DIM, embed, loadModel, unit } from './embed'

/**
 * Recognise a card by its picture, instead of reading its text.
 *
 * For a collection tied to one set there are only about 100-300 possible cards. Each card's official
 * picture is run through a small picture-understanding model (see embed.ts) once and the result is
 * stored on the phone. A scanned card goes through the same model and is compared with all of them;
 * the closest one wins. This does not depend on reading small print, so glare does not hurt much.
 */

export interface ImageMatch {
  card: CatalogCard
  score: number // cosine similarity, 1 = same picture
}

export interface MatchResult {
  best: ImageMatch
  second: ImageMatch | null
  margin: number // how far the best is ahead of the runner-up
  top: ImageMatch[]
}

const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

export class SetMatcher {
  private cards: CatalogCard[]
  private vecs: Float32Array[] // centred on the set's average, so what all cards share (frame, layout) drops out
  private centre: Float32Array

  private constructor(cards: CatalogCard[], raw: Float32Array[]) {
    this.cards = cards
    this.centre = new Float32Array(EMBED_DIM)
    for (const v of raw) for (let i = 0; i < EMBED_DIM; i++) this.centre[i] += v[i] / raw.length
    this.vecs = raw.map((v) => this.centred(v))
  }

  private centred(v: Float32Array) {
    return unit(v.map((x, i) => x - this.centre[i]))
  }

  get size() {
    return this.vecs.length
  }

  /** Rank all cards of the set against an already-computed embedding. */
  rank(raw: Float32Array): MatchResult | null {
    if (!this.vecs.length) return null
    const probe = this.centred(raw)
    const scored = this.cards.map((card, i) => ({ card, score: dot(probe, this.vecs[i]) }))
    scored.sort((a, b) => b.score - a.score)
    const best = scored[0]
    const second = scored[1] ?? null
    return { best, second, margin: second ? best.score - second.score : best.score, top: scored.slice(0, 5) }
  }

  /** Compare a photographed card (cropped to the card) with every card in the set. */
  async match(photo: CanvasImageSource): Promise<MatchResult | null> {
    if (!this.vecs.length) return null
    return this.rank(await embed(photo))
  }

  /**
   * Embed a set's cards. Pictures are fetched once and the numbers are kept on the phone, so afterwards
   * this is instant and needs no internet.
   */
  static async build(setId: string, cards: CatalogCard[], onProgress?: (done: number, total: number) => void): Promise<SetMatcher> {
    const KEY = `imgemb-v2-art-dinov2s-${setId}`
    let stored: Record<string, Float32Array> = {}
    try {
      stored = (await get<Record<string, Float32Array>>(KEY)) ?? {}
    } catch {
      /* storage unavailable: build from scratch each time */
    }

    if (cards.some((c) => !stored[c.id])) await loadModel() // fail early if the model files cannot be fetched
    const todo = cards.filter((c) => !stored[c.id] || stored[c.id].length !== EMBED_DIM)
    let done = cards.length - todo.length
    onProgress?.(done, cards.length)

    // Fetch pictures a few at a time, but run the model one at a time (it is the slow part).
    let next = 0
    let fetchedCount = 0
    const loaders = Array.from({ length: Math.min(4, todo.length) }, async () => {
      while (next < todo.length) {
        const card = todo[next++]
        try {
          const img = await loadImage(card.image)
          stored[card.id] = await embed(img)
        } catch {
          /* this card's picture could not be loaded; it just won't be matchable by picture */
        }
        fetchedCount++
        onProgress?.(++done, cards.length)
        if (fetchedCount % 40 === 0) await set(KEY, stored).catch(() => {})
      }
    })
    await Promise.all(loaders)
    if (todo.length) await set(KEY, stored).catch(() => {})

    const usable = cards.filter((c) => stored[c.id])
    return new SetMatcher(
      usable,
      usable.map((c) => stored[c.id]),
    )
  }

  /** For tests: build straight from already-loaded pictures. */
  static async fromImages(items: { card: CatalogCard; img: CanvasImageSource }[]) {
    const vecs: Float32Array[] = []
    for (const i of items) vecs.push(await embed(i.img))
    return new SetMatcher(
      items.map((i) => i.card),
      vecs,
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
