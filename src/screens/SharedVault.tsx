import { useEffect, useMemo, useState } from 'react'
import { adapterFor } from '../lib/games'
import { fetchVault } from '../lib/syncPull'
import type { AppState } from '../lib/types'
import { money } from '../ui/format'
import CollectionView from './CollectionView'
import Home from './Home'

interface Props {
  ownerId: string
  ownerEmail: string | null
  onClose: () => void
}

const noop = () => {}

/** Someone else's vault, shown with the normal screens but with every editing control removed. */
export default function SharedVault({ ownerId, ownerEmail, onClose }: Props) {
  const [vault, setVault] = useState<AppState | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'home' | 'collections'>('home')
  const [openId, setOpenId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)

  function load() {
    setError('')
    fetchVault(ownerId)
      .then(setVault)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load this vault'))
  }
  useEffect(load, [ownerId]) // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => {
    const m = new Map<string, { count: number; value: number }>()
    for (const c of vault?.cards ?? []) {
      const t = m.get(c.collectionId) ?? { count: 0, value: 0 }
      t.count += c.qty
      t.value += (c.price ?? 0) * c.qty
      m.set(c.collectionId, t)
    }
    return m
  }, [vault])

  const open = vault?.collections.find((c) => c.id === openId)
  const detail = vault?.cards.find((c) => c.id === detailId)

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">View only</p>
          <h1>{ownerEmail ? `${ownerEmail}'s vault` : 'Shared vault'}</h1>
        </div>
        <button onClick={onClose}>Close</button>
      </header>

      {error && <p className="error">{error} <button onClick={load}>Retry</button></p>}
      {!vault && !error && <p className="status">Loading…</p>}

      {vault && (
        <>
          <div className="seg wide" role="tablist">
            <button className={tab === 'home' ? 'on' : ''} onClick={() => setTab('home')}>Overview</button>
            <button
              className={tab === 'collections' ? 'on' : ''}
              onClick={() => {
                setTab('collections')
                setOpenId(null)
              }}
            >
              Collections
            </button>
          </div>

          {tab === 'home' && <Home state={vault} onCard={setDetailId} onStart={noop} readOnly />}

          {tab === 'collections' && open && (
            <CollectionView
              key={open.id}
              collection={open}
              owned={vault.cards.filter((c) => c.collectionId === open.id)}
              onBack={() => setOpenId(null)}
              onChangeSet={noop}
              onCard={setDetailId}
              onQty={noop}
              onCollect={noop}
              onPatch={noop}
              onDelete={noop}
              readOnly
            />
          )}

          {tab === 'collections' && !open && (
            <div className="tiles">
              {vault.collections.length === 0 && <div className="empty"><b>No collections</b></div>}
              {vault.collections.map((c) => {
                const t = totals.get(c.id)
                const thumbs = vault.cards.filter((x) => x.collectionId === c.id).slice(0, 3)
                return (
                  <button className="tile" key={c.id} onClick={() => setOpenId(c.id)}>
                    <div className="fan">{thumbs.map((x) => <img key={x.id} src={x.image} alt="" />)}</div>
                    <strong>{c.name}</strong>
                    <span className="badge">{adapterFor(c.game).label}</span>
                    <span className="sub">{t?.count ?? 0} cards{c.setName ? ` · ${c.setName}` : ''}</span>
                    <span className="sub gold">{money(t?.value ?? 0)}</span>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      {detail && (
        <div className="backdrop" onClick={() => setDetailId(null)}>
          <div className="detail" onClick={(e) => e.stopPropagation()}>
            <div className="grab" />
            <img src={detail.image} alt={detail.name} />
            <h2>{detail.name}</h2>
            <p className="meta-line">
              {detail.setName} · #{detail.number}
              {detail.rarity ? ` · ${detail.rarity}` : ''}
            </p>
            <p className="price-big">{detail.price != null ? money(detail.price) : 'No price'}</p>
            <p className="meta-line">×{detail.qty} owned</p>
            <button className="big ghost" onClick={() => setDetailId(null)}>Done</button>
          </div>
        </div>
      )}
    </div>
  )
}
