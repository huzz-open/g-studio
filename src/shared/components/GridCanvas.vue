<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import PanZoomViewport from './PanZoomViewport.vue'

const props = withDefaults(defineProps<{
  cols: number
  rows: number
  originX?: number
  originY?: number
  cellSize?: number
  gridLineColor?: string
  bgColor?: string
  paintCells?: (ctx: CanvasRenderingContext2D) => void
}>(), {
  originX: 0,
  originY: 0,
  cellSize: 16,
  gridLineColor: 'rgba(255,255,255,0.06)',
  bgColor: '#1a1a1a',
})

const emit = defineEmits<{
  'cell-down': [x: number, y: number, button: number]
  'cell-move': [x: number, y: number]
  'cell-up': []
}>()

const pzvRef = ref<InstanceType<typeof PanZoomViewport>>()
const canvasEl = ref<HTMLCanvasElement>()

// --- Render with rAF batching for pan/zoom ---
let rafId = 0

function scheduleRender() {
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = 0
    render()
  })
}

function render() {
  const canvas = canvasEl.value
  const pzv = pzvRef.value
  if (!canvas || !pzv) return

  const vw = pzv.containerWidth
  const vh = pzv.containerHeight
  if (vw === 0 || vh === 0) return

  const dpr = window.devicePixelRatio || 1
  const newW = vw * dpr
  const newH = vh * dpr
  if (canvas.width !== newW || canvas.height !== newH) {
    canvas.width = newW
    canvas.height = newH
    canvas.style.width = vw + 'px'
    canvas.style.height = vh + 'px'
  }

  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.imageSmoothingEnabled = false

  const s = pzv.scale
  const px = pzv.panX
  const py = pzv.panY
  const cs = props.cellSize

  ctx.fillStyle = props.bgColor
  ctx.fillRect(0, 0, vw, vh)

  if (props.paintCells) {
    ctx.save()
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * px, dpr * py)
    props.paintCells(ctx)
    ctx.restore()
  }

  // Grid lines in screen coordinates — always 1px
  const visLeft = -px / s
  const visTop = -py / s
  const visRight = (vw - px) / s
  const visBottom = (vh - py) / s

  const firstCol = Math.floor(visLeft / cs)
  const lastCol = Math.ceil(visRight / cs)
  const firstRow = Math.floor(visTop / cs)
  const lastRow = Math.ceil(visBottom / cs)

  ctx.strokeStyle = props.gridLineColor
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let c = firstCol; c <= lastCol; c++) {
    const sx = Math.round(c * cs * s + px) + 0.5
    ctx.moveTo(sx, 0)
    ctx.lineTo(sx, vh)
  }
  for (let r = firstRow; r <= lastRow; r++) {
    const sy = Math.round(r * cs * s + py) + 0.5
    ctx.moveTo(0, sy)
    ctx.lineTo(vw, sy)
  }
  ctx.stroke()
}

function onPanOrScaleChange() { scheduleRender() }
function onResize() { nextTick(render) }

watch([() => props.cols, () => props.rows, () => props.cellSize, () => props.originX, () => props.originY], () => {
  nextTick(render)
})

onMounted(() => {
  nextTick(() => {
    render()
    fitToView()
  })
})

onUnmounted(() => {
  if (rafId) cancelAnimationFrame(rafId)
  cleanupDragListeners()
})

// --- Custom fitToView accounting for origin ---
function fitToView() {
  const pzv = pzvRef.value
  if (!pzv) return
  const vw = pzv.containerWidth
  const vh = pzv.containerHeight
  if (vw === 0 || vh === 0) return

  const cs = props.cellSize
  const cw = props.cols * cs
  const ch = props.rows * cs
  if (cw === 0 || ch === 0) return

  const s = Math.max(0.25, Math.min(16, Math.min(vw / cw, vh / ch) * 0.95))
  const ox = props.originX * cs

  const oy = props.originY * cs
  pzv.restoreState({
    scale: s,
    panX: (vw - cw * s) / 2 - ox * s,
    panY: (vh - ch * s) / 2 - oy * s,
  })
  scheduleRender()
}



// --- Cell interaction with Bresenham interpolation ---
let isCellDragging = false
let lastCell: { x: number; y: number } | null = null

function getCellFromEvent(e: MouseEvent): { x: number; y: number } | null {
  const pzv = pzvRef.value
  const container = pzv?.$el as HTMLElement | undefined
  if (!container) return null

  const rect = container.getBoundingClientRect()
  const cx = e.clientX - rect.left
  const cy = e.clientY - rect.top
  const worldX = (cx - pzv!.panX) / pzv!.scale
  const worldY = (cy - pzv!.panY) / pzv!.scale
  const cs = props.cellSize
  return { x: Math.floor(worldX / cs), y: Math.floor(worldY / cs) }
}

function bresenhamLine(x0: number, y0: number, x1: number, y1: number) {
  const cells: { x: number; y: number }[] = []
  let dx = Math.abs(x1 - x0)
  let dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  while (true) {
    cells.push({ x: x0, y: y0 })
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    const moveX = e2 > -dy
    const moveY = e2 < dx
    if (moveX) { err -= dy; x0 += sx }
    if (moveX && moveY) cells.push({ x: x0, y: y0 })
    if (moveY) { err += dx; y0 += sy }
  }
  return cells
}

function onCanvasPointerDown(e: PointerEvent) {
  if (e.button === 1) return
  if (e.button === 0 && (e.altKey || e.ctrlKey)) return
  const cell = getCellFromEvent(e)
  if (!cell) return
  e.preventDefault()
  isCellDragging = true
  lastCell = cell
  emit('cell-down', cell.x, cell.y, e.button)
  document.addEventListener('pointermove', onDocPointerMove)
  document.addEventListener('pointerup', onDocPointerUp)
  document.addEventListener('pointercancel', onDocPointerUp)
}

function onDocPointerMove(e: PointerEvent) {
  if (!isCellDragging) return
  const cell = getCellFromEvent(e)
  if (!cell) return
  if (lastCell && (cell.x !== lastCell.x || cell.y !== lastCell.y)) {
    const line = bresenhamLine(lastCell.x, lastCell.y, cell.x, cell.y)
    for (let i = 1; i < line.length; i++) {
      emit('cell-move', line[i].x, line[i].y)
    }
  }
  lastCell = cell
}

function onDocPointerUp() {
  if (!isCellDragging) return
  isCellDragging = false
  lastCell = null
  emit('cell-up')
  cleanupDragListeners()
}

function cleanupDragListeners() {
  document.removeEventListener('pointermove', onDocPointerMove)
  document.removeEventListener('pointerup', onDocPointerUp)
  document.removeEventListener('pointercancel', onDocPointerUp)
}

function requestRender() { render() }

defineExpose({ requestRender, fitToView })
</script>

<template>
  <div class="grid-canvas" tabindex="0">
    <slot name="toolbar" />
    <PanZoomViewport
      ref="pzvRef"
      transform-mode="logical"
      pan-mode="middle"
      :min-scale="0.25"
      :max-scale="16"
      :checker-background="false"
      :pixelated="true"
      viewport-cursor="crosshair"
      :show-controls="true"
      :custom-fit-to-view="fitToView"
      @scale-change="onPanOrScaleChange"
      @pan-change="onPanOrScaleChange"
      @resize="onResize"
    >
      <canvas
        ref="canvasEl"
        class="gc-canvas"
        @pointerdown="onCanvasPointerDown"
        @contextmenu.prevent
      />
    </PanZoomViewport>
  </div>
</template>

<style scoped>
.grid-canvas {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  outline: none;
  min-height: 0;
  position: relative;
}
.gc-canvas {
  position: absolute;
  top: 0;
  left: 0;
  image-rendering: pixelated;
}
</style>
