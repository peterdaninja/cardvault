import type { AppState, OwnedCard, Snapshot } from './types'

export const totalValue = (cards: OwnedCard[]) => cards.reduce((s, c) => s + (c.price ?? 0) * c.qty, 0)
export const totalCount = (cards: OwnedCard[]) => cards.reduce((s, c) => s + c.qty, 0)

const MAX_POINTS = 1200

/**
 * For data saved before history existed: rebuild an estimate from when each card was added,
 * priced at today's prices. Real snapshots take over from here on.
 */
export function seedHistory(cards: OwnedCard[]): Snapshot[] {
  let value = 0
  let count = 0
  const out: Snapshot[] = []
  for (const c of [...cards].sort((a, b) => a.addedAt - b.addedAt)) {
    value += (c.price ?? 0) * c.qty
    count += c.qty
    out.push({ t: c.addedAt, value, count })
  }
  return out
}

/** Append a snapshot when value or card count changed since the last one. */
export function withSnapshot(state: AppState, now = Date.now()): AppState {
  const value = round2(totalValue(state.cards))
  const count = totalCount(state.cards)
  const history = state.history ?? seedHistory(state.cards)
  const last = history[history.length - 1]
  if (last && Math.abs(last.value - value) < 0.005 && last.count === count) {
    return state.history ? state : { ...state, history }
  }
  if (!last && count === 0) return { ...state, history }
  let next = [...history, { t: Math.max(now, (last?.t ?? 0) + 1), value, count }]
  if (next.length > MAX_POINTS) {
    // Thin out the older half so the chart stays light but keeps its overall shape.
    const half = Math.floor(next.length / 2)
    next = [...next.slice(0, half).filter((_, i) => i % 2 === 0), ...next.slice(half)]
  }
  return { ...state, history: next }
}

const round2 = (n: number) => Math.round(n * 100) / 100

export const RANGES = [
  { key: '1W', days: 7 },
  { key: '1M', days: 30 },
  { key: '3M', days: 90 },
  { key: '1Y', days: 365 },
  { key: 'ALL', days: Infinity },
] as const
export type RangeKey = (typeof RANGES)[number]['key']

/** Points to draw for a range: includes the value at the start of the window and a point at "now". */
export function seriesFor(history: Snapshot[], range: RangeKey, now = Date.now()): Snapshot[] {
  if (!history.length) return []
  const days = RANGES.find((r) => r.key === range)!.days
  const start = Number.isFinite(days) ? now - days * 86_400_000 : history[0].t
  const before = [...history].reverse().find((p) => p.t <= start)
  const inside = history.filter((p) => p.t > start)
  const pts: Snapshot[] = []
  if (before) pts.push({ ...before, t: start })
  pts.push(...inside)
  const last = history[history.length - 1]
  if (pts[pts.length - 1].t < now) pts.push({ ...last, t: now })
  if (pts.length === 1) pts.unshift({ ...pts[0], t: Math.min(start, pts[0].t - 86_400_000) })
  return pts
}
