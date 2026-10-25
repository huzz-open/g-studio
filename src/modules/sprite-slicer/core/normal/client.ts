import { normalSettings, type NormalSettings } from '../../../../shared/types/normal-settings'
import type { PixelImage } from './generator'

// Weak keys prevent closed images retaining generated buffers indefinitely.
const cache = new WeakMap<ImageData, { key: string; result: ImageData }>()

export function computeNormals(image: ImageData, options?: NormalSettings, signal?: AbortSignal): Promise<ImageData> {
  const settings = normalSettings(options), key = JSON.stringify(settings)
  if (signal?.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'))
  const previous = cache.get(image)
  if (previous?.key === key) return Promise.resolve(previous.result)
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./normal.worker.ts', import.meta.url), { type: 'module' })
    const cleanup = () => { worker.terminate(); signal?.removeEventListener('abort', abort) }
    const abort = () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')) }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<{ result?: PixelImage; error?: string }>) => {
      cleanup()
      if (!event.data.result) { reject(new Error(event.data.error)); return }
      const { data, width, height } = event.data.result
      const result = new ImageData(new Uint8ClampedArray(data), width, height)
      cache.set(image, { key, result }); resolve(result)
    }
    worker.onerror = (event) => { cleanup(); reject(new Error(event.message || 'Normal worker failed')) }
    worker.postMessage({ image: { width: image.width, height: image.height, data: image.data }, settings })
  })
}
