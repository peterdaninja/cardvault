/** Map the on-screen guide rectangle back to pixel coordinates of the video frame (object-fit: cover). */
function guideRect(video: HTMLVideoElement, box: HTMLElement, guide: HTMLElement) {
  const b = box.getBoundingClientRect()
  const g = guide.getBoundingClientRect()
  const scale = Math.max(b.width / video.videoWidth, b.height / video.videoHeight)
  const offX = (video.videoWidth * scale - b.width) / 2
  const offY = (video.videoHeight * scale - b.height) / 2
  return {
    sx: (g.left - b.left + offX) / scale,
    sy: (g.top - b.top + offY) / scale,
    sw: g.width / scale,
    sh: g.height / scale,
  }
}

/** Full-resolution crop of whatever is inside the guide. */
export function cropGuide(video: HTMLVideoElement, box: HTMLElement, guide: HTMLElement) {
  if (!video.videoWidth) return null
  const { sx, sy, sw, sh } = guideRect(video, box, guide)
  const out = document.createElement('canvas')
  out.width = Math.round(sw)
  out.height = Math.round(sh)
  out.getContext('2d')!.drawImage(video, sx, sy, sw, sh, 0, 0, out.width, out.height)
  return out
}

const SIG_W = 32
const SIG_H = 44
let sigCanvas: HTMLCanvasElement | null = null

/** Tiny grayscale thumbnail of the guide area, for cheap "did anything change" comparisons. */
export function guideSignature(video: HTMLVideoElement, box: HTMLElement, guide: HTMLElement) {
  if (!video.videoWidth) return null
  const { sx, sy, sw, sh } = guideRect(video, box, guide)
  sigCanvas ??= Object.assign(document.createElement('canvas'), { width: SIG_W, height: SIG_H })
  const ctx = sigCanvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, SIG_W, SIG_H)
  const px = ctx.getImageData(0, 0, SIG_W, SIG_H).data
  const sig = new Uint8Array(SIG_W * SIG_H)
  for (let i = 0; i < sig.length; i++) {
    sig[i] = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000
  }
  return sig
}

/** Mean absolute difference between two signatures, 0 (identical) to 255. */
export function sigDiff(a: Uint8Array, b: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return sum / a.length
}

export function beep(freq = 880, ms = 120) {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    osc.frequency.value = freq
    osc.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + ms / 1000)
    osc.onended = () => ctx.close()
  } catch {
    /* audio blocked or unavailable; the on-screen status still updates */
  }
}

// ───────── Whole-frame comparison: find a card without needing it to sit in a fixed outline ─────────

/** A small grayscale copy of a whole camera frame, for cheap comparisons. */
export interface FrameSig {
  px: Uint8Array
  w: number
  h: number
}

/** A rectangle as fractions of the frame (0 to 1). */
export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

const SIG_WIDTH = 64
let frameCanvas: HTMLCanvasElement | null = null

export function frameSignatureOf(source: CanvasImageSource, srcW: number, srcH: number): FrameSig | null {
  if (!srcW || !srcH) return null
  const w = SIG_WIDTH
  const h = Math.max(8, Math.round((SIG_WIDTH * srcH) / srcW))
  frameCanvas ??= document.createElement('canvas')
  frameCanvas.width = w
  frameCanvas.height = h
  const ctx = frameCanvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(source, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  const px = new Uint8Array(w * h)
  for (let i = 0; i < px.length; i++) px[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000
  return { px, w, h }
}

export const frameSignature = (video: HTMLVideoElement) => frameSignatureOf(video, video.videoWidth, video.videoHeight)

/** Mean absolute brightness difference between two frames (0 = identical). */
export function meanDiff(a: FrameSig, b: FrameSig): number {
  if (a.px.length !== b.px.length) return 255
  let sum = 0
  for (let i = 0; i < a.px.length; i++) sum += Math.abs(a.px[i] - b.px[i])
  return sum / a.px.length
}

/** Per-pixel difference with any overall brightness shift (auto-exposure) removed. */
function diffMask(cur: FrameSig, base: FrameSig, thresh: number): Uint8Array | null {
  if (cur.px.length !== base.px.length) return null
  const n = cur.px.length
  // Auto-exposure shifts the whole picture's brightness a little. Measure that from the outer edge of
  // the frame, where a card rarely reaches (the middle would be the card itself when it fills the view).
  const bins = new Uint32Array(511)
  let ring = 0
  const mx = Math.max(1, Math.round(cur.w * 0.08))
  const my = Math.max(1, Math.round(cur.h * 0.06))
  for (let y = 0; y < cur.h; y++) {
    for (let x = 0; x < cur.w; x++) {
      if (x < mx || x >= cur.w - mx || y < my || y >= cur.h - my) {
        const i = y * cur.w + x
        bins[cur.px[i] - base.px[i] + 255]++
        ring++
      }
    }
  }
  let acc = 0
  let median = 0
  for (let b = 0; b < 511; b++) {
    acc += bins[b]
    if (acc >= ring / 2) {
      median = b - 255
      break
    }
  }
  median = Math.max(-25, Math.min(25, median)) // real exposure drift is small; never let it swallow a card
  const mask = new Uint8Array(n)
  for (let i = 0; i < n; i++) mask[i] = Math.abs(cur.px[i] - base.px[i] - median) > thresh ? 1 : 0
  return mask
}

/** Fraction of the frame that differs from a reference (how much of the view has changed). */
export function changedFraction(cur: FrameSig, base: FrameSig, thresh = 28): number {
  const mask = diffMask(cur, base, thresh)
  if (!mask) return 1
  let c = 0
  for (let i = 0; i < mask.length; i++) c += mask[i]
  return c / mask.length
}

const CARD_ASPECT = 63 / 88

/**
 * Find the card by what changed since the empty-mount frame. Returns its rectangle, widened to
 * the card's proportions, or null when the change doesn't look like a single card.
 */
export function detectCardBox(cur: FrameSig, base: FrameSig): Box | null {
  const mask = diffMask(cur, base, 28)
  if (!mask) return null
  const { w, h } = cur
  const rows = new Float32Array(h)
  const cols = new Float32Array(w)
  let total = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        rows[y]++
        cols[x]++
        total++
      }
    }
  }
  if (total < w * h * 0.04) return null

  // The card is where a good share of each row/column changed; stray specks and hands at the edge fall below that.
  const span = (counts: Float32Array, len: number): [number, number] | null => {
    const peak = Math.max(...counts)
    if (peak < len * 0.2) return null
    const cut = peak * 0.5
    let lo = 0
    let hi = counts.length - 1
    while (lo < hi && counts[lo] < cut) lo++
    while (hi > lo && counts[hi] < cut) hi--
    return [lo, hi]
  }
  const sy = span(rows, w)
  const sx = span(cols, h)
  if (!sx || !sy) return null

  let x0 = sx[0]
  let x1 = sx[1] + 1
  let y0 = sy[0]
  let y1 = sy[1] + 1
  const bw = x1 - x0
  const bh = y1 - y0

  // It must look like a card: portrait, of a sensible size, mostly filled with change.
  const aspect = bw / bh
  if (aspect < 0.5 || aspect > 1.0) return null
  if ((bw * bh) / (w * h) < 0.06) return null
  let inside = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) inside += mask[y * w + x]
  if (inside / (bw * bh) < 0.4) return null

  // Edges of dark card borders can be missed, so widen the short side to the card's proportions.
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  let nw = Math.max(bw, bh * CARD_ASPECT)
  let nh = Math.max(bh, bw / CARD_ASPECT)
  nw *= 1.05
  nh *= 1.05
  x0 = Math.max(0, cx - nw / 2)
  x1 = Math.min(w, cx + nw / 2)
  y0 = Math.max(0, cy - nh / 2)
  y1 = Math.min(h, cy + nh / 2)
  return { x0: x0 / w, y0: y0 / h, x1: x1 / w, y1: y1 / h }
}

/** Full-resolution crop of a detected card rectangle. */
export function cropBox(video: HTMLVideoElement, box: Box): HTMLCanvasElement | null {
  if (!video.videoWidth) return null
  const sx = box.x0 * video.videoWidth
  const sy = box.y0 * video.videoHeight
  const sw = (box.x1 - box.x0) * video.videoWidth
  const sh = (box.y1 - box.y0) * video.videoHeight
  const out = document.createElement('canvas')
  out.width = Math.round(sw)
  out.height = Math.round(sh)
  out.getContext('2d')!.drawImage(video, sx, sy, sw, sh, 0, 0, out.width, out.height)
  return out
}

/** Where a frame-fraction box lands on screen when the video fills its container with object-fit: cover. */
export function boxToScreen(box: Box, container: DOMRect, vw: number, vh: number) {
  const scale = Math.max(container.width / vw, container.height / vh)
  const offX = (vw * scale - container.width) / 2
  const offY = (vh * scale - container.height) / 2
  return {
    left: box.x0 * vw * scale - offX,
    top: box.y0 * vh * scale - offY,
    width: (box.x1 - box.x0) * vw * scale,
    height: (box.y1 - box.y0) * vh * scale,
  }
}
