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
  px: Uint8Array // brightness, one byte per pixel
  rgb: Uint8Array // color, three bytes per pixel, so a colorful card stands out from a grey wall
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
  const rgb = new Uint8Array(w * h * 3)
  for (let i = 0; i < px.length; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    px[i] = (r * 299 + g * 587 + b * 114) / 1000
    rgb[i * 3] = r
    rgb[i * 3 + 1] = g
    rgb[i * 3 + 2] = b
  }
  return { px, rgb, w, h }
}

export const frameSignature = (video: HTMLVideoElement) => frameSignatureOf(video, video.videoWidth, video.videoHeight)

/** Mean absolute brightness difference between two frames (0 = identical). */
export function meanDiff(a: FrameSig, b: FrameSig): number {
  if (a.px.length !== b.px.length) return 255
  let sum = 0
  for (let i = 0; i < a.px.length; i++) sum += Math.abs(a.px[i] - b.px[i])
  return sum / a.px.length
}

/**
 * Work out what auto-exposure did to the whole picture, as "now = gain * before + offset".
 * A bright card entering the view makes the camera darken everything. The static background all
 * shifts by the same ratio, while the card's pixels each change differently, so the most common
 * ratio between the two frames is the camera's doing, even when the card covers much of the view.
 */
function fitExposure(cur: FrameSig, base: FrameSig): { gain: number; offset: number } {
  const BINS = 80
  const LO = 0.4
  const STEP = 0.02
  const n = cur.px.length
  const hist = new Uint32Array(BINS)
  for (let i = 0; i < n; i++) {
    const bv = base.px[i]
    if (bv < 24) continue // too dark for a stable ratio
    const idx = Math.floor((cur.px[i] / bv - LO) / STEP)
    if (idx >= 0 && idx < BINS) hist[idx]++
  }
  let best = -1
  let bestCount = 0
  for (let i = 0; i < BINS; i++) {
    const c = (hist[i - 1] ?? 0) + hist[i] + (hist[i + 1] ?? 0)
    if (c > bestCount) {
      bestCount = c
      best = i
    }
  }
  if (best >= 0 && bestCount >= 200) {
    const gain = LO + (best + 0.5) * STEP
    const resid: number[] = []
    for (let i = 0; i < n; i++) {
      const bv = base.px[i]
      if (bv >= 24 && Math.abs(cur.px[i] / bv - gain) < 0.08) resid.push(cur.px[i] - gain * bv)
    }
    resid.sort((x, y) => x - y)
    return { gain, offset: resid.length ? resid[Math.floor(resid.length / 2)] : 0 }
  }
  // A very dark scene: no bright background to measure from, so just correct the overall brightness.
  const diffs: number[] = []
  for (let i = 0; i < n; i += 3) diffs.push(cur.px[i] - base.px[i])
  diffs.sort((x, y) => x - y)
  return { gain: 1, offset: Math.max(-40, Math.min(40, diffs[Math.floor(diffs.length / 2)] ?? 0)) }
}

function diffMask(cur: FrameSig, base: FrameSig, thresh: number): Uint8Array | null {
  if (cur.px.length !== base.px.length) return null
  const n = cur.px.length
  const { gain, offset } = fitExposure(cur, base)
  const mask = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    // The biggest change in any color channel, so a card that matches the wall in brightness still shows up.
    const j = i * 3
    const dr = Math.abs(cur.rgb[j] - (gain * base.rgb[j] + offset))
    const dg = Math.abs(cur.rgb[j + 1] - (gain * base.rgb[j + 1] + offset))
    const db = Math.abs(cur.rgb[j + 2] - (gain * base.rgb[j + 2] + offset))
    mask[i] = Math.max(dr, dg, db) > thresh ? 1 : 0
  }
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

/** Fraction of a rectangle (frame fractions) that differs from a reference. */
export function changedFractionIn(cur: FrameSig, base: FrameSig, box: Box, thresh = 28): number {
  const mask = diffMask(cur, base, thresh)
  if (!mask) return 1
  const x0 = Math.floor(box.x0 * cur.w)
  const x1 = Math.max(x0 + 1, Math.ceil(box.x1 * cur.w))
  const y0 = Math.floor(box.y0 * cur.h)
  const y1 = Math.max(y0 + 1, Math.ceil(box.y1 * cur.h))
  let changed = 0
  let total = 0
  for (let y = y0; y < y1 && y < cur.h; y++) {
    for (let x = x0; x < x1 && x < cur.w; x++) {
      changed += mask[y * cur.w + x]
      total++
    }
  }
  return total ? changed / total : 0
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
  if (total < w * h * 0.01) return null

  // The card is where a good share of each row/column changed; stray specks and hands at the edge fall below that.
  const span = (counts: Float32Array, len: number): [number, number] | null => {
    const peak = Math.max(...counts)
    if (peak < len * 0.08) return null
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
  const area = (bw * bh) / (w * h)
  if (area < 0.012 || area > 0.92) return null // too small to be a card, or the whole view changed
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

const MAX_CROP_SIDE = 2200

/** Copy part of the video into a canvas, capped in size so a huge region can never make a blank canvas. */
function drawCrop(video: HTMLVideoElement, sx: number, sy: number, sw: number, sh: number): HTMLCanvasElement | null {
  const scale = Math.min(1, MAX_CROP_SIDE / Math.max(sw, sh))
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(sw * scale))
  out.height = Math.max(1, Math.round(sh * scale))
  const ctx = out.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, out.width, out.height)
  return out
}

/** Crop of a detected card rectangle, at full resolution up to a sensible cap. */
export function cropBox(video: HTMLVideoElement, box: Box): HTMLCanvasElement | null {
  if (!video.videoWidth) return null
  return drawCrop(
    video,
    box.x0 * video.videoWidth,
    box.y0 * video.videoHeight,
    (box.x1 - box.x0) * video.videoWidth,
    (box.y1 - box.y0) * video.videoHeight,
  )
}

/** A sensible card-shaped crop from the middle of the frame, for when no card could be found. */
export function cropCenter(video: HTMLVideoElement): HTMLCanvasElement | null {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw) return null
  let cw = vw * 0.8
  let ch = cw / CARD_ASPECT
  if (ch > vh * 0.95) {
    ch = vh * 0.95
    cw = ch * CARD_ASPECT
  }
  return drawCrop(video, (vw - cw) / 2, (vh - ch) / 2, cw, ch)
}

/** True when a canvas came back empty or fully black (a failed draw), not just a dark picture. */
export function isBlank(canvas: HTMLCanvasElement): boolean {
  const probe = document.createElement('canvas')
  probe.width = 24
  probe.height = 24
  const ctx = probe.getContext('2d', { willReadFrequently: true })
  if (!ctx) return true
  ctx.drawImage(canvas, 0, 0, 24, 24)
  const d = ctx.getImageData(0, 0, 24, 24).data
  let lum = 0
  let lo = 255
  let hi = 0
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] + d[i + 1] + d[i + 2]) / 3
    lum += v
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  return d[3] === 0 || (lum / (d.length / 4) < 3 && hi - lo < 3)
}

/**
 * Where a frame-fraction box lands on screen. With 'contain' the whole video is visible (letterboxed);
 * with 'cover' it fills the container and the edges are cropped away.
 */
export function boxToScreen(box: Box, container: DOMRect, vw: number, vh: number, fit: 'cover' | 'contain' = 'cover') {
  const scale = fit === 'contain' ? Math.min(container.width / vw, container.height / vh) : Math.max(container.width / vw, container.height / vh)
  const offX = (container.width - vw * scale) / 2
  const offY = (container.height - vh * scale) / 2
  return {
    left: box.x0 * vw * scale + offX,
    top: box.y0 * vh * scale + offY,
    width: (box.x1 - box.x0) * vw * scale,
    height: (box.y1 - box.y0) * vh * scale,
  }
}

// ───────── Watching one fixed region (for a mount where cards always sit in the same place) ─────────

const clampIdx = (v: number, max: number) => Math.max(0, Math.min(max, v))

function region(sig: FrameSig, box: Box) {
  return {
    x0: clampIdx(Math.floor(box.x0 * sig.w), sig.w - 1),
    x1: clampIdx(Math.ceil(box.x1 * sig.w), sig.w),
    y0: clampIdx(Math.floor(box.y0 * sig.h), sig.h - 1),
    y1: clampIdx(Math.ceil(box.y1 * sig.h), sig.h),
  }
}

/** Mean absolute brightness difference between two frames inside one rectangle. */
export function meanDiffIn(a: FrameSig, b: FrameSig, box: Box): number {
  if (a.px.length !== b.px.length) return 255
  const r = region(a, box)
  let sum = 0
  let n = 0
  for (let y = r.y0; y < r.y1; y++) {
    for (let x = r.x0; x < r.x1; x++) {
      sum += Math.abs(a.px[y * a.w + x] - b.px[y * a.w + x])
      n++
    }
  }
  return n ? sum / n : 0
}

/**
 * How much fine detail is inside a rectangle (average brightness step between neighbouring pixels).
 * A card's printed artwork is full of detail; bare metal and soft patches of sunlight are not.
 */
export function textureIn(sig: FrameSig, box: Box): number {
  const r = region(sig, box)
  let sum = 0
  let n = 0
  for (let y = r.y0; y < r.y1 - 1; y++) {
    for (let x = r.x0; x < r.x1 - 1; x++) {
      const i = y * sig.w + x
      sum += Math.abs(sig.px[i] - sig.px[i + 1]) + Math.abs(sig.px[i] - sig.px[i + sig.w])
      n++
    }
  }
  return n ? sum / n : 0
}

/**
 * The card is not always seated exactly where the frame was drawn. Look just around the frame for
 * where the card really is (what changed since the empty mount) and return that, widened to card
 * proportions. Falls back to the frame itself whenever the result is not clearly a card of the
 * same size, so this can only help.
 */
export function refineCardBox(cur: FrameSig, base: FrameSig, frame: Box, margin = 0.08): Box {
  const mask = diffMask(cur, base, 28)
  if (!mask) return frame
  const fw = frame.x1 - frame.x0
  const fh = frame.y1 - frame.y0
  const R = {
    x0: Math.max(0, frame.x0 - fw * margin),
    x1: Math.min(1, frame.x1 + fw * margin),
    y0: Math.max(0, frame.y0 - fh * margin),
    y1: Math.min(1, frame.y1 + fh * margin),
  }
  const { w, h } = cur
  const px0 = Math.floor(R.x0 * w)
  const px1 = Math.ceil(R.x1 * w)
  const py0 = Math.floor(R.y0 * h)
  const py1 = Math.ceil(R.y1 * h)
  const rows = new Float32Array(py1 - py0)
  const cols = new Float32Array(px1 - px0)
  for (let y = py0; y < py1; y++) {
    for (let x = px0; x < px1; x++) {
      if (mask[y * w + x]) {
        rows[y - py0]++
        cols[x - px0]++
      }
    }
  }
  const span = (counts: Float32Array): [number, number] | null => {
    const peak = Math.max(...counts)
    if (peak < counts.length * 0.12) return null
    const cut = peak * 0.5
    let lo = 0
    let hi = counts.length - 1
    while (lo < hi && counts[lo] < cut) lo++
    while (hi > lo && counts[hi] < cut) hi--
    return [lo, hi]
  }
  const sx = span(cols)
  const sy = span(rows)
  if (!sx || !sy) return frame
  let x0 = (px0 + sx[0]) / w
  let x1 = (px0 + sx[1] + 1) / w
  let y0 = (py0 + sy[0]) / h
  let y1 = (py0 + sy[1] + 1) / h
  const bw = x1 - x0
  const bh = y1 - y0
  // It must be about the size of the frame: otherwise something else changed (a hand, a shadow).
  if (bw < fw * 0.9 || bw > fw * 1.1 || bh < fh * 0.9 || bh > fh * 1.1) return frame
  // ...and sit close to where the frame is. The frame is what the user lined up, so only allow a small nudge.
  if (Math.abs((x0 + x1) / 2 - (frame.x0 + frame.x1) / 2) > fw * 0.06 || Math.abs((y0 + y1) / 2 - (frame.y0 + frame.y1) / 2) > fh * 0.06) return frame
  // Widen the short side to the card's proportions (dark borders are easy to miss), then pad a little.
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const nw = Math.max(bw, (bh * h * CARD_ASPECT) / w)
  const nh = Math.max(bh, (bw * w) / CARD_ASPECT / h)
  x0 = Math.max(0, cx - nw / 2)
  x1 = Math.min(1, cx + nw / 2)
  y0 = Math.max(0, cy - nh / 2)
  y1 = Math.min(1, cy + nh / 2)
  return { x0, y0, x1, y1 }
}
