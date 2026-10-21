import * as ort from 'onnxruntime-web/wasm'
import wasmUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url'
import mjsUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url'

/**
 * A small pretrained "picture understanding" model (DINOv2-small, 8-bit, 24 MB) that runs on the phone.
 * It turns a card picture into a list of 384 numbers (an "embedding") such that two pictures of the same
 * card give nearly the same numbers, even with glare, blur or a slightly different crop.
 * The model file and its engine are downloaded once and kept by the service worker, so it works offline.
 */

const SIZE = 224
// Where the artwork sits on a card, as fractions of the card. Only this part is read: the text boxes and frame
// look alike on every card, are blurry in a phone photo, and in testing they swamped the difference between cards.
const ART = { x0: 0.07, y0: 0.1, x1: 0.93, y1: 0.48 }
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]
const base = import.meta.env.BASE_URL
let session: Promise<ort.InferenceSession> | null = null

/** Load the model (once). Rejects if the files cannot be fetched. */
export function loadModel(): Promise<ort.InferenceSession> {
  if (!session) {
    ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl }
    ort.env.wasm.numThreads = 1 // multi-threading needs special server headers that GitHub Pages cannot send
    ort.env.wasm.proxy = false
    session = ort.InferenceSession.create(`${base}models/dinov2-small-q.onnx`, { executionProviders: ['wasm'] }).catch((e) => {
      session = null
      throw e
    })
  }
  return session
}

let scratch: HTMLCanvasElement | null = null

/** Normalised pixel data (CHW floats) of the card's artwork squeezed to 224×224. */
function toTensorData(src: CanvasImageSource): Float32Array {
  const { width: W, height: H } = src as { width: number; height: number }
  scratch ??= document.createElement('canvas')
  scratch.width = SIZE
  scratch.height = SIZE
  const ctx = scratch.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, ART.x0 * W, ART.y0 * H, (ART.x1 - ART.x0) * W, (ART.y1 - ART.y0) * H, 0, 0, SIZE, SIZE)
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data
  const out = new Float32Array(3 * SIZE * SIZE)
  const plane = SIZE * SIZE
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) out[c * plane + i] = (px[i * 4 + c] / 255 - MEAN[c]) / STD[c]
  }
  return out
}

export const unit = (v: Float32Array) => {
  let n = 0
  for (let i = 0; i < v.length; i++) n += v[i] * v[i]
  n = Math.sqrt(n) || 1
  for (let i = 0; i < v.length; i++) v[i] /= n
  return v
}

export const EMBED_DIM = 384

/**
 * Embedding of a card's artwork (the model's class token, unit length). The picture must be cropped to the card.
 */
export async function embed(src: CanvasImageSource): Promise<Float32Array> {
  const s = await loadModel()
  const input = new ort.Tensor('float32', toTensorData(src), [1, 3, SIZE, SIZE])
  const out = await s.run({ [s.inputNames[0]]: input })
  const data = out[s.outputNames[0]].data as Float32Array
  return unit(Float32Array.from(data.subarray(0, EMBED_DIM)))
}
