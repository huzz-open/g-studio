const CDN_URL = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.12.0-release.1/dist/opencv.js'
const LOCAL_URL = `${import.meta.env.BASE_URL}opencv.js`
const OPENCV_MODE = import.meta.env.VITE_OPENCV_MODE || 'auto'
const DOWNLOAD_TIMEOUT = Number(import.meta.env.VITE_OPENCV_DOWNLOAD_TIMEOUT) || 1000

let _cv: any = null
let _promise: Promise<any> | null = null

/**
 * Load OpenCV via <script> tag to bypass Vite ESM transformation
 * that breaks Emscripten's inline WASM init.
 *
 * VITE_OPENCV_MODE:
 *  - "local": always load from server, no CDN
 *  - "auto":  try downloading from server within VITE_OPENCV_DOWNLOAD_TIMEOUT ms,
 *             if download not finished in time, abort and use CDN instead
 *
 * delete cv.then MUST happen before resolve() to avoid Emscripten's
 * thenable trap (infinite Promise unwrap loop).
 */
function loadScript(src: string, label?: string): Promise<any> {
  const t0 = performance.now()
  const tag = label || src
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true

    script.onerror = () => reject(new Error(`Failed to load ${tag}`))

    script.onload = () => {
      const cv = (globalThis as any).cv
      if (!cv) { reject(new Error('globalThis.cv not set')); return }

      const finish = () => {
        delete cv.then
        _cv = cv
        console.log(`[OpenCV] ready (${Math.round(performance.now() - t0)}ms) from ${tag}`)
        resolve(cv)
      }

      if (cv.Mat) { finish(); return }
      cv.onRuntimeInitialized = () => finish()
    }

    document.head.appendChild(script)
  })
}

/**
 * auto 模式：用 fetch + AbortController 尝试从服务器下载 opencv.js，
 * DOWNLOAD_TIMEOUT 仅计算网络下载耗时。下载完成后通过 blob URL 交给 script 标签
 * 执行（JS 解析 + WASM 初始化不受超时限制，它们是本地计算，与网络无关）。
 * 下载超时则中断请求，改从 CDN 加载。
 */
async function loadCV(): Promise<any> {
  if (OPENCV_MODE === 'local') return loadScript(LOCAL_URL, 'local')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT)
  try {
    const resp = await fetch(LOCAL_URL, { signal: controller.signal })
    const blob = await resp.blob()
    clearTimeout(timer)
    return loadScript(URL.createObjectURL(blob), 'local')
  } catch {
    clearTimeout(timer)
    console.log(`[OpenCV] download exceeded ${DOWNLOAD_TIMEOUT}ms, switching to CDN`)
    return loadScript(CDN_URL, 'CDN')
  }
}

export async function getCV(): Promise<any> {
  if (_cv) return _cv
  if (!_promise) {
    _promise = loadCV().catch((err) => {
      _promise = null
      throw err
    })
  }
  return _promise
}

export function preloadCV(): void {
  if (!_cv && !_promise) getCV().catch(() => {})
}
