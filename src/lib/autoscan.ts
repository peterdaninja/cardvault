import { changedFraction, detectCardBox, meanDiff, type Box, type FrameSig } from './frame'

export const PRESENT_FRACTION = 0.06 // this share of the frame differs from the empty mount => something is there
export const CHANGED_FRACTION = 0.06 // this share differs from the last captured card => it was removed or swapped
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
  markCaptured(frame: FrameSig) {
    this.captured = frame
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
      if (this.captured && changedFraction(frame, this.captured) > CHANGED_FRACTION) {
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
    this.stable = prevDiff < STABLE_DIFF ? this.stable + 1 : 0
    if (this.stable >= STABLE_TICKS) return { state: 'capture', box }
    return { state: this.stable > 0 ? 'holding' : 'moving', box }
  }
}
