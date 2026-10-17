import type { Game } from './types'

/** Where each game's reader looks on a card (fractions of the card), shown as markers on the camera guide. */
export interface Zone {
  label: string
  box: [number, number, number, number] // x0, y0, x1, y1
}

export const ZONES: Record<Game, Zone[]> = {
  pokemon: [
    { label: 'name', box: [0.05, 0.035, 0.76, 0.125] },
    { label: 'number', box: [0.03, 0.93, 0.5, 0.995] },
    { label: 'number', box: [0.5, 0.93, 0.97, 0.995] }, // older cards print it bottom-right
  ],
  yugioh: [
    { label: 'name', box: [0.05, 0.03, 0.87, 0.105] },
    { label: 'set code', box: [0.66, 0.708, 0.98, 0.745] },
  ],
}

/** Ask for the sharpest picture the phone will give, and keep autofocus running. */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: 'environment',
    width: { ideal: 3840 },
    height: { ideal: 2160 },
  },
  audio: false,
}

export function keepFocused(stream: MediaStream) {
  const track = stream.getVideoTracks()[0]
  if (!track?.applyConstraints) return
  // Not every phone or browser supports this; it is a harmless no-op where it is unavailable.
  track
    .applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] })
    .catch(() => {})
}
