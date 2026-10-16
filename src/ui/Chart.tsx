import { useRef } from 'react'
import type { Snapshot } from '../lib/types'

interface Props {
  points: Snapshot[]
  up: boolean // colors the line green (gain) or red (loss)
  hover: number | null
  onHover: (index: number | null) => void
}

const W = 300
const H = 130
const PAD_Y = 14

/** Smooth-ish area chart of collection value. Drag or hover to inspect a point. */
export default function Chart({ points, up, hover, onHover }: Props) {
  const box = useRef<HTMLDivElement>(null)
  if (points.length < 2) return <div className="chart empty-chart" />

  const t0 = points[0].t
  const t1 = points[points.length - 1].t
  const span = Math.max(1, t1 - t0)
  const values = points.map((p) => p.value)
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const range = hi - lo || Math.max(1, hi * 0.1)

  const xy = points.map((p) => ({
    x: ((p.t - t0) / span) * W,
    y: PAD_Y + (1 - (p.value - lo) / range) * (H - PAD_Y * 2),
  }))
  // Step-wise lines are honest for snapshots taken at discrete moments, so draw straight segments.
  const line = xy.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const area = `${line} L${W} ${H} L0 ${H} Z`
  const color = up ? 'var(--good)' : 'var(--danger)'

  function locate(clientX: number) {
    const r = box.current!.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    const target = t0 + frac * span
    let best = 0
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(points[i].t - target) < Math.abs(points[best].t - target)) best = i
    }
    onHover(best)
  }

  const marker = hover != null ? xy[hover] : null

  return (
    <div
      className="chart"
      ref={box}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        locate(e.clientX)
      }}
      onPointerMove={(e) => (e.buttons || e.pointerType === 'mouse') && locate(e.clientX)}
      onPointerUp={() => onHover(null)}
      onPointerLeave={() => onHover(null)}
      onPointerCancel={() => onHover(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="chartfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.38" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#chartfill)" />
        <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {marker && (
        <>
          <span className="chart-line" style={{ left: `${(marker.x / W) * 100}%` }} />
          <span
            className="chart-dot"
            style={{ left: `${(marker.x / W) * 100}%`, top: `${(marker.y / H) * 100}%`, background: color }}
          />
        </>
      )}
    </div>
  )
}
