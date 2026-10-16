import { get, set } from 'idb-keyval'
import { queryCards } from './tcg'
import type { TcgCard } from './types'

interface Stored {
  at: number
  cards: TcgCard[]
}

const DAY = 24 * 60 * 60 * 1000
const memo = new Map<string, Promise<TcgCard[]>>()

/** Sort by collector number, numerically where possible ("2" before "10", "TG05" after plain numbers). */
function byNumber(a: TcgCard, b: TcgCard) {
  const na = parseInt(a.number, 10)
  const nb = parseInt(b.number, 10)
  const ka = Number.isNaN(na) ? Infinity : na
  const kb = Number.isNaN(nb) ? Infinity : nb
  return ka - kb || a.number.localeCompare(b.number, undefined, { numeric: true })
}

async function fetchAll(setId: string): Promise<TcgCard[]> {
  const all: TcgCard[] = []
  for (let page = 1; page <= 6; page++) {
    const batch = await queryCards(`set.id:${setId}`, { pageSize: 250, page, orderBy: 'number' })
    all.push(...batch)
    if (batch.length < 250) break
  }
  return all.sort(byNumber)
}

/**
 * Every card in a set, cached on the device. Cached copies under a day old are reused;
 * older ones are refetched, falling back to the stale copy if the card database is down.
 */
export function getSetCards(setId: string, forceFresh = false): Promise<TcgCard[]> {
  const key = setId + (forceFresh ? ':fresh' : '')
  let p = memo.get(key)
  if (!p) {
    p = load(setId, forceFresh)
    memo.set(key, p)
    p.catch(() => memo.delete(key)) // allow a retry after a failure
  }
  return p
}

async function load(setId: string, forceFresh: boolean): Promise<TcgCard[]> {
  const storeKey = `setcards-v1-${setId}`
  let stored: Stored | undefined
  try {
    stored = await get<Stored>(storeKey)
  } catch {
    /* storage unavailable */
  }
  const fresh = stored && Date.now() - stored.at < DAY
  if (stored && fresh && !forceFresh) return stored.cards
  try {
    const cards = await fetchAll(setId)
    if (cards.length) {
      await set(storeKey, { at: Date.now(), cards } satisfies Stored).catch(() => {})
      return cards
    }
    if (stored) return stored.cards
    return cards
  } catch (e) {
    if (stored) return stored.cards
    throw e
  }
}
