import { get, set } from 'idb-keyval'

export interface TcgSet {
  id: string // e.g. "base1", "me55"
  name: string
  series: string
  releaseDate: string
  printedTotal?: number
  symbol?: string
}

const KEY = 'tcg-sets-v1'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let cache: Promise<TcgSet[]> | null = null

interface ApiSet {
  id: string
  name: string
  series: string
  releaseDate: string
  printedTotal?: number
  images?: { symbol?: string }
}

/** Every official set, newest first. Cached on the device and refreshed in the background. */
export function getSets(): Promise<TcgSet[]> {
  return (cache ??= load().catch((e) => {
    cache = null // let the next open try again
    throw e
  }))
}

async function load(): Promise<TcgSet[]> {
  let saved: TcgSet[] | undefined
  try {
    saved = await get<TcgSet[]>(KEY)
  } catch {
    /* storage unavailable */
  }
  if (saved?.length) {
    fetchSets().then((fresh) => set(KEY, fresh).catch(() => {})).catch(() => {})
    return saved
  }
  const fresh = await fetchSets()
  await set(KEY, fresh).catch(() => {})
  return fresh
}

async function fetchSets(): Promise<TcgSet[]> {
  const url = 'https://api.pokemontcg.io/v2/sets?select=id,name,series,releaseDate,printedTotal,images&orderBy=-releaseDate'
  let lastError = 'Could not load the set list.'
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await sleep(500 * 2 ** (attempt - 1))
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
      if (res.ok) {
        const data = ((await res.json()).data ?? []) as ApiSet[]
        return data.map((s) => ({
          id: s.id,
          name: s.name,
          series: s.series,
          releaseDate: s.releaseDate,
          printedTotal: s.printedTotal,
          symbol: s.images?.symbol,
        }))
      }
      lastError = `The card database is busy (error ${res.status}).`
      if (res.status < 500 && res.status !== 429) break
    } catch {
      lastError = 'Could not reach the card database.'
    }
  }
  throw new Error(lastError)
}
