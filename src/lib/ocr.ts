import { createWorker, type Worker } from 'tesseract.js'
import { bestSpecies, getSpeciesNames } from './names'

export interface ScanResult {
  name: string
  number: string // collector number, e.g. "58" (from "58/102") or "TG05"
  total: string // printed set total, e.g. "102", when visible
  rawText: string // what the reader saw, shown to the user for debugging
}

let workerPromise: Promise<Worker> | null = null
const getWorker = () => (workerPromise ??= createWorker('eng'))

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
function prep(
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

async function read(worker: Worker, canvas: HTMLCanvasElement, psm: '6' | '7', whitelist = '') {
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
const NUMBER_BAND: [number, number, number, number] = [0, 0.9, 1, 1]

/** Read a card that has already been cropped to the card edges. */
export async function scanCanvas(
  card: HTMLCanvasElement,
  onProgress?: (msg: string) => void,
): Promise<ScanResult> {
  onProgress?.('Loading text reader…')
  const [worker, species] = await Promise.all([getWorker(), getSpeciesNames()])

  onProgress?.('Reading card name…')
  const nameTexts: string[] = []
  for (const invert of [false, true]) {
    nameTexts.push(await read(worker, prep(card, NAME_BAND, invert), '7'))
    nameTexts.push(await read(worker, prep(card, WIDE_BAND, invert), '6'))
  }

  let best: { species: string; score: number } | null = null
  for (const t of nameTexts) {
    const m = bestSpecies(t, species)
    if (m && (!best || m.score > best.score)) best = m
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
  const numTexts = [
    await read(worker, prep(card, NUMBER_BAND, false), '6'),
    await read(worker, prep(card, NUMBER_BAND, true), '6'),
  ]
  let parsed = { number: '', total: '' }
  for (const t of numTexts) {
    const p = parseNumber(t)
    if (p.number && (!parsed.number || (p.total && !parsed.total))) parsed = p
  }

  return {
    name,
    number: parsed.number,
    total: parsed.total,
    rawText: `Name: ${nameTexts[0].replace(/\s+/g, ' ')} | Number: ${numTexts[0].replace(/\s+/g, ' ')}`,
  }
}
