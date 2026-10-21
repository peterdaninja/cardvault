import { requireCloud } from './syncClient'

export interface Share {
  id: string
  ownerId: string
  ownerEmail: string | null
  viewerEmail: string | null
  viewerId: string | null
  token: string
  createdAt: string
}

interface Row {
  id: string
  owner_id: string
  owner_email: string | null
  viewer_email: string | null
  viewer_id: string | null
  token: string
  created_at: string
}

const toShare = (r: Row): Share => ({
  id: r.id,
  ownerId: r.owner_id,
  ownerEmail: r.owner_email,
  viewerEmail: r.viewer_email,
  viewerId: r.viewer_id,
  token: r.token,
  createdAt: r.created_at,
})

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function create(ownerId: string, viewerEmail: string | null): Promise<Share> {
  const { data, error } = await requireCloud()
    .from('shares')
    .insert({ owner_id: ownerId, viewer_email: viewerEmail, token: newToken() })
    .select()
    .single()
  if (error) throw error
  return toShare(data as Row)
}

export const inviteByEmail = (ownerId: string, email: string) => create(ownerId, email.trim().toLowerCase())
export const inviteByLink = (ownerId: string) => create(ownerId, null)

export function inviteUrl(token: string): string {
  return `${location.origin}${location.pathname}?invite=${token}`
}

/** People you have invited. */
export async function listMyShares(ownerId: string): Promise<Share[]> {
  const { data, error } = await requireCloud().from('shares').select('*').eq('owner_id', ownerId).order('created_at')
  if (error) throw error
  return (data as Row[]).map(toShare)
}

/** Stops that person seeing your vault straight away. */
export async function revokeShare(id: string): Promise<void> {
  const { error } = await requireCloud().from('shares').delete().eq('id', id)
  if (error) throw error
}

/** Vaults other people have shared with you (the database only returns shares addressed to you). */
export async function listSharedWithMe(myId: string): Promise<Share[]> {
  const { data, error } = await requireCloud().from('shares').select('*').neq('owner_id', myId).order('created_at')
  if (error) throw error
  return (data as Row[]).map(toShare)
}

/** Redeems an invite link; returns the owner's id. */
export async function acceptInvite(token: string): Promise<string> {
  const { data, error } = await requireCloud().rpc('accept_invite', { invite_token: token })
  if (error) throw error
  return data as string
}
