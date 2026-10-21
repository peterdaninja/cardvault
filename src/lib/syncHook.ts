import type { User } from '@supabase/supabase-js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cloudCounts } from './syncPull'
import { clearLink, downloadAll, getLink, pushChanges, uploadAll } from './syncPush'
import type { AppState } from './types'

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'error'

export interface CloudSync {
  status: SyncStatus
  linked: boolean
  error: string
  lastAt: number | null
  /** Cloud copy exists and differs in kind from this phone: ask the person which to keep. */
  counts: { collections: number; cards: number } | null
  checkCloud: () => Promise<void>
  keepPhone: () => Promise<void>
  keepCloud: () => Promise<AppState>
  unlink: () => Promise<void>
}

const msg = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : 'Something went wrong')

/**
 * Keeps the cloud copy following the phone, only while signed in AND linked (the person chose a side).
 * Local-only users never reach any of this.
 */
export function useCloudSync(state: AppState | null, user: User | null): CloudSync {
  const [linked, setLinked] = useState(false)
  const [status, setStatus] = useState<SyncStatus>('off')
  const [error, setError] = useState('')
  const [lastAt, setLastAt] = useState<number | null>(null)
  const [counts, setCounts] = useState<CloudSync['counts']>(null)
  const latest = useRef(state)
  latest.current = state
  const chain = useRef<Promise<void>>(Promise.resolve())
  const userId = user?.id ?? null

  useEffect(() => {
    let alive = true
    setLinked(false)
    setCounts(null)
    setStatus('off')
    if (!userId) return
    getLink(userId).then((l) => {
      if (!alive) return
      setLinked(!!l)
      if (l) {
        setStatus('idle')
        setLastAt(l.at)
      }
    })
    return () => {
      alive = false
    }
  }, [userId])

  const sync = useCallback(() => {
    if (!userId) return
    chain.current = chain.current.then(async () => {
      const s = latest.current
      if (!s) return
      setStatus('syncing')
      try {
        await pushChanges(userId, s)
        setError('')
        setStatus('idle')
        setLastAt(Date.now())
      } catch (e) {
        setError(msg(e))
        setStatus('error')
      }
    })
    return chain.current
  }, [userId])

  // Push shortly after every change (and again after coming back online).
  useEffect(() => {
    if (!linked || !state) return
    const t = setTimeout(sync, 2500)
    return () => clearTimeout(t)
  }, [state, linked, sync])
  useEffect(() => {
    if (!linked) return
    window.addEventListener('online', sync)
    return () => window.removeEventListener('online', sync)
  }, [linked, sync])

  return {
    status,
    linked,
    error,
    lastAt,
    counts,
    checkCloud: async () => {
      if (!userId) return
      try {
        setCounts(await cloudCounts(userId))
        setError('')
      } catch (e) {
        setError(msg(e))
      }
    },
    keepPhone: async () => {
      if (!userId || !latest.current) return
      setStatus('syncing')
      try {
        await uploadAll(userId, latest.current)
        setLinked(true)
        setStatus('idle')
        setLastAt(Date.now())
        setError('')
      } catch (e) {
        setError(msg(e))
        setStatus('error')
      }
    },
    keepCloud: async () => {
      if (!userId) throw new Error('Not signed in')
      const restored = await downloadAll(userId)
      setLinked(true)
      setStatus('idle')
      setLastAt(Date.now())
      return restored
    },
    unlink: async () => {
      await clearLink()
      setLinked(false)
      setStatus('off')
    },
  }
}
