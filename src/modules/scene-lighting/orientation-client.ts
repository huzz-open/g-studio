import type { Mesh } from './model'
import type { OrientationResult, Pixels } from './orientation-fit'
import type { Vec3 } from '../experiments/umbrella/math'

export function searchOrientation(mesh: Mesh, pixels: Pixels, initial: Vec3, signal: AbortSignal, onProgress: (value: number) => void, initialProjection: Vec3 = [0, 0, 0]): Promise<OrientationResult> {
  if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'))
  const positions = new Float32Array(mesh.vertices.length / 3)
  for (let i = 0, j = 0; i < mesh.vertices.length; i += 9, j += 3) positions.set(mesh.vertices.subarray(i, i + 3), j)
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./orientation-fit.worker.ts', import.meta.url), { type: 'module' })
    const cleanup = () => { worker.terminate(); signal.removeEventListener('abort', abort) }
    const abort = () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')) }
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<{ progress?: number; result?: OrientationResult; error?: string }>) => {
      if (event.data.progress !== undefined) { onProgress(event.data.progress); return }
      cleanup()
      if (event.data.result) resolve(event.data.result)
      else reject(new Error(event.data.error || 'Orientation search failed'))
    }
    worker.onerror = event => { cleanup(); reject(new Error(event.message || 'Orientation search failed')) }
    worker.postMessage({ positions, pixels, initial, initialProjection }, [positions.buffer])
  })
}
