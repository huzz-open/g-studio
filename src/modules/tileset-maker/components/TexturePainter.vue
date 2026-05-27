<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import { useI18n } from '../../../shared/i18n'
import { useTilesetStore } from '../store'

const { t } = useI18n()
const store = useTilesetStore()

const emit = defineEmits<{ close: [] }>()

const canvasSize = ref(32)
const tool = ref<'pencil' | 'fill' | 'picker' | 'eraser'>('pencil')
const color = ref('#4a9e38')
const pixels = ref<Uint8ClampedArray>(new Uint8ClampedArray(32 * 32 * 4))

const canvasEl = ref<HTMLCanvasElement | null>(null)
const previewEl = ref<HTMLCanvasElement | null>(null)
const scale = computed(() => Math.floor(256 / canvasSize.value))

onMounted(() => {
  pixels.value.fill(0)
  drawCanvas()
  drawPreview()
})

watch([pixels, canvasSize], () => {
  drawCanvas()
  drawPreview()
}, { deep: true })

function drawCanvas() {
  const c = canvasEl.value
  if (!c) return
  const s = scale.value
  c.width = canvasSize.value * s
  c.height = canvasSize.value * s
  const ctx = c.getContext('2d')!
  const sz = canvasSize.value
  const imgData = new ImageData(new Uint8ClampedArray(pixels.value), sz, sz)
  const tmp = new OffscreenCanvas(sz, sz)
  tmp.getContext('2d')!.putImageData(imgData, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(tmp, 0, 0, c.width, c.height)
}

function drawPreview() {
  const c = previewEl.value
  if (!c) return
  const sz = canvasSize.value
  c.width = sz * 3
  c.height = sz * 3
  const ctx = c.getContext('2d')!
  const imgData = new ImageData(new Uint8ClampedArray(pixels.value), sz, sz)
  const tmp = new OffscreenCanvas(sz, sz)
  tmp.getContext('2d')!.putImageData(imgData, 0, 0)
  ctx.imageSmoothingEnabled = false
  for (let dy = 0; dy < 3; dy++) {
    for (let dx = 0; dx < 3; dx++) {
      ctx.drawImage(tmp, dx * sz, dy * sz)
    }
  }
}

function getPixelCoord(e: MouseEvent): { x: number; y: number } {
  const c = canvasEl.value!
  const rect = c.getBoundingClientRect()
  const s = scale.value
  const x = Math.floor((e.clientX - rect.left) / s)
  const y = Math.floor((e.clientY - rect.top) / s)
  return { x: Math.max(0, Math.min(canvasSize.value - 1, x)), y: Math.max(0, Math.min(canvasSize.value - 1, y)) }
}

function parseColor(hex: string): [number, number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return [r, g, b, 255]
}

function setPixel(x: number, y: number, rgba: [number, number, number, number]) {
  const idx = (y * canvasSize.value + x) * 4
  pixels.value[idx] = rgba[0]
  pixels.value[idx + 1] = rgba[1]
  pixels.value[idx + 2] = rgba[2]
  pixels.value[idx + 3] = rgba[3]
}

function getPixel(x: number, y: number): [number, number, number, number] {
  const idx = (y * canvasSize.value + x) * 4
  return [pixels.value[idx], pixels.value[idx + 1], pixels.value[idx + 2], pixels.value[idx + 3]]
}

let isDrawing = false

function onPointerDown(e: MouseEvent) {
  const { x, y } = getPixelCoord(e)
  if (tool.value === 'picker') {
    const [r, g, b] = getPixel(x, y)
    color.value = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
    return
  }
  if (tool.value === 'fill') {
    floodFill(x, y, parseColor(color.value))
    drawCanvas()
    drawPreview()
    return
  }
  isDrawing = true
  applyTool(x, y)
  drawCanvas()
  drawPreview()
}

function onPointerMove(e: MouseEvent) {
  if (!isDrawing) return
  const { x, y } = getPixelCoord(e)
  applyTool(x, y)
  drawCanvas()
  drawPreview()
}

function onPointerUp() { isDrawing = false }

function applyTool(x: number, y: number) {
  if (tool.value === 'pencil') setPixel(x, y, parseColor(color.value))
  else if (tool.value === 'eraser') setPixel(x, y, [0, 0, 0, 0])
}

function floodFill(sx: number, sy: number, rgba: [number, number, number, number]) {
  const sz = canvasSize.value
  const target = getPixel(sx, sy)
  if (target[0] === rgba[0] && target[1] === rgba[1] && target[2] === rgba[2] && target[3] === rgba[3]) return
  const stack: [number, number][] = [[sx, sy]]
  const visited = new Set<number>()
  while (stack.length > 0) {
    const [x, y] = stack.pop()!
    const key = y * sz + x
    if (visited.has(key)) continue
    visited.add(key)
    const p = getPixel(x, y)
    if (p[0] !== target[0] || p[1] !== target[1] || p[2] !== target[2] || p[3] !== target[3]) continue
    setPixel(x, y, rgba)
    if (x > 0) stack.push([x - 1, y])
    if (x < sz - 1) stack.push([x + 1, y])
    if (y > 0) stack.push([x, y - 1])
    if (y < sz - 1) stack.push([x, y + 1])
  }
}

function useTexture() {
  const sz = canvasSize.value
  store.setTextureFromPixels(new Uint8ClampedArray(pixels.value), sz, `drawn-${sz}x${sz}.png`)
  emit('close')
}
</script>

<template>
  <div class="texture-painter-overlay" @click.self="emit('close')">
    <div class="painter-dialog">
      <header class="painter-header">
        <h3>{{ t('tileset.painter.title') }}</h3>
        <button class="close-btn" @click="emit('close')">×</button>
      </header>
      <div class="painter-body">
        <div class="toolbar">
          <button :class="{ active: tool === 'pencil' }" @click="tool = 'pencil'">{{ t('tileset.painter.pencil') }}</button>
          <button :class="{ active: tool === 'fill' }" @click="tool = 'fill'">{{ t('tileset.painter.fill') }}</button>
          <button :class="{ active: tool === 'picker' }" @click="tool = 'picker'">{{ t('tileset.painter.picker') }}</button>
          <button :class="{ active: tool === 'eraser' }" @click="tool = 'eraser'">{{ t('tileset.painter.eraser') }}</button>
          <input type="color" v-model="color" class="color-input" />
          <select v-model.number="canvasSize" class="size-select">
            <option :value="32">32×32</option>
            <option :value="64">64×64</option>
          </select>
        </div>
        <div class="canvas-area">
          <canvas
            ref="canvasEl"
            class="draw-canvas"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointerleave="onPointerUp"
          />
          <div class="preview-label">3×3 Tiling</div>
          <canvas ref="previewEl" class="preview-canvas" />
        </div>
      </div>
      <footer class="painter-footer">
        <button class="btn-primary" @click="useTexture">{{ t('tileset.painter.save') }}</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.texture-painter-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 500;
}
.painter-dialog {
  background: #2a2a2a;
  border: 1px solid #555;
  border-radius: 10px;
  width: 640px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}
.painter-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #3a3a3a;
}
.painter-header h3 { font-size: 14px; color: #eee; margin: 0; }
.close-btn {
  background: none;
  border: none;
  color: #888;
  font-size: 20px;
  cursor: pointer;
}
.painter-body { padding: 16px; }
.toolbar {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
  align-items: center;
}
.toolbar button {
  padding: 4px 8px;
  font-size: 11px;
  border: 1px solid #444;
  border-radius: 4px;
  background: #333;
  color: #aaa;
  cursor: pointer;
}
.toolbar button.active { border-color: #6a8; color: #ade; background: #2a3a2e; }
.color-input { width: 28px; height: 28px; border: none; cursor: pointer; }
.size-select {
  margin-left: auto;
  padding: 3px 6px;
  font-size: 11px;
  background: #333;
  border: 1px solid #444;
  border-radius: 4px;
  color: #ccc;
}
.canvas-area {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.draw-canvas {
  border: 1px solid #555;
  cursor: crosshair;
  image-rendering: pixelated;
}
.preview-label {
  font-size: 10px;
  color: #888;
  writing-mode: vertical-rl;
}
.preview-canvas {
  border: 1px solid #444;
  image-rendering: pixelated;
  width: 96px;
  height: 96px;
}
.painter-footer {
  padding: 12px 16px;
  border-top: 1px solid #3a3a3a;
  text-align: right;
}
.btn-primary {
  padding: 6px 16px;
  font-size: 12px;
  background: #3a6a4a;
  border: 1px solid #5a9a6a;
  border-radius: 5px;
  color: #eee;
  cursor: pointer;
}
.btn-primary:hover { background: #4a8a5a; }
</style>
