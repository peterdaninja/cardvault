import { createWorker, type Worker } from 'tesseract.js'

export interface ScanResult {
  name: string
  number: string // collector number, e.g. "25" (from "25/102")
  rawText: string
}

let workerPromise: Promise<Worker> | null = null
const getWorker = () => (workerPromise ??= createWorker('eng'))

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    // decode() has resolved, so the bitmap no longer needs the URL
    URL.revokeObjectURL(url)
  }
}

/** Crop a horizontal strip of the photo (fractions of height), upscale, grayscale. */
function strip(img: HTMLImageElement, top: number, bottom: number): HTMLCanvasElement {
  const maxW = 1400
  const scale = Math.min(1, maxW / img.naturalWidth)
  const w = Math.round(img.naturalWidth * scale)
  const h = Math.round(img.naturalHeight * scale)
  const sy = Math.round(h * top)
  const sh = Math.round(h * (bottom - top))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = sh
  const ctx = canvas.getContext('2d')!
  ctx.filter = 'grayscale(1) contrast(1.4)'
  ctx.drawImage(img, 0, sy / scale, img.naturalWidth, sh / scale, 0, 0, w, sh)
  return canvas
}

export function parseName(text: string): string {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/[^A-Za-z'’.\-é♀♂: ]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((l) => l.length >= 3)
  for (const line of lines) {
    // Drop stage words like "Basic", "Stage 1", and trailing HP text.
    const words = line
      .split(' ')
      .filter((w) => !/^(basic|stage|hp|vmax|vstar)$/i.test(w) || w.length > 5)
    const candidate = words.join(' ').trim()
    if (/[A-Za-z]{3,}/.test(candidate)) return candidate
  }
  return ''
}

export function parseNumber(text: string): string {
  const m = text.match(/(\d{1,3})\s*\/\s*(\d{1,3})/)
  return m ? String(parseInt(m[1], 10)) : ''
}

export async function scanCard(
  file: File,
  onProgress?: (msg: string) => void,
): Promise<ScanResult> {
  onProgress?.('Loading text reader…')
  const worker = await getWorker()
  const img = await loadImage(file)

  onProgress?.('Reading card name…')
  const top = await worker.recognize(strip(img, 0, 0.16))
  onProgress?.('Reading card number…')
  const bottom = await worker.recognize(strip(img, 0.86, 1))

  const rawText = `${top.data.text}\n${bottom.data.text}`
  return { name: parseName(top.data.text), number: parseNumber(bottom.data.text), rawText }
}
