import {
  changedFraction,
  changedFractionIn,
  detectCardBox,
  meanDiff,
  refineCardBox,
  textureIn,
  type Box,
  type FrameSig,
} from './frame'

export const PRESENT_FRACTION = 0.012 // (searching mode) this share of the frame differs from the empty mount
export const CHANGED_IN_CARD = 0.15 // (searching mode) this share of the captured card area changed
export const STABLE_DIFF = 3 // (searching mode) // average frame-to-frame difference below this => holding still
export const STABLE_TICKS = 4 // ...for this many frames (about 0.6s) before capturing

// Fixed-frame mode: watch one rectangle where the mount always holds the card.
export const STABLE_PIXEL_DIFF = 22 // a pixel counts as moved if it changed by more than this after exposure is levelled out
export const STABLE_CHANGED = 0.04 // still = fewer than this share of the frame's pixels moved since the last look
export const FORCE_AFTER_TICKS = 16 // a card that has been there this long (about 2.4s) is scanned even if it never looks still
export const FIXED_PRESENT = 0.3 // this share of the frame region changed since the empty mount...
export const FIXED_DETAIL_RATIO = 1.8 // ...and it has this much more fine detail than the empty region
export const FIXED_DETAIL_MIN = 2
export const FIXED_OCCUPIED_DETAIL = 11 // an "empty" frame with this much fine detail probably had a card in it
export const FIXED_ABS_DETAIL = 12 // ...in which case a new card is recognised by its own detail instead
export const FIXED_SWAPPED = 0.4 // this share changed since the captured card => a different card

export type TrackState =
  | 'empty' // nothing on the mount
  | 'moving' // something is there but still moving (a card sliding in, a hand)
  | 'holding' // a card is there and settling
  | 'capture' // settled long enough: take the picture now
  | 'waiting' // already captured this card; waiting for it to be removed or swapped

export interface TrackResult {
  state: TrackState
  box: Box | null // where the card is, if known
}

/**
 * Watches camera frames from a mounted phone and decides when to take a picture: once, when a card
 * has arrived and stopped moving, and again only after it has been removed or replaced.
 *
 * With a fixed frame it only looks inside that rectangle, so sunlight or shadows elsewhere in the
 * picture cannot fool it. Without one it searches the whole picture for the card.
 */
export class CardTracker {
  private baseline: FrameSig | null = null
  private baselineDetail = 0
  private captured: FrameSig | null = null
  private capturedBox: Box | null = null
  private last: FrameSig | null = null
  private armed = true
  private stable = 0
  private presentTicks = 0
  private fixed: Box | null = null

  get ready() {
    return !!this.baseline
  }

  /** Watch only this rectangle (frame fractions), or null to search the whole picture. */
  setFixed(box: Box | null) {
    this.fixed = box
    if (this.baseline && box) this.baselineDetail = textureIn(this.baseline, box)
  }

  /** Start over from a frame of the empty mount. */
  reset(emptyMount: FrameSig) {
    this.baseline = emptyMount
    this.baselineDetail = this.fixed ? textureIn(emptyMount, this.fixed) : 0
    this.captured = null
    this.last = null
    this.armed = true
    this.stable = 0
    this.presentTicks = 0
  }

  /** The picture was taken (automatically or by hand): don't take another until the card changes. */
  markCaptured(frame: FrameSig, box: Box | null = null) {
    this.captured = frame
    this.capturedBox = box
    this.armed = false
    this.stable = 0
    this.presentTicks = 0
  }

  /** Where the card really is, close to the fixed frame (it is not always seated in exactly the same spot). */
  refine(frame: FrameSig): Box | null {
    return this.baseline && this.fixed ? refineCardBox(frame, this.baseline, this.fixed) : this.fixed
  }

  /** Where a card is in this frame, searching the whole picture against the empty mount. */
  find(frame: FrameSig): Box | null {
    return this.baseline ? detectCardBox(frame, this.baseline) : null
  }

  /** True when the learned "empty mount" looks like it actually had a card in it. */
  get baselineOccupied() {
    return this.baselineDetail >= FIXED_OCCUPIED_DETAIL
  }

  /** Is there a card in the fixed frame right now? */
  private presentInFixed(frame: FrameSig): boolean {
    if (!this.baseline || !this.fixed) return false
    if (changedFractionIn(frame, this.baseline, this.fixed) < FIXED_PRESENT) return false
    const detail = textureIn(frame, this.fixed)
    if (detail >= this.baselineDetail * FIXED_DETAIL_RATIO + FIXED_DETAIL_MIN) return true
    // If the "empty" picture had a card in it, a new card cannot be more detailed than that; judge it by its own detail.
    return this.baselineDetail >= FIXED_OCCUPIED_DETAIL && detail >= FIXED_ABS_DETAIL
  }

  update(frame: FrameSig): TrackResult {
    if (!this.baseline) return { state: 'empty', box: null }
    return this.fixed ? this.updateFixed(frame, this.fixed) : this.updateSearching(frame)
  }

  private updateFixed(frame: FrameSig, box: Box): TrackResult {
    // Moved = how much of the frame changed since the last look. Judged after levelling out overall
    // brightness, so flicker, exposure changes and shimmering foil do not count as movement.
    const movedFraction = this.last ? changedFractionIn(frame, this.last, box, STABLE_PIXEL_DIFF) : 1
    this.last = frame
    const present = this.presentInFixed(frame)

    if (!this.armed) {
      // Re-arm when the card is taken away, or a clearly different card is put in its place.
      // Shifting sunlight over the same card changes some pixels but not that many.
      const swapped = !!this.captured && present && changedFractionIn(frame, this.captured, box) > FIXED_SWAPPED
      if (!present || swapped) {
        this.armed = true
        this.stable = 0
      } else {
        return { state: 'waiting', box }
      }
    }

    if (!present) {
      this.stable = 0
      this.presentTicks = 0
      return { state: 'empty', box }
    }
    this.presentTicks++
    this.stable = movedFraction < STABLE_CHANGED ? this.stable + 1 : 0
    if (this.stable >= STABLE_TICKS || this.presentTicks >= FORCE_AFTER_TICKS) return { state: 'capture', box }
    return { state: this.stable > 0 ? 'holding' : 'moving', box }
  }

  private updateSearching(frame: FrameSig): TrackResult {
    const prevDiff = this.last ? meanDiff(frame, this.last) : 99
    this.last = frame

    if (!this.armed) {
      // Only the card's own area counts, so a hand reaching in next to it doesn't trigger a second scan.
      const moved = this.captured
        ? this.capturedBox
          ? changedFractionIn(frame, this.captured, this.capturedBox) > CHANGED_IN_CARD
          : changedFraction(frame, this.captured) > 0.05
        : false
      if (moved) {
        this.armed = true // the card was taken away or swapped
        this.stable = 0
      } else {
        return { state: 'waiting', box: null }
      }
    }

    if (changedFraction(frame, this.baseline!) <= PRESENT_FRACTION) {
      this.stable = 0
      return { state: 'empty', box: null }
    }

    const box = this.find(frame)
    if (!box) {
      // Something changed but it doesn't look like a card (a hand, a shadow): keep waiting.
      this.stable = 0
      return { state: 'moving', box: null }
    }
    this.stable = prevDiff < STABLE_DIFF ? this.stable + 1 : 0
    if (this.stable >= STABLE_TICKS) return { state: 'capture', box }
    return { state: this.stable > 0 ? 'holding' : 'moving', box }
  }
}
