<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import { useI18n } from '../../../shared/i18n'
import type { TilesetInstance } from '../store'
import { computePeering, findTilePosition } from '../core/preview'
import { getLayout } from '../core/layouts'

const { t } = useI18n()
const props = defineProps<{ store: TilesetInstance }>()
const canvasEl = ref<HTMLCanvasElement | null>(null)

const gridCols = computed(() => props.store.state.terrainGrid[0].length)
const gridRows = computed(() => props.store.state.terrainGrid.length)
const cellSize = computed(() => props.store.state.atlasTileW || 16)
const displayScale = computed(() => Math.max(1, Math.floor(192 / (gridCols.value * cellSize.value)) + 1))

const editCols = ref(gridCols.value)
const editRows = ref(gridRows.value)

watch(gridCols, (v) => { editCols.value = v })
watch(gridRows, (v) => { editRows.value = v })

function applySize() {
  const c = Math.max(3, Math.min(30, editCols.value))
  const r = Math.max(3, Math.min(30, editRows.value))
  editCols.value = c
  editRows.value = r
  if (c !== gridCols.value || r !== gridRows.value) {
    props.store.resizeTerrain(c, r)
  }
}

watch([() => props.store.state.terrainGrid, () => props.store.state.atlasPixels], render, { deep: true })
onMounted(render)

function render() {
  const c = canvasEl.value
  if (!c) return
  const cols = gridCols.value
  const rows = gridRows.value
  const cs = cellSize.value
  const ds = displayScale.value
  c.width = cols * cs * ds
  c.height = rows * cs * ds
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, c.width, c.height)

  const grid = props.store.state.terrainGrid
  const atlas = props.store.state.atlasPixels
  const aw = props.store.state.atlasWidth
  const tw = props.store.state.atlasTileW
  const th = props.store.state.atlasTileH
  const layout = getLayout(props.store.state.layout)

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const dx = x * cs * ds
      const dy = y * cs * ds

      if (grid[y]?.[x] && atlas && tw > 0) {
        const peering = computePeering(grid, x, y, rows, cols)
        const pos = findTilePosition(peering, layout)
        if (pos) {
          const srcX = pos.col * tw
          const srcY = pos.row * th
          const tileData = new Uint8ClampedArray(tw * th * 4)
          for (let ty = 0; ty < th; ty++) {
            const srcOff = ((srcY + ty) * aw + srcX) * 4
            tileData.set(atlas.subarray(srcOff, srcOff + tw * 4), ty * tw * 4)
          }
          const imgData = new ImageData(tileData, tw, th)
          const tmp = new OffscreenCanvas(tw, th)
          tmp.getContext('2d')!.putImageData(imgData, 0, 0)
          ctx.drawImage(tmp, dx, dy, cs * ds, cs * ds)
        }
      } else {
        ctx.fillStyle = '#1a1a1a'
        ctx.fillRect(dx, dy, cs * ds, cs * ds)
      }

      ctx.strokeStyle = '#333'
      ctx.strokeRect(dx, dy, cs * ds, cs * ds)
    }
  }
}

let isDrawing = false
let drawValue = true

function getCell(e: MouseEvent): { x: number; y: number } | null {
  const c = canvasEl.value!
  const rect = c.getBoundingClientRect()
  const cs = cellSize.value * displayScale.value
  const x = Math.floor((e.clientX - rect.left) / cs)
  const y = Math.floor((e.clientY - rect.top) / cs)
  if (x < 0 || x >= gridCols.value || y < 0 || y >= gridRows.value) return null
  return { x, y }
}

function onPointerDown(e: MouseEvent) {
  const cell = getCell(e)
  if (!cell) return
  isDrawing = true
  drawValue = e.button !== 2
  props.store.terrainDraw(cell.x, cell.y, drawValue)
  render()
}

function onPointerMove(e: MouseEvent) {
  if (!isDrawing) return
  const cell = getCell(e)
  if (cell) {
    props.store.terrainDraw(cell.x, cell.y, drawValue)
    render()
  }
}

function onPointerUp() { isDrawing = false }

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault()
    if (e.shiftKey) props.store.terrainRedo()
    else props.store.terrainUndo()
    render()
  }
}
</script>

<template>
  <div class="terrain-preview-section">
    <div class="terrain-size-controls">
      <label class="section-title">{{ t('tileset.terrain.title') }}</label>
      <div class="size-row">
        <label>{{ t('tileset.terrain.cols') }}</label>
        <input
          type="number"
          v-model.number="editCols"
          min="3" max="30"
          class="size-input"
          @change="applySize"
        />
        <span class="size-sep">×</span>
        <label>{{ t('tileset.terrain.rows') }}</label>
        <input
          type="number"
          v-model.number="editRows"
          min="3" max="30"
          class="size-input"
          @change="applySize"
        />
      </div>
    </div>
    <div class="terrain-canvas-wrap" tabindex="0" @keydown="onKeydown">
      <canvas
        ref="canvasEl"
        class="terrain-canvas"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointerleave="onPointerUp"
        @contextmenu.prevent
      />
    </div>
  </div>
</template>

<style scoped>
.terrain-preview-section {
  display: flex;
  flex-direction: column;
  padding: 8px 12px;
}
.section-title {
  font-size: 11px;
  color: #999;
  text-transform: uppercase;
  margin-bottom: 6px;
  display: block;
}
.terrain-size-controls {
  margin-bottom: 8px;
}
.size-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.size-row label {
  font-size: 11px;
  color: #888;
}
.size-input {
  width: 48px;
  padding: 2px 4px;
  font-size: 11px;
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 3px;
  color: #ccc;
  text-align: center;
}
.size-sep {
  color: #666;
  font-size: 11px;
}
.terrain-canvas-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  outline: none;
}
.terrain-canvas {
  image-rendering: pixelated;
  cursor: crosshair;
  border: 1px solid #444;
  border-radius: 4px;
}
</style>
