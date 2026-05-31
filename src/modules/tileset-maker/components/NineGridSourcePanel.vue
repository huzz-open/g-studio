<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue'
import { useI18n } from '../../../shared/i18n'
import type { TilesetInstance } from '../store'
import FileDropZone from '../../../shared/components/FileDropZone.vue'
import { CheckboxRow } from '../../../shared/components/editor-shell/sidebar-atoms'

const { t } = useI18n()
const props = defineProps<{ store: TilesetInstance }>()

const gridCanvasRef = ref<HTMLCanvasElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const DRAG_THRESHOLD = 5

let dragging: { axis: 'x' | 'y'; index: number } | null = null

function getGridScale(): number {
  const panel = panelRef.value
  const { nineGridWidth } = props.store.state
  if (!panel || !nineGridWidth) return 3
  const availWidth = panel.clientWidth - 2
  return Math.max(1, Math.floor(availWidth / nineGridWidth))
}

function renderGrid() {
  const canvas = gridCanvasRef.value
  if (!canvas) return
  const { nineGridImage, nineGridWidth, nineGridHeight, nineGridSplitsX, nineGridSplitsY } = props.store.state
  if (!nineGridImage || nineGridSplitsX.length !== 7) return

  const GRID_SCALE = getGridScale()
  const w = nineGridWidth * GRID_SCALE
  const h = nineGridHeight * GRID_SCALE
  canvas.width = w
  canvas.height = h
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`

  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(nineGridImage, 0, 0, w, h)

  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      const x = nineGridSplitsX[col] * GRID_SCALE
      const y = nineGridSplitsY[row] * GRID_SCALE
      const cw = (nineGridSplitsX[col + 1] - nineGridSplitsX[col]) * GRID_SCALE
      const ch = (nineGridSplitsY[row + 1] - nineGridSplitsY[row]) * GRID_SCALE

      const isCorner = (row === 0 || row === 5) && (col === 0 || col === 5)
      const isEdge = (row === 0 || row === 5 || col === 0 || col === 5) && !isCorner

      if (isCorner) ctx.fillStyle = 'rgba(255,100,100,0.3)'
      else if (isEdge) ctx.fillStyle = 'rgba(100,200,255,0.25)'
      else ctx.fillStyle = 'rgba(100,255,100,0.15)'

      ctx.fillRect(x, y, cw, ch)
    }
  }

  for (let i = 0; i <= 6; i++) {
    const px = nineGridSplitsX[i] * GRID_SCALE
    const isBdy = i === 0 || i === 6
    ctx.strokeStyle = isBdy ? 'rgba(255,255,255,0.3)' : 'rgba(255,220,50,0.9)'
    ctx.lineWidth = isBdy ? 1 : 1.5
    ctx.beginPath()
    ctx.moveTo(px, 0)
    ctx.lineTo(px, h)
    ctx.stroke()
  }
  for (let i = 0; i <= 6; i++) {
    const py = nineGridSplitsY[i] * GRID_SCALE
    const isBdy = i === 0 || i === 6
    ctx.strokeStyle = isBdy ? 'rgba(255,255,255,0.3)' : 'rgba(255,220,50,0.9)'
    ctx.lineWidth = isBdy ? 1 : 1.5
    ctx.beginPath()
    ctx.moveTo(0, py)
    ctx.lineTo(w, py)
    ctx.stroke()
  }
}

function hitTest(mx: number, my: number): { axis: 'x' | 'y'; index: number } | null {
  const scale = getGridScale()
  const { nineGridSplitsX, nineGridSplitsY } = props.store.state
  for (let i = 1; i <= 5; i++) {
    if (Math.abs(mx - nineGridSplitsX[i] * scale) <= DRAG_THRESHOLD) {
      return { axis: 'x', index: i }
    }
  }
  for (let i = 1; i <= 5; i++) {
    if (Math.abs(my - nineGridSplitsY[i] * scale) <= DRAG_THRESHOLD) {
      return { axis: 'y', index: i }
    }
  }
  return null
}

function onMouseDown(e: MouseEvent) {
  const canvas = gridCanvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  const hit = hitTest(mx, my)
  if (hit) {
    dragging = hit
    canvas.style.cursor = hit.axis === 'x' ? 'col-resize' : 'row-resize'
    e.preventDefault()
  }
}

function onMouseMove(e: MouseEvent) {
  const canvas = gridCanvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top

  if (dragging) {
    const scale = getGridScale()
    const val = Math.round((dragging.axis === 'x' ? mx : my) / scale)
    if (dragging.axis === 'x') {
      props.store.setGridSplitX(dragging.index, val)
    } else {
      props.store.setGridSplitY(dragging.index, val)
    }
    renderGrid()
  } else {
    const hit = hitTest(mx, my)
    canvas.style.cursor = hit ? (hit.axis === 'x' ? 'col-resize' : 'row-resize') : 'default'
  }
}

function onMouseUp() {
  if (dragging) {
    dragging = null
    if (gridCanvasRef.value) gridCanvasRef.value.style.cursor = 'default'
  }
}

watch(
  () => [props.store.state.nineGridImage, props.store.state.nineGridSplitsX, props.store.state.nineGridSplitsY],
  () => nextTick(renderGrid),
  { deep: true },
)

onMounted(() => {
  if (props.store.state.nineGridImage) {
    nextTick(renderGrid)
  }
})
</script>

<template>
  <div ref="panelRef" class="ninegrid-source-panel">
    <div class="section">
      <label class="section-title">{{ t('tileset.ninegrid.upload') }}</label>
      <FileDropZone
        compact
        accept="image/png,image/jpeg,image/webp"
        :hint="props.store.state.nineGridFileName ? props.store.state.nineGridFileName : t('tileset.empty.subtileHint')"
        :file-name="props.store.state.nineGridFileName ? `${props.store.state.nineGridWidth} × ${props.store.state.nineGridHeight} px` : ''"
        icon="image"
        @file="(f: File) => props.store.loadNineGrid(f)"
      />
      <p v-if="props.store.state.generateError && props.store.state.mode === 'subtile'" class="error">
        {{ props.store.state.generateError }}
      </p>
    </div>

    <div v-if="props.store.state.nineGridImage" class="section">
      <div class="section-header">
        <label class="section-title">{{ t('tileset.ninegrid.gridSplits') }}</label>
        <button class="reset-btn" @click="props.store.resetGridSplits()">{{ t('tileset.ninegrid.resetGrid') }}</button>
      </div>
      <canvas
        ref="gridCanvasRef"
        class="grid-canvas"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="onMouseUp"
        @mouseleave="onMouseUp"
      />
    </div>

    <div class="section">
      <CheckboxRow
        :label="t('tileset.ninegrid.magenta')"
        :model-value="props.store.state.useMagenta"
        @update:model-value="props.store.setMagenta($event)"
      />
      <div v-if="props.store.state.useMagenta" class="slider-row">
        <label>{{ t('tileset.ninegrid.tolerance') }}</label>
        <input
          type="range"
          :min="0"
          :max="100"
          :step="1"
          :value="props.store.state.magentaTolerance"
          @input="props.store.setMagentaTolerance(parseInt(($event.target as HTMLInputElement).value))"
        />
        <span class="slider-val">{{ props.store.state.magentaTolerance }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ninegrid-source-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  overflow-y: auto;
}
.section-title {
  font-size: 11px;
  color: #999;
  text-transform: uppercase;
  margin-bottom: 6px;
  display: block;
}
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.section-header .section-title {
  margin-bottom: 0;
}
.reset-btn {
  font-size: 10px;
  padding: 2px 6px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 3px;
  color: #aaa;
  cursor: pointer;
}
.reset-btn:hover {
  background: rgba(255,255,255,0.12);
  color: #ddd;
}
.grid-canvas {
  display: block;
  max-width: 100%;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 4px;
  image-rendering: pixelated;
}
.error { color: #e88; font-size: 11px; margin-top: 6px; }
.slider-row {
  display: grid;
  grid-template-columns: auto 1fr 30px;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
.slider-row label { font-size: 11px; color: #999; }
.slider-val { font-size: 10px; color: #888; }
</style>
