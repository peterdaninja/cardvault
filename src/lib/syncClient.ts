import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Both values are public by design (safety comes from the database's row-level rules).
// The secret "service_role" key must never appear in this app.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Null when no backend is configured: the app then stays purely local, exactly as before. */
export const cloud: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } }) : null

export const cloudAvailable = cloud !== null

export function requireCloud(): SupabaseClient {
  if (!cloud) throw new Error('Cloud sync is not set up')
  return cloud
}
