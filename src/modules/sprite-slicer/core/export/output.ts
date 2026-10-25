import { PngExporter } from './png-exporter'
import { createOffscreenCanvas } from '../utils/canvas-utils'
import { computeNormals } from '../normal/client'
import { spritePixels } from '../normal/source'
import type { DetectedSprite } from '../../interfaces/sprite-detector'

export interface OutputOptions { composite: boolean; sprites: boolean; meta: boolean; normals: boolean }
export interface OutputFile { name: string; blob: Blob }
export function safeBaseName(name: string) {
  return name.replace(/\.png$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '') || 'sprite'
}
export function pairedNames(sprites: Pick<DetectedSprite, 'name'>[], normals: boolean): string[] {
  const used = new Set<string>()
  return sprites.map(sprite => {
    const base = safeBaseName(sprite.name)
    let name = base, suffix = 2
    while (used.has(`${name}.png`.toLowerCase()) || (normals && used.has(`${name}_normal.png`.toLowerCase()))) name = `${base}-${suffix++}`
    used.add(`${name}.png`.toLowerCase())
    if (normals) used.add(`${name}_normal.png`.toLowerCase())
    return name
  })
}

export async function buildOutput(sprites: DetectedSprite[], size: { w: number; h: number }, name: string,
  options: OutputOptions, progress: (done: number, total: number) => void = () => {}) {
  if (!sprites.length || (!options.composite && !options.sprites)) throw new Error('No sprites selected')
  // Snapshot settings/rects before awaiting, so editing during export cannot mix revisions.
  const names = pairedNames(sprites, options.normals)
  const snapshot = sprites.map((s, i) => ({ ...s, rect: { ...s.rect }, name: names[i], normalSettings: s.normalSettings ? { ...s.normalSettings } : undefined }))
  // Start decoding synchronously with the snapshot; later edits cannot change this export.
  const decoded = sprites.map(sprite => spritePixels(sprite))
  const pixels = await Promise.all(decoded.map((promise, i) => promise.catch(error => {
    throw new Error(`${snapshot[i].name}: ${error instanceof Error ? error.message : String(error)}`)
  })))
  snapshot.forEach((sprite, i) => { sprite.imageData = pixels[i] })
  const normals = new Map<number, ImageData>()
  if (options.normals) {
    for (let i = 0; i < snapshot.length; i++) {
      const sprite = snapshot[i]
      progress(i, snapshot.length)
      try { normals.set(sprite.id, await computeNormals(sprite.imageData, sprite.normalSettings)) }
      catch (error) { throw new Error(`${sprite.name}: ${error instanceof Error ? error.message : String(error)}`) }
    }
    progress(snapshot.length, snapshot.length)
  }
  const exporter = new PngExporter(), files: OutputFile[] = [], base = safeBaseName(name)
  if (options.composite) {
    for (const normal of options.normals ? [false, true] : [false]) {
      const { ctx } = createOffscreenCanvas(size.w, size.h)
      for (const sprite of snapshot) {
        const pixels = normal ? normals.get(sprite.id)! : sprite.imageData
        const { canvas, ctx: cell } = createOffscreenCanvas(pixels.width, pixels.height)
        cell.putImageData(pixels, 0, 0)
        ctx.drawImage(canvas, sprite.rect.x, sprite.rect.y)
      }
      files.push({ name: `${base}${normal ? '_normal' : ''}.png`, blob: await exporter.exportPng(snapshot, ctx.getImageData(0, 0, size.w, size.h)) })
    }
    if (options.meta) files.push({ name: `${base}.json`, blob: await exporter.exportMetaJson(snapshot) })
  }
  if (options.sprites) {
    const JSZip = (await import('jszip')).default, zip = new JSZip()
    for (const sprite of snapshot) {
      zip.file(`${sprite.name}.png`, await (await exporter.exportPng([sprite], sprite.imageData)).arrayBuffer())
      if (options.normals) zip.file(`${sprite.name}_normal.png`, await (await exporter.exportPng([sprite], normals.get(sprite.id)!)).arrayBuffer())
    }
    files.push({ name: `${base}-sprites.zip`, blob: await zip.generateAsync({ type: 'blob' }) })
  }
  return files
}
