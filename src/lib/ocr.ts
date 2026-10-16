import { createWorker, type Worker } from 'tesseract.js'
import { bestSpecies, getSpeciesNames } from './names'

export interface ScanResult {
  name: string
  number: string // collector number, e.g. "58" (from "58/102") or "TG05"
  total: string // printed set total, e.g. "102", when visible
  nameConfident: boolean // true when the name matched a known Pokémon closely
  rawText: string // what the reader saw, shown to the user for debugging
}

let workerPromise: Promise<Worker> | null = null
export const getWorker = () => (workerPromise ??= createWorker('eng'))

/** Draw a photo onto a canvas, downscaled so very large camera photos stay fast. */
export async function fileToCanvas(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * scale)
    c.height = Math.round(img.naturalHeight * scale)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return c
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Crop a region (fractions of the card), upscale, grayscale and stretch contrast.
 * `invert` handles light text on dark backgrounds (many full-art / dark-type cards).
 */
export function prep(
  card: HTMLCanvasElement,
  [x0, y0, x1, y1]: [number, number, number, number],
  invert: boolean,
): HTMLCanvasElement {
  const sx = Math.round(card.width * x0)
  const sy = Math.round(card.height * y0)
  const sw = Math.max(1, Math.round(card.width * (x1 - x0)))
  const sh = Math.max(1, Math.round(card.height * (y1 - y0)))
  const scale = Math.min(4, Math.max(1, 1000 / sw))
  const w = Math.round(sw * scale)
  const h = Math.round(sh * scale)

  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(card, sx, sy, sw, sh, 0, 0, w, h)

  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const hist = new Uint32Array(256)
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000
    d[i] = g
    hist[g | 0]++
  }
  // Stretch between the 2nd and 98th percentile.
  const total = w * h
  let lo = 0
  let hi = 255
  for (let acc = 0; lo < 255 && (acc += hist[lo]) < total * 0.02; lo++);
  for (let acc = 0; hi > 0 && (acc += hist[hi]) < total * 0.02; hi--);
  const span = Math.max(1, hi - lo)
  for (let i = 0; i < d.length; i += 4) {
    let g = Math.min(255, Math.max(0, ((d[i] - lo) * 255) / span))
    if (invert) g = 255 - g
    d[i] = d[i + 1] = d[i + 2] = g
    d[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)

  // White margin helps the reader on tightly cropped strips.
  const pad = 16
  const out = document.createElement('canvas')
  out.width = w + pad * 2
  out.height = h + pad * 2
  const octx = out.getContext('2d')!
  octx.fillStyle = '#fff'
  octx.fillRect(0, 0, out.width, out.height)
  octx.drawImage(c, pad, pad)
  return out
}

export async function read(worker: Worker, canvas: HTMLCanvasElement, psm: '6' | '7', whitelist = '') {
  await worker.setParameters({
    tessedit_pageseg_mode: psm as never,
    tessedit_char_whitelist: whitelist,
  })
  const { data } = await worker.recognize(canvas)
  return data.text.trim()
}

const DIGIT_FIX: Record<string, string> = { O: '0', o: '0', I: '1', l: '1', '|': '1', S: '5', B: '8' }
const fixDigits = (s: string) => s.replace(/[OoIl|SB]/g, (c) => DIGIT_FIX[c])

export function parseNumber(text: string): { number: string; total: string } {
  // "058/102", "TG05/TG30", "SV012/SV122", tolerant of O/I misreads inside the digits.
  const m = text.match(/([A-Z]{0,4}[\dOIl|]{1,3})\s*\/\s*([A-Z]{0,4}[\dOIl|]{2,3})/)
  if (m) {
    const part = (s: string) => {
      const letters = s.match(/^[A-Z]*/)![0]
      const digits = fixDigits(s.slice(letters.length))
      return letters ? letters + digits : String(parseInt(digits, 10))
    }
    const number = part(m[1])
    const total = part(m[2])
    if (number !== 'NaN') return { number, total: total === 'NaN' ? '' : total }
  }
  // Promos without a total: "SWSH039", "SVP 012"
  const p = text.match(/\b(SWSH|SVP|SM|XY|BW|HGSS|DP|SVP|MEP)\s?(\d{1,3})\b/)
  if (p) return { number: p[1] + p[2].padStart(3, '0'), total: '' }
  return { number: '', total: '' }
}

const NAME_BAND: [number, number, number, number] = [0.05, 0.035, 0.76, 0.125]
const WIDE_BAND: [number, number, number, number] = [0, 0, 1, 0.16]
// Modern cards print the number bottom-left, older ones bottom-right; read both small strips.
const NUMBER_BANDS: [number, number, number, number][] = [
  [0.03, 0.93, 0.5, 0.995],
  [0.5, 0.93, 0.97, 0.995],
]
const NUMBER_CHARS = '0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Read a card that has already been cropped to the card edges. */
export async function scanCanvas(
  card: HTMLCanvasElement,
  onProgress?: (msg: string) => void,
  /** Bulk mode: stop reading as soon as the name and number are clear, instead of trying every variant. */
  fast = false,
): Promise<ScanResult> {
  onProgress?.('Loading text reader…')
  const [worker, species] = await Promise.all([getWorker(), getSpeciesNames()])

  onProgress?.('Reading card name…')
  const nameTexts: string[] = []
  let best: { species: string; score: number } | null = null
  const namePasses: [[number, number, number, number], boolean, '6' | '7'][] = [
    [NAME_BAND, false, '7'],
    [NAME_BAND, true, '7'],
    [WIDE_BAND, false, '6'],
    [WIDE_BAND, true, '6'],
  ]
  for (const [band, invert, psm] of namePasses) {
    const t = await read(worker, prep(card, band, invert), psm)
    nameTexts.push(t)
    const m = bestSpecies(t, species)
    if (m && (!best || m.score > best.score)) best = m
    if (fast && best && best.score >= 0.85) break
  }

  let name = ''
  if (best && best.score >= 0.72) {
    // Wildcard search later handles variants (ex, V, regional forms); keep the first word for hyphenated names.
    name = best.species.split('-')[0]
    name = name.charAt(0).toUpperCase() + name.slice(1)
  } else {
    // Trainer / Energy cards and anything not a Pokémon: use the cleaned first line.
    const line = nameTexts[0]
      .split('\n')
      .map((l) => l.replace(/[^A-Za-z'’.\- ]/g, ' ').replace(/\s+/g, ' ').trim())
      .find((l) => l.length >= 3)
    name = line ?? ''
  }

  onProgress?.('Reading card number…')
  const numTexts: string[] = []
  const votes = new Map<string, { count: number; totals: Map<string, number> }>()
  // Most reliable reads first, so fast mode can stop after two agreeing results.
  const numberPasses: [number, boolean, '6' | '7'][] = [
    [0, true, '7'], [0, true, '6'], [1, true, '7'], [1, true, '6'],
    [0, false, '7'], [1, false, '7'], [0, false, '6'], [1, false, '6'],
  ]
  for (const [bandIndex, invert, psm] of numberPasses) {
    const t = await read(worker, prep(card, NUMBER_BANDS[bandIndex], invert), psm, psm === '7' ? NUMBER_CHARS : '')
    numTexts.push(t)
    const p = parseNumber(t)
    if (!p.number) continue
    const v = votes.get(p.number) ?? { count: 0, totals: new Map() }
    v.count++
    if (p.total) v.totals.set(p.total, (v.totals.get(p.total) ?? 0) + 1)
    votes.set(p.number, v)
    if (fast && v.count >= 2) break
  }
  // Most-voted number wins. The printed total misreads more often (128 read as 728 or 129),
  // so only keep it when two separate reads agree.
  let number = ''
  let total = ''
  let top = 0
  for (const [n, v] of votes) {
    if (v.count <= top) continue
    top = v.count
    number = n
    const [t, c] = [...v.totals.entries()].sort((x, y) => y[1] - x[1])[0] ?? ['', 0]
    total = c >= 2 ? t : ''
  }

  const squash = (s: string) => s.replace(/\s+/g, ' ')
  return {
    name,
    number,
    total,
    nameConfident: !!best && best.score >= 0.85,
    rawText: `Name: ${squash(nameTexts[0])} | Number: ${squash(numTexts.filter(Boolean).join(' / ')).slice(0, 80)}`,
  }
}
