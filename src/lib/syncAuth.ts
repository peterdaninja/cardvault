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

/** Turns Supabase's errors into plain sentences. */
function friendly(e: { message: string; code?: string }): Error {
  const m = e.message.toLowerCase()
  if (m.includes('invalid login')) return new Error('Wrong email or password.')
  if (m.includes('email not confirmed')) return new Error('This email still needs confirming. Check your inbox, or ask the app owner to turn off "Confirm email".')
  if (m.includes('already registered')) return new Error('That email already has an account. Use Sign in instead.')
  if (m.includes('password') && m.includes('characters')) return new Error('Password is too short (use at least 8 characters).')
  if (m.includes('rate limit')) return new Error('Too many attempts for now. Wait a few minutes and try again.')
  return new Error(e.message)
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await requireCloud().auth.signInWithPassword({ email: email.trim(), password })
  if (error) throw friendly(error)
}

/** Creates an account. If Supabase still requires email confirmation there is no session yet, which we report. */
export async function signUpWithPassword(email: string, password: string): Promise<void> {
  const { data, error } = await requireCloud().auth.signUp({ email: email.trim(), password })
  if (error) throw friendly(error)
  if (!data.session) throw new Error('Account created, but it needs email confirmation before you can sign in. Check your inbox.')
}

/** Emails a 6-digit code (needs the email template to include the code; secondary option). */
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
