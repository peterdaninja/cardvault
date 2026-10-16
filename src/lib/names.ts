import { get, set } from 'idb-keyval'

const KEY = 'pokemon-species-v1'
let cache: Promise<string[]> | null = null

/** All Pokémon species names (lowercase, hyphenated), cached on the device after first fetch. */
export function getSpeciesNames(): Promise<string[]> {
  return (cache ??= (async () => {
    try {
      const saved = await get<string[]>(KEY)
      if (saved?.length) return saved
    } catch {
      /* storage unavailable, fall through to network */
    }
    try {
      const res = await fetch('https://pokeapi.co/api/v2/pokemon-species?limit=2000')
      const json = await res.json()
      const names = (json.results as { name: string }[]).map((r) => r.name)
      await set(KEY, names).catch(() => {})
      return names
    } catch {
      return []
    }
  })())
}

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

export function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return prev[b.length]
}

export interface NameMatch {
  species: string // hyphenated species name from the list
  score: number // 0..1 similarity
}

/** Best species match for any word (or adjacent word pair) in the OCR text. */
export function bestSpecies(text: string, species: string[]): NameMatch | null {
  const words = text
    .split(/\s+/)
    .map(norm)
    .filter((w) => w.length >= 3)
  const grams = new Set(words)
  for (let i = 0; i < words.length - 1; i++) grams.add(words[i] + words[i + 1])
  if (!grams.size || !species.length) return null

  const normalized = species.map((s) => ({ s, n: norm(s) }))
  let best: NameMatch | null = null
  for (const g of grams) {
    for (const { s, n } of normalized) {
      if (Math.abs(n.length - g.length) > 3) continue
      const score = 1 - levenshtein(g, n) / Math.max(g.length, n.length)
      if (!best || score > best.score || (score === best.score && n.length > norm(best.species).length)) {
        best = { species: s, score }
      }
    }
  }
  return best
}
