import { useEffect, useRef, useState } from 'react'
import { cropGuide } from './lib/frame'
import { CAMERA_CONSTRAINTS, keepFocused, ZONES } from './lib/zones'
import type { Game } from './lib/types'

interface Props {
  game: Game
  onCapture: (card: HTMLCanvasElement) => void
  onCancel: () => void
}

const RATIO = 63 / 88 // standard card width / height

/** Full-screen viewfinder with a card-shaped guide; captures only what is inside the guide. */
export default function Camera({ game, onCapture, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const guideRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let stream: MediaStream | undefined
    let cancelled = false
    navigator.mediaDevices
      ?.getUserMedia(CAMERA_CONSTRAINTS)
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop())
        stream = s
        keepFocused(s)
        if (videoRef.current) {
          videoRef.current.srcObject = s
          videoRef.current.play().catch(() => {})
        }
      })
      .catch(() => setError('Camera not available. Allow camera access, or use "Choose photo".'))
    if (!navigator.mediaDevices) setError('Camera not available in this browser.')
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  function capture() {
    if (!videoRef.current || !boxRef.current || !guideRef.current) return
    const card = cropGuide(videoRef.current, boxRef.current, guideRef.current)
    if (card) onCapture(card)
  }

  return (
    <div className="camera" ref={boxRef}>
      <video ref={videoRef} playsInline muted />
      <div className="guide" ref={guideRef} style={{ aspectRatio: String(RATIO) }}>
        {ZONES[game].map((z) => (
          <span
            key={z.label + z.box.join()}
            className="zone"
            style={{ left: `${z.box[0] * 100}%`, top: `${z.box[1] * 100}%`, width: `${(z.box[2] - z.box[0]) * 100}%`, height: `${(z.box[3] - z.box[1]) * 100}%` }}
          >
            <i>{z.label}</i>
          </span>
        ))}
      </div>
      <p className="camera-hint">{error || 'Line the card up with the frame. Keep the marked areas sharp and glare-free.'}</p>
      <div className="camera-actions">
        <button onClick={onCancel}>Cancel</button>
        <button className="shutter" onClick={capture} disabled={!!error} aria-label="Capture" />
        <span />
      </div>
    </div>
  )
}
