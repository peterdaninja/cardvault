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
