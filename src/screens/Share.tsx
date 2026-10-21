import type { User } from '@supabase/supabase-js'
import { useCallback, useEffect, useState } from 'react'
import { deleteAccount, sendCode, signInWithPassword, signOut, signUpWithPassword, verifyCode } from '../lib/syncAuth'
import { cloudAvailable } from '../lib/syncClient'
import type { CloudSync } from '../lib/syncHook'
import { acceptInvite, inviteByEmail, inviteByLink, inviteUrl, listMyShares, listSharedWithMe, revokeShare, type Share } from '../lib/syncShares'
import type { AppState } from '../lib/types'
import { dateLabel } from '../ui/format'
import { ChevronLeft } from '../ui/icons'

interface Props {
  user: User | null
  ready: boolean
  sync: CloudSync
  local: AppState
  pendingInvite: string | null
  onClearInvite: () => void
  onRestore: (state: AppState) => void
  onOpenShared: (ownerId: string, ownerEmail: string | null) => void
  onBack: () => void
}

const msg = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : 'Something went wrong')

export default function SharePage({ user, ready, sync, local, pendingInvite, onClearInvite, onRestore, onOpenShared, onBack }: Props) {
  return (
    <>
      <div className="cv-top">
        <button className="icon-btn" onClick={onBack} aria-label="Back"><ChevronLeft /></button>
      </div>
      <header className="topbar">
        <div>
          <p className="eyebrow">Optional</p>
          <h1>Account &amp; sharing</h1>
        </div>
      </header>

      {!cloudAvailable ? (
        <div className="card-panel">
          <p>Sharing is not switched on in this copy of the app, so everything stays on this phone only.</p>
        </div>
      ) : !ready ? (
        <p className="status">Loading…</p>
      ) : !user ? (
        <SignIn pendingInvite={!!pendingInvite} />
      ) : (
        <SignedIn
          user={user}
          sync={sync}
          local={local}
          pendingInvite={pendingInvite}
          onClearInvite={onClearInvite}
          onRestore={onRestore}
          onOpenShared={onOpenShared}
        />
      )}

      <div className="card-panel">
        <p className="hint" style={{ margin: 0 }}>
          <b>Privacy.</b> Nothing leaves your phone unless you sign in and choose to back up. If you do, a copy of your collection
          (cards, quantities, prices, value history) and your email address are stored on our server. Only people you invite can see it,
          and only to look. You can stop sharing, sign out, or delete everything here at any time.
        </p>
      </div>
    </>
  )
}

function SignIn({ pendingInvite }: { pendingInvite: boolean }) {
  const [mode, setMode] = useState<'in' | 'up' | 'code'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(msg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card-panel">
      {pendingInvite && <p><b>You have been invited to view a collection.</b> Sign in or create an account to accept.</p>}
      <p>
        {mode === 'up'
          ? 'Create an account to back up your collection and share it. Pick a password you do not use anywhere else.'
          : mode === 'in'
            ? 'Sign in to back up your collection and share it.'
            : 'We email you a 6-digit code, no password needed.'}
      </p>
      <input type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={sent} />
      {mode !== 'code' ? (
        <>
          <input
            style={{ marginTop: 12 }}
            type="password"
            autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
            placeholder="Password (8+ characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            className="big"
            style={{ marginTop: 12 }}
            disabled={busy || !email.includes('@') || password.length < 8}
            onClick={() => run(() => (mode === 'up' ? signUpWithPassword(email, password) : signInWithPassword(email, password)))}
          >
            {busy ? 'Please wait…' : mode === 'up' ? 'Create account' : 'Sign in'}
          </button>
          <button className="danger-link" onClick={() => { setMode(mode === 'up' ? 'in' : 'up'); setError('') }}>
            {mode === 'up' ? 'I already have an account' : 'Create a new account'}
          </button>
          <button className="danger-link" onClick={() => { setMode('code'); setError('') }}>Use an emailed code instead</button>
        </>
      ) : !sent ? (
        <>
          <button className="big" style={{ marginTop: 12 }} disabled={busy || !email.includes('@')} onClick={() => run(async () => { await sendCode(email); setSent(true) })}>
            {busy ? 'Sending…' : 'Email me a code'}
          </button>
          <button className="danger-link" onClick={() => { setMode('in'); setError('') }}>Use a password instead</button>
        </>
      ) : (
        <>
          <input style={{ marginTop: 12 }} inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="big" style={{ marginTop: 12 }} disabled={busy || code.trim().length < 6} onClick={() => run(() => verifyCode(email, code))}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
          <button className="danger-link" onClick={() => { setSent(false); setCode('') }}>Use a different email</button>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  )
}

function SignedIn({ user, sync, local, pendingInvite, onClearInvite, onRestore, onOpenShared }: Omit<Props, 'ready' | 'onBack'> & { user: User }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [mine, setMine] = useState<Share[]>([])
  const [theirs, setTheirs] = useState<Share[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [fresh, setFresh] = useState<Share | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { linked, checkCloud } = sync

  const refresh = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([listMyShares(user.id), listSharedWithMe(user.id)])
      setMine(a)
      setTheirs(b)
    } catch (e) {
      setError(msg(e))
    }
  }, [user.id])

  useEffect(() => {
    refresh()
  }, [refresh])
  useEffect(() => {
    if (!linked) checkCloud()
  }, [linked, checkCloud])

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(msg(e))
    } finally {
      setBusy(false)
    }
  }

  const hasLocal = local.cards.length > 0 || local.collections.length > 0
  const cloudHas = (sync.counts?.cards ?? 0) + (sync.counts?.collections ?? 0) > 0

  return (
    <>
      <div className="card-panel">
        <p>Signed in as <b>{user.email}</b></p>
        <button style={{ marginTop: 8 }} disabled={busy} onClick={() => run(signOut)}>Sign out</button>
      </div>

      {pendingInvite && (
        <div className="card-panel">
          <p><b>You were invited to view a collection.</b></p>
          <button className="big" disabled={busy} onClick={() => run(async () => { await acceptInvite(pendingInvite); onClearInvite(); await refresh() })}>
            Accept invite
          </button>
          <button className="danger-link" onClick={onClearInvite}>Ignore</button>
        </div>
      )}

      <h2 className="section">Your vault in the cloud</h2>
      {!linked ? (
        <div className="card-panel">
          {sync.counts == null ? (
            <p>Checking the cloud…</p>
          ) : !cloudHas ? (
            <>
              <p>Nothing is stored in the cloud yet. Back up this phone's collection to start sharing. The phone stays your main copy.</p>
              <button className="big" disabled={busy || sync.status === 'syncing'} onClick={() => run(sync.keepPhone)}>
                {sync.status === 'syncing' ? 'Uploading…' : 'Back up this phone'}
              </button>
            </>
          ) : (
            <>
              <p>The cloud already has {sync.counts.cards} cards in {sync.counts.collections} collections. This phone has {local.cards.length} cards in {local.collections.length} collections. Pick which copy to keep; the other is replaced.</p>
              <div className="row" style={{ marginTop: 12 }}>
                <button className="grow" disabled={busy} onClick={() => { if (!hasLocal || confirm('Replace the cloud copy with this phone?')) run(sync.keepPhone) }}>Keep this phone</button>
                <button className="grow" disabled={busy} onClick={() => { if (!hasLocal || confirm('Replace this phone with the cloud copy?')) run(async () => onRestore(await sync.keepCloud())) }}>Use cloud copy</button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="card-panel">
          <p>
            {sync.status === 'syncing' ? 'Syncing…' : sync.status === 'error' ? 'Last sync failed; will retry.' : 'Backed up.'}
            {sync.lastAt ? ` Last synced ${dateLabel(sync.lastAt, true)}.` : ''}
          </p>
          <p className="hint">Changes on this phone are copied to the cloud automatically when you are online.</p>
          <button className="danger-link" onClick={() => run(sync.unlink)}>Stop syncing on this phone</button>
        </div>
      )}

      {linked && (
        <>
          <h2 className="section">Share my vault (view only)</h2>
          <div className="card-panel">
            <p>People you share with can look at your collections and values but can never change anything.</p>
            <input type="email" inputMode="email" placeholder="friend@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} style={{ marginTop: 8 }} />
            <button style={{ marginTop: 8 }} disabled={busy || !inviteEmail.includes('@')} onClick={() => run(async () => { await inviteByEmail(user.id, inviteEmail); setInviteEmail(''); setFresh(null); await refresh() })}>
              Invite by email
            </button>
            <p className="hint">They get access when they sign in to the app with that email. Tell them to open SLOWTCG, since we do not send the email for you.</p>
            <button style={{ marginTop: 8 }} disabled={busy} onClick={() => run(async () => { setFresh(await inviteByLink(user.id)); await refresh() })}>
              Create an invite link
            </button>
            {fresh && (
              <p className="hint" style={{ wordBreak: 'break-all' }}>
                {inviteUrl(fresh.token)}
                <br />
                <button onClick={() => navigator.clipboard?.writeText(inviteUrl(fresh.token)).catch(() => {})}>Copy link</button> Works once: the first person to accept it gets access.
              </p>
            )}
            {mine.map((s) => (
              <div className="row" key={s.id} style={{ marginTop: 10, alignItems: 'center' }}>
                <span className="grow">{s.viewerEmail ?? (s.viewerId ? 'Someone with a link' : 'Link not used yet')}</span>
                <button disabled={busy} onClick={() => run(async () => { await revokeShare(s.id); await refresh() })}>Remove</button>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 className="section">Shared with me</h2>
      <div className="card-panel">
        {theirs.length === 0 && <p className="hint" style={{ margin: 0 }}>Nobody has shared a vault with you yet.</p>}
        {theirs.map((s) => (
          <div className="row" key={s.id} style={{ marginTop: 6, alignItems: 'center' }}>
            <span className="grow">{s.ownerEmail ?? 'A friend'}</span>
            <button onClick={() => onOpenShared(s.ownerId, s.ownerEmail)}>View</button>
          </div>
        ))}
      </div>

      {error && <p className="error">{error}</p>}

      <h2 className="section">Delete my account</h2>
      <div className="card-panel">
        <p>Erases your cloud copy, all sharing and your sign-in. The collection on this phone is not touched.</p>
        {!confirmDelete ? (
          <button className="danger-link" onClick={() => setConfirmDelete(true)}>Delete account…</button>
        ) : (
          <button className="big" disabled={busy} onClick={() => run(deleteAccount)}>Yes, delete my account permanently</button>
        )}
      </div>
    </>
  )
}
