import type { AppState, Collection, OwnedCard, Snapshot } from './types'
import { requireCloud } from './syncClient'

const PAGE = 1000

async function fetchAll<T>(table: 'collections' | 'cards', ownerId: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await requireCloud()
      .from(table)
      .select('id, data')
      .eq('owner_id', ownerId)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    for (const row of data ?? []) out.push(row.data as T)
    if (!data || data.length < PAGE) return out
  }
}

/** Reads a whole vault from the cloud. Works for your own vault, and for one shared with you (read-only by the database). */
export async function fetchVault(ownerId: string): Promise<AppState> {
  const [collections, cards, meta] = await Promise.all([
    fetchAll<Collection>('collections', ownerId),
    fetchAll<OwnedCard>('cards', ownerId),
    requireCloud().from('vault_meta').select('history, prices_updated_at').eq('owner_id', ownerId).maybeSingle(),
  ])
  if (meta.error) throw meta.error
  return {
    collections: collections.sort((a, b) => a.createdAt - b.createdAt),
    cards,
    history: (meta.data?.history as Snapshot[] | null) ?? undefined,
    pricesUpdatedAt: meta.data?.prices_updated_at ?? undefined,
  }
}

export async function cloudCounts(ownerId: string): Promise<{ collections: number; cards: number }> {
  const c = requireCloud()
  const [a, b] = await Promise.all([
    c.from('collections').select('id', { count: 'exact', head: true }).eq('owner_id', ownerId),
    c.from('cards').select('id', { count: 'exact', head: true }).eq('owner_id', ownerId),
  ])
  if (a.error) throw a.error
  if (b.error) throw b.error
  return { collections: a.count ?? 0, cards: b.count ?? 0 }
}
