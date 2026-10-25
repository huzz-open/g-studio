interface SpriteSource { dataUrl: string }
const sources = new WeakMap<SpriteSource, { url: string; pixels: Promise<ImageData> }>()

/** Decode the displayed PNG, so original, lighting and exported pixels share one source. */
export function spritePixels(sprite: SpriteSource): Promise<ImageData> {
  const url = sprite.dataUrl
  const cached = sources.get(sprite)
  if (cached?.url === url) return cached.pixels
  const pixels = (async () => {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Cannot decode sprite pixels')
    ctx.drawImage(image, 0, 0)
    return ctx.getImageData(0, 0, canvas.width, canvas.height)
  })()
  const entry = { url, pixels }
  sources.set(sprite, entry)
  void pixels.catch(() => { if (sources.get(sprite) === entry) sources.delete(sprite) })
  return pixels
}
