import { getWorker, prep, read, type ScanResult } from './ocr'
import { findCodeIn } from './ygo'

type Band = [number, number, number, number]

// Yu-Gi-Oh! layout: the name runs along the top (the attribute icon sits at the right), and the
// set code is printed at the right, just under the artwork. Newer prints also put it lower down.
const NAME_BAND: Band = [0.05, 0.03, 0.87, 0.105]
const WIDE_BAND: Band = [0, 0, 1, 0.13]
// Tight strips on the right read best: wider ones pick up the artwork frame and confuse the reader.
const CODE_PASSES: [Band, boolean, '6' | '7'][] = [
  [[0.7, 0.71, 0.98, 0.742], false, '7'],
  [[0.66, 0.708, 0.98, 0.745], false, '7'],
  [[0.7, 0.71, 0.98, 0.742], true, '7'],
  [[0.74, 0.708, 0.98, 0.745], false, '7'],
  [[0.66, 0.708, 0.98, 0.745], true, '7'],
  [[0.7, 0.705, 0.98, 0.75], false, '6'],
  [[0.5, 0.7, 0.98, 0.765], false, '6'],
  [[0.5, 0.7, 0.98, 0.765], true, '6'],
  [[0, 0.9, 1, 1], false, '6'], // some newer printings put it along the bottom
]
const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'
const DIGIT_FIX: Record<string, string> = { O: '0', I: '1', L: '1', S: '5', B: '8', Z: '2' }

/** Fix common digit misreads in the numeric tail of a code ("SDK-OO1" -> "SDK-001"). */
export function fixCode(code: string): string {
  const dash = code.indexOf('-')
  if (dash < 0) return code
  const rest = code.slice(dash + 1)
  const m = rest.match(/^([A-Z]*?)([0-9OILSBZ]{1,4})$/)
  if (!m) return code
  return `${code.slice(0, dash)}-${m[1]}${m[2].replace(/[OILSBZ]/g, (c) => DIGIT_FIX[c])}`
}

function cleanName(text: string): string {
  return (
    text
      .split('\n')
      .map((l) => l.replace(/[^A-Za-z0-9'’.,!&#:\- ]/g, ' ').replace(/\s+/g, ' ').trim())
      .find((l) => /[A-Za-z]{3,}/.test(l))
      // The attribute icon at the right often reads as a stray character; drop trailing junk tokens.
      ?.replace(/(\s+(?:\S|[^A-Za-z\s]+))+$/, '')
      .trim() ?? ''
  )
}

export async function scanYgo(
  card: HTMLCanvasElement,
  onProgress?: (msg: string) => void,
  fast = false,
): Promise<ScanResult> {
  onProgress?.('Loading text reader…')
  const worker = await getWorker()

  // The set code first: it identifies the exact printing.
  onProgress?.('Reading set code…')
  const codeTexts: string[] = []
  const votes = new Map<string, number>()
  for (const [band, invert, psm] of CODE_PASSES) {
    const t = await read(worker, prep(card, band, invert), psm, psm === '7' ? CODE_CHARS : '')
    codeTexts.push(t)
    const found = findCodeIn(t)
    if (!found) continue
    const code = fixCode(found)
    const n = (votes.get(code) ?? 0) + 1
    votes.set(code, n)
    if (fast && n >= 2) break
  }
  let code = ''
  let top = 0
  for (const [c, n] of votes) {
    if (n > top) {
      top = n
      code = c
    }
  }

  onProgress?.('Reading card name…')
  const nameTexts: string[] = []
  let name = ''
  for (const [band, invert, psm] of [
    [NAME_BAND, false, '7'],
    [NAME_BAND, true, '7'],
    [WIDE_BAND, false, '6'],
  ] as [Band, boolean, '6' | '7'][]) {
    const t = await read(worker, prep(card, band, invert), psm)
    nameTexts.push(t)
    name = name || cleanName(t)
    // With a code in hand the name is only a cross-check, so don't spend more time on it.
    if (name && (code || fast)) break
  }

  const squash = (s: string) => s.replace(/\s+/g, ' ')
  return {
    name,
    number: code,
    total: '',
    numberConfident: top >= 2,
    nameConfident: top >= 2,
    rawText: `Name: ${squash(nameTexts.find((t) => t.trim()) ?? '')} | Code: ${squash(codeTexts.filter(Boolean).join(' / ')).slice(0, 80)}`,
  }
}
