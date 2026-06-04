/**
 * Pure logic utilities for resolving image data from drag-and-drop DataTransfer.
 * No UI side effects (no toast, no console) — caller handles errors.
 */

export function extractImageUrl(dt: DataTransfer): string | null {
  // Priority 1: HTML fragment — extract actual <img src> (most reliable for web drags)
  const html = dt.getData('text/html')
  if (html) {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const img = doc.querySelector('img[src]')
    if (img) {
      const src = img.getAttribute('src')!
      if (src.startsWith('http')) return src
    }
  }

  // Priority 2: text/uri-list
  const uriList = dt.getData('text/uri-list')
  if (uriList) {
    const url = uriList.split('\n').find(l => l.trim() && !l.startsWith('#'))
    if (url) {
      const resolved = resolveToDirectImageUrl(url.trim())
      if (resolved) return resolved
    }
  }

  // Priority 3: plain text URL
  const text = dt.getData('text/plain')?.trim()
  if (text) {
    const resolved = resolveToDirectImageUrl(text)
    if (resolved) return resolved
  }

  return null
}

function resolveToDirectImageUrl(url: string): string | null {
  try {
    const u = new URL(url)

    // GitHub blob page URL → transform to raw URL
    const ghBlobMatch = u.hostname === 'github.com'
      && u.pathname.match(/^\/([^/]+\/[^/]+)\/blob\/(.+)/)
    if (ghBlobMatch) {
      const [, repo, path] = ghBlobMatch
      if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(path)) {
        return `https://raw.githubusercontent.com/${repo}/${path}`
      }
    }

    if (/\.(png|jpe?g|gif|webp|svg|bmp)(\?.*)?$/i.test(u.pathname)) return url
    if (u.hostname === 'raw.githubusercontent.com') return url
    if (u.hostname.includes('gimg') && u.pathname.includes('image_search')) return url

    return null
  } catch {
    return null
  }
}

export async function fetchImageAsFile(url: string): Promise<File> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  let res: Response
  try {
    res = await fetch(url, { signal: controller.signal, mode: 'cors' })
  } catch (e) {
    clearTimeout(timeout)
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error('timeout')
    }
    throw new Error('cors')
  }
  clearTimeout(timeout)

  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  const blob = await res.blob()
  if (!blob.type.startsWith('image/')) {
    throw new Error('not-image')
  }

  const filename = guessFilename(url, blob.type)
  return new File([blob], filename, { type: blob.type })
}

function guessFilename(url: string, contentType: string): string {
  try {
    const pathname = new URL(url).pathname
    const name = decodeURIComponent(pathname.split('/').pop() || '')
    if (name && /\.\w+$/.test(name)) return name
  } catch { /* ignore */ }
  const ext = contentType.split('/')[1]?.split(';')[0] || 'png'
  return `image-${Date.now()}.${ext}`
}
