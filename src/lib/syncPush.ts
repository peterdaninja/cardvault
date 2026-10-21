import { del, get, set } from 'idb-keyval'
import { requireCloud } from './syncClient'
import { fetchVault } from './syncPull'
import type { AppState } from './types'

const KEY = 'cardvault-sync-v1'
const BATCH = 400

/** What the cloud held after the last successful sync: a short fingerprint per row, so only changes are sent. */
interface Link {
  userId: string
  collections: Record<string, string>
  cards: Record<string, string>
  meta: string
  at: number
}

export async function getLink(userId: string): Promise<Link | null> {
  try {
    const l = await get<Link>(KEY)
    return l && l.userId === userId ? l : null
  } catch {
    return null
  }
}

export async function clearLink(): Promise<void> {
  await del(KEY).catch(() => {})
}

// Cheap non-cryptographic fingerprint (djb2) of a row's JSON; only used to notice changes.
function fp(value: unknown): string {
  const s = JSON.stringify(value)
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return `${s.length}:${h}`
}

const fingerprints = (state: AppState): Omit<Link, 'userId' | 'at'> => ({
  collections: Object.fromEntries(state.collections.map((c) => [c.id, fp(c)])),
  cards: Object.fromEntries(state.cards.map((c) => [c.id, fp(c)])),
  meta: fp([state.history ?? null, state.pricesUpdatedAt ?? null]),
})

async function inBatches<T>(rows: T[], send: (batch: T[]) => PromiseLike<{ error: unknown }>) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await send(rows.slice(i, i + BATCH))
    if (error) throw error
  }
}

/** Sends only what changed since the last sync. The phone is the source of truth: the cloud just follows it. */
export async function pushChanges(userId: string, state: AppState): Promise<void> {
  const c = requireCloud()
  const link = (await getLink(userId)) ?? { userId, collections: {}, cards: {}, meta: '', at: 0 }
  const now = fingerprints(state)

  const colUp = state.collections.filter((x) => link.collections[x.id] !== now.collections[x.id])
  const cardUp = state.cards.filter((x) => link.cards[x.id] !== now.cards[x.id])
  const colGone = Object.keys(link.collections).filter((id) => !(id in now.collections))
  const cardGone = Object.keys(link.cards).filter((id) => !(id in now.cards))

  await inBatches(colUp, (b) =>
    c.from('collections').upsert(b.map((x) => ({ owner_id: userId, id: x.id, data: x, updated_at: new Date().toISOString() })), { onConflict: 'owner_id,id' }),
  )
  await inBatches(cardUp, (b) =>
    c.from('cards').upsert(
      b.map((x) => ({ owner_id: userId, id: x.id, collection_id: x.collectionId, data: x, updated_at: new Date().toISOString() })),
      { onConflict: 'owner_id,id' },
    ),
  )
  await inBatches(cardGone, (b) => c.from('cards').delete().eq('owner_id', userId).in('id', b))
  await inBatches(colGone, (b) => c.from('collections').delete().eq('owner_id', userId).in('id', b))
  if (link.meta !== now.meta) {
    const { error } = await c.from('vault_meta').upsert(
      { owner_id: userId, history: state.history ?? null, prices_updated_at: state.pricesUpdatedAt ?? null, updated_at: new Date().toISOString() },
      { onConflict: 'owner_id' },
    )
    if (error) throw error
  }
  await set(KEY, { userId, ...now, at: Date.now() } satisfies Link)
}

/** "Use this phone": wipe the cloud copy, then upload what is on the phone. */
export async function uploadAll(userId: string, state: AppState): Promise<void> {
  const c = requireCloud()
  for (const table of ['cards', 'collections', 'vault_meta'] as const) {
    const { error } = await c.from(table).delete().eq('owner_id', userId)
    if (error) throw error
  }
  await clearLink()
  await pushChanges(userId, state)
}

/** "Use the cloud copy": returns the cloud's vault so the caller can replace the phone's data with it. */
export async function downloadAll(userId: string): Promise<AppState> {
  const state = await fetchVault(userId)
  await set(KEY, { userId, ...fingerprints(state), at: Date.now() } satisfies Link)
  return state
}
