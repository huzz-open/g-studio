import { computeNormals } from '../../modules/sprite-slicer/core/normal/client'
import type { PartAsset } from './schema'
import { clonePart } from './schema'

export function partImageUrl(part: PartAsset) {
  return part.image.uri.startsWith('builtin:') ? `${import.meta.env.BASE_URL}scene-lighting/${part.image.uri.slice(8)}.png` : part.image.uri
}
export async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('部件图片无法读取')); image.src = url
  })
}
export async function partPixels(part: PartAsset) {
  const image = await loadImage(partImageUrl(part))
  if (image.naturalWidth !== part.image.width || image.naturalHeight !== part.image.height) throw new Error('部件图片尺寸与元数据不一致')
  const canvas = document.createElement('canvas'); canvas.width = part.image.width; canvas.height = part.image.height
  const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
  return { image, pixels: ctx.getImageData(0, 0, canvas.width, canvas.height) }
}
export function pixelsUrl(pixels: ImageData) {
  const canvas = document.createElement('canvas'); canvas.width = pixels.width; canvas.height = pixels.height
  canvas.getContext('2d')!.putImageData(pixels, 0, 0); return canvas.toDataURL('image/png')
}
const normalCache = new Map<string, { key: string; promise: Promise<string> }>()
export function normalImageUrl(part: PartAsset): Promise<string> {
  const key = JSON.stringify([part.image, part.normal]), cached = normalCache.get(part.id)
  if (cached?.key === key) return cached.promise
  const snapshot = clonePart(part)
  const promise = partPixels(snapshot).then(({ pixels }) => computeNormals(pixels, snapshot.normal)).then(pixelsUrl)
  normalCache.set(part.id, { key, promise })
  while (normalCache.size > 32) normalCache.delete(normalCache.keys().next().value!)
  promise.catch(() => { if (normalCache.get(part.id)?.promise === promise) normalCache.delete(part.id) })
  return promise
}
export async function portablePart(part: PartAsset): Promise<PartAsset> {
  const copy = clonePart(part)
  if (copy.image.uri.startsWith('builtin:')) copy.image.uri = pixelsUrl((await partPixels(copy)).pixels)
  return copy
}
