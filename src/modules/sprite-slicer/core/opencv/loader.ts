let _cv: any = null
let _loading: Promise<any> | null = null

export async function getCV(): Promise<any> {
  if (_cv) return _cv
  if (_loading) return _loading
  _loading = (async () => {
    const mod = await import('opencv-js-wasm')
    const cv = await (mod.default ?? mod)
    _cv = cv
    _loading = null
    return cv
  })()
  return _loading
}

export function preloadCV(): void {
  if (!_cv && !_loading) getCV()
}
