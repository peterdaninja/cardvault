import { useEffect, useRef, useState } from 'react'

interface Props {
  onCapture: (card: HTMLCanvasElement) => void
  onCancel: () => void
}

const RATIO = 63 / 88 // standard card width / height

/** Full-screen viewfinder with a card-shaped guide; captures only what is inside the guide. */
export default function Camera({ onCapture, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const guideRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let stream: MediaStream | undefined
    let cancelled = false
    navigator.mediaDevices
      ?.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop())
        stream = s
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
    const video = videoRef.current
    const box = boxRef.current
    const guide = guideRef.current
    if (!video || !box || !guide || !video.videoWidth) return

    // The video is shown with object-fit: cover; map the guide rectangle back to video pixels.
    const b = box.getBoundingClientRect()
    const g = guide.getBoundingClientRect()
    const scale = Math.max(b.width / video.videoWidth, b.height / video.videoHeight)
    const offX = (video.videoWidth * scale - b.width) / 2
    const offY = (video.videoHeight * scale - b.height) / 2
    const sx = (g.left - b.left + offX) / scale
    const sy = (g.top - b.top + offY) / scale
    const sw = g.width / scale
    const sh = g.height / scale

    const out = document.createElement('canvas')
    out.width = Math.round(sw)
    out.height = Math.round(sh)
    out.getContext('2d')!.drawImage(video, sx, sy, sw, sh, 0, 0, out.width, out.height)
    onCapture(out)
  }

  return (
    <div className="camera" ref={boxRef}>
      <video ref={videoRef} playsInline muted />
      <div className="guide" ref={guideRef} style={{ aspectRatio: String(RATIO) }} />
      <p className="camera-hint">{error || 'Line the card up with the frame. Keep it flat and avoid glare.'}</p>
      <div className="camera-actions">
        <button onClick={onCancel}>Cancel</button>
        <button className="shutter" onClick={capture} disabled={!!error} aria-label="Capture" />
        <span />
      </div>
    </div>
  )
}
