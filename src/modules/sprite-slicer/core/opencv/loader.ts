let _cv: any = null
let _promise: Promise<any> | null = null

/**
 * Load OpenCV via <script> tag to bypass Vite ESM transformation
 * that breaks Emscripten's inline WASM init.
 *
 * Emscripten's Module has a .then() that traps Promise.resolve() in
 * an infinite unwrap loop — we delete it before resolving.
 */
function loadCV(): Promise<any> {
  const t0 = performance.now()
  let settled = false

  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `${import.meta.env.BASE_URL}opencv.js`
    script.async = true

    const done = (cv: any) => {
      if (settled) return
      settled = true
      delete cv.then
      _cv = cv
      console.log(`[OpenCV] ready (${Math.round(performance.now() - t0)}ms)`)
      resolve(cv)
    }

    const fail = (err: Error) => {
      if (settled) return
      settled = true
      _promise = null
      console.error('[OpenCV]', err.message)
      reject(err)
    }

    script.onerror = () => fail(new Error('Failed to load opencv.js'))

    script.onload = () => {
      const cv = (globalThis as any).cv
      if (!cv) { fail(new Error('globalThis.cv not set after script load')); return }
      if (cv.Mat) { done(cv); return }
      cv.onRuntimeInitialized = () => done(cv)
    }

    document.head.appendChild(script)
  })
}

export async function getCV(): Promise<any> {
  if (_cv) return _cv
  if (!_promise) _promise = loadCV()
  return _promise
}

export function preloadCV(): void {
  if (!_cv && !_promise) getCV().catch(() => {})
}
