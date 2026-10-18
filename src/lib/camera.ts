import { keepFocused } from './zones'

export interface CameraInfo {
  deviceId: string
  label: string // e.g. "Back Camera", "Back Telephoto Camera"
  width: number // the larger side of the picture the camera is actually giving us
  height: number
  zoom: { min: number; max: number; step: number; value: number } | null // null when this phone doesn't allow it
}

export interface CameraChoice {
  id: string
  label: string
}

type ZoomCaps = { zoom?: { min: number; max: number; step?: number } }

/** Open a back camera at the sharpest picture it will give, optionally a specific one by id. */
export async function openCamera(deviceId?: string): Promise<{ stream: MediaStream; info: CameraInfo }> {
  const video: MediaTrackConstraints = { width: { ideal: 3840 }, height: { ideal: 2160 } }
  if (deviceId) video.deviceId = { exact: deviceId }
  else video.facingMode = 'environment'
  const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false })
  keepFocused(stream)

  const track = stream.getVideoTracks()[0]
  const settings = track.getSettings()
  const caps = (track.getCapabilities?.() ?? {}) as ZoomCaps
  const zoomValue = (settings as MediaTrackSettings & { zoom?: number }).zoom
  const info: CameraInfo = {
    deviceId: settings.deviceId ?? deviceId ?? '',
    label: track.label || 'Camera',
    width: Math.max(settings.width ?? 0, settings.height ?? 0),
    height: Math.min(settings.width ?? 0, settings.height ?? 0),
    zoom: caps.zoom ? { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step ?? 0.1, value: zoomValue ?? caps.zoom.min } : null,
  }
  return { stream, info }
}

/** The back cameras this phone offers (names appear once camera permission has been given). */
export async function listCameras(): Promise<CameraChoice[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((d) => d.kind === 'videoinput' && !/front|user|facetime/i.test(d.label))
      .map((d) => ({ id: d.deviceId, label: d.label || 'Camera' }))
  } catch {
    return []
  }
}

export async function applyZoom(stream: MediaStream, zoom: number): Promise<boolean> {
  try {
    await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ zoom } as MediaTrackConstraintSet] })
    return true
  } catch {
    return false
  }
}

const CAMERA_KEY = 'slowtcg-camera'
export const savedCameraId = () => {
  try {
    return localStorage.getItem(CAMERA_KEY) ?? undefined
  } catch {
    return undefined
  }
}
export const saveCameraId = (id: string) => {
  try {
    localStorage.setItem(CAMERA_KEY, id)
  } catch {
    /* the choice just won't be remembered */
  }
}
