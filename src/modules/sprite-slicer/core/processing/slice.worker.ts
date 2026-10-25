import type { SliceTask, SliceResult } from './types'
import type { DetectedSprite, GridDetectOptions } from '../../interfaces/sprite-detector'
import { AutoRemover } from '../background/auto-remover'
import { opencvSeeds } from '../detection/opencv-detector'
import { prepareDetection, regionsFromPrepared } from '../detection/sprites-from-labels'
import { autoArrangeRects } from '../layout/bin-packer'

declare const FileReaderSync: { new(): { readAsDataURL(blob: Blob): string } }
const reader = new FileReaderSync()
let clean: ImageData | undefined, cleanUrl = '', cleanKey = ''
let prepared: ReturnType<typeof prepareDetection> | undefined
let detector: SliceResult['detector'] = 'grid'

function surface(w: number, h: number) {
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  return { canvas, ctx }
}
async function png(image: ImageData) {
  const { canvas, ctx } = surface(image.width, image.height)
  ctx.putImageData(image, 0, 0)
  return reader.readAsDataURL(await canvas.convertToBlob({ type: 'image/png' }))
}
async function sprite(imageData: ImageData, rect: DetectedSprite['rect'], id: number): Promise<DetectedSprite> {
  return { id, rect, imageData, dataUrl: await png(imageData), name: `sprite-${String(id + 1).padStart(2, '0')}` }
}
async function grid(image: ImageData, options: GridDetectOptions) {
  const { cols, rows, gapH, gapV, marginH, marginV } = options
  if (![cols, rows, gapH, gapV, marginH, marginV].every(Number.isFinite) || cols < 1 || rows < 1) throw new Error('Invalid grid parameters')
  const w = Math.floor((image.width - 2 * marginH - (cols - 1) * gapH) / cols)
  const h = Math.floor((image.height - 2 * marginV - (rows - 1) * gapV) / rows)
  if (w <= 0 || h <= 0) return []
  const { ctx } = surface(image.width, image.height); ctx.putImageData(image, 0, 0)
  const result: DetectedSprite[] = []
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const x = marginH + col * (w + gapH), y = marginV + row * (h + gapV)
    if (x + w > image.width || y + h > image.height) continue
    const data = ctx.getImageData(x, y, w, h)
    let nonempty = false
    for (let p = 3; p < data.data.length; p += 4) if (data.data[p] >= 10) { nonempty = true; break }
    if (nonempty) result.push(await sprite(data, { x, y, w, h }, row * cols + col))
  }
  return result
}

async function process(input: SliceTask): Promise<SliceResult> {
  const key = JSON.stringify([input.sourceId, input.background])
  if (!clean || key !== cleanKey) {
    clean = new ImageData(new Uint8ClampedArray(input.image.data), input.image.width, input.image.height)
    if (input.background.id === 'auto') new AutoRemover().remove(clean, input.background.options)
    cleanUrl = await png(clean); cleanKey = key; prepared = undefined
  }
  let sprites: DetectedSprite[]
  if (input.detection.mode === 'auto') {
    if (!prepared) {
      let seeds: Int32Array
      try { seeds = await opencvSeeds(clean); detector = 'opencv' }
      catch (error) { console.warn('[slicer] OpenCV worker unavailable:', error); seeds = new Int32Array(clean.width * clean.height); detector = 'fallback' }
      prepared = prepareDetection(clean, clean.width, clean.height, seeds)
    }
    const regions = regionsFromPrepared(clean, clean.width, clean.height, prepared, input.detection)
    sprites = []
    for (const [id, region] of regions.entries()) sprites.push(await sprite(new ImageData(region.pixels, region.rect.w, region.rect.h), region.rect, id))
  } else sprites = await grid(clean, input.detection)
  let width = clean.width, height = clean.height, displayUrl = cleanUrl
  if (input.arrange !== 'none' && sprites.length) {
    const maxW = Math.max(...sprites.map(s => s.rect.w)), maxH = Math.max(...sprites.map(s => s.rect.h))
    const cols = Math.ceil(Math.sqrt(sprites.length))
    const packed = input.arrange === 'bin-pack' ? autoArrangeRects(sprites.map(s => s.rect), 1) : null
    width = packed?.canvasW ?? cols * maxW
    height = packed?.canvasH ?? Math.ceil(sprites.length / cols) * maxH
    const sheet = surface(width, height)
    for (let i = 0; i < sprites.length; i++) {
      const s = sprites[i]
      s._origRect = { ...s.rect }; s._origDataUrl = s.dataUrl; s._origImageData = s.imageData
      if (packed) s.rect = packed.arranged[i]
      else {
        const cell = surface(maxW, maxH)
        cell.ctx.putImageData(s.imageData, Math.round((maxW - s.rect.w) / 2), Math.round((maxH - s.rect.h) / 2))
        s.imageData = cell.ctx.getImageData(0, 0, maxW, maxH); s.dataUrl = await png(s.imageData)
        s.rect = { x: i % cols * maxW, y: Math.floor(i / cols) * maxH, w: maxW, h: maxH }
      }
      sheet.ctx.putImageData(s.imageData, s.rect.x, s.rect.y)
    }
    displayUrl = reader.readAsDataURL(await sheet.canvas.convertToBlob({ type: 'image/png' }))
  }
  return { clean, cleanUrl, displayUrl, width, height, sprites, detector: input.detection.mode === 'grid' ? 'grid' : detector }
}

self.onmessage = async (event: MessageEvent<{ id: number; input: SliceTask }>) => {
  const { id, input } = event.data
  try { self.postMessage({ id, result: await process(input) }) }
  catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }) }
}
