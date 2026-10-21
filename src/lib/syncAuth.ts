import type { User } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { cloud, requireCloud } from './syncClient'
import { clearLink } from './syncPush'

/** The signed-in person, or null. `ready` turns true once the saved session has been checked. */
export function useUser(): { user: User | null; ready: boolean } {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(!cloud)
  useEffect(() => {
    if (!cloud) return
    cloud.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setReady(true)
    })
    const { data } = cloud.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null))
    return () => data.subscription.unsubscribe()
  }, [])
  return { user, ready }
}

/** Emails a 6-digit code (no passwords stored by us). */
export async function sendCode(email: string): Promise<void> {
  const { error } = await requireCloud().auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } })
  if (error) throw error
}

export async function verifyCode(email: string, code: string): Promise<void> {
  const { error } = await requireCloud().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' })
  if (error) throw error
}

export async function signOut(): Promise<void> {
  await requireCloud().auth.signOut()
  await clearLink()
}

/** Deletes the cloud copy and the sign-in account. The collection on the phone is untouched. */
export async function deleteAccount(): Promise<void> {
  const c = requireCloud()
  const { error } = await c.rpc('delete_my_account')
  if (error) throw error
  await c.auth.signOut({ scope: 'local' }).catch(() => {})
  await clearLink()
}
