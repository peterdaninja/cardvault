import { changedFraction, changedFractionIn, detectCardBox, meanDiff, type Box, type FrameSig } from './frame'

export const PRESENT_FRACTION = 0.012 // this share of the frame differs from the empty mount => something is there
export const CHANGED_IN_CARD = 0.15 // this share of the captured card area changed => it was removed or swapped
export const STABLE_DIFF = 3 // average frame-to-frame difference below this => holding still
export const STABLE_TICKS = 4 // ...for this many frames (about 0.6s) before capturing

export type TrackState =
  | 'empty' // nothing on the mount
  | 'moving' // something is there but still moving (a card sliding in, a hand)
  | 'holding' // a card is there and settling
  | 'capture' // settled long enough: take the picture now
  | 'waiting' // already captured this card; waiting for it to be removed or swapped

export interface TrackResult {
  state: TrackState
  box: Box | null // where the card was found in the frame, if it could be
}

/**
 * Watches camera frames from a mounted phone and decides when to take a picture: once, when a card
 * has arrived and stopped moving, and again only after it has been removed or replaced.
 */
export class CardTracker {
  private baseline: FrameSig | null = null
  private captured: FrameSig | null = null
  private capturedBox: Box | null = null
  private last: FrameSig | null = null
  private armed = true
  private stable = 0

  get ready() {
    return !!this.baseline
  }

  /** Start over from a frame of the empty mount. */
  reset(emptyMount: FrameSig) {
    this.baseline = emptyMount
    this.captured = null
    this.last = null
    this.armed = true
    this.stable = 0
  }

  /** The picture was taken (automatically or by hand): don't take another until the card changes. */
  markCaptured(frame: FrameSig, box: Box | null = null) {
    this.captured = frame
    this.capturedBox = box
    this.armed = false
    this.stable = 0
  }

  /** Where a card is in this frame, using the empty mount as the reference. */
  find(frame: FrameSig): Box | null {
    return this.baseline ? detectCardBox(frame, this.baseline) : null
  }

  update(frame: FrameSig): TrackResult {
    if (!this.baseline) return { state: 'empty', box: null }
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

    if (changedFraction(frame, this.baseline) <= PRESENT_FRACTION) {
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
