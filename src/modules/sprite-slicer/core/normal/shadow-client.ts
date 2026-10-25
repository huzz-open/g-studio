import type { ShadowGeometry } from './shadow-geometry'
const cache = new WeakMap<ImageData, ShadowGeometry>()

export function computeShadowGeometry(image: ImageData, signal: AbortSignal): Promise<ShadowGeometry> {
  if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'))
  const previous = cache.get(image)
  if (previous) return Promise.resolve(previous)
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./shadow.worker.ts', import.meta.url), { type: 'module' })
    const cleanup = () => { worker.terminate(); signal.removeEventListener('abort', abort) }
    const abort = () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')) }
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<{ result?: ShadowGeometry; error?: string }>) => {
      cleanup()
      if (!event.data.result) { reject(new Error(event.data.error)); return }
      cache.set(image, event.data.result); resolve(event.data.result)
    }
    worker.onerror = event => { cleanup(); reject(new Error(event.message || 'Shadow worker failed')) }
    worker.postMessage({ data: image.data, width: image.width, height: image.height })
  })
}
