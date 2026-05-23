<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from '../../../shared/i18n'
import ImageCanvas from '../../../shared/components/ImageCanvas.vue'
import HoverActions from '../../../shared/components/HoverActions.vue'
import type { HoverAction } from '../../../shared/components/HoverActions.vue'

const props = defineProps<{
  store: ReturnType<typeof import('../store').useSlicerStore>
}>()

const { t } = useI18n()

const zoomedSprite = ref<{ dataUrl: string; name: string; w: number; h: number } | null>(null)

const hoveredIdx = ref<number | null>(null)
const hoverAnchor = ref<{ top: number; left: number; width: number; height: number } | null>(null)
let hoverLeaveTimer: ReturnType<typeof setTimeout> | null = null

const renameTarget = ref<{ id: number; name: string } | null>(null)
const renameValue = ref('')
const renameDuplicate = ref(false)
const renameInputEl = ref<HTMLInputElement>()

const cellActions = computed<HoverAction[]>(() => [
  { key: 'zoom', icon: 'zoom-in', tooltip: t('slicer.hint.zoom') },
  { key: 'rename', icon: 'edit', tooltip: t('slicer.hint.rename') },
])

const gridRects = computed(() =>
  props.store.sprites.value.map(s => ({
    x: s.rect.x, y: s.rect.y, w: s.rect.w, h: s.rect.h, idx: s.id,
  })),
)

const gridLines = computed(() => {
  const rects = gridRects.value
  const lines: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
  const hSet = new Set<string>()
  const vSet = new Set<string>()
  for (const r of rects) {
    hSet.add(`${r.y},${r.x},${r.x + r.w}`)
    hSet.add(`${r.y + r.h},${r.x},${r.x + r.w}`)
    vSet.add(`${r.x},${r.y},${r.y + r.h}`)
    vSet.add(`${r.x + r.w},${r.y},${r.y + r.h}`)
  }
  for (const k of hSet) {
    const [y, x1, x2] = k.split(',').map(Number)
    lines.push({ x1, y1: y, x2, y2: y })
  }
  for (const k of vSet) {
    const [x, y1, y2] = k.split(',').map(Number)
    lines.push({ x1: x, y1, x2: x, y2 })
  }
  return lines
})

const svgEl = ref<SVGSVGElement>()
const selRect = ref<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
const pendingCells = ref<Set<number>>(new Set())

const ctrlHeld = ref(false)

function onDocKeyDown(e: KeyboardEvent) { if (e.key === 'Control' && !ctrlHeld.value) ctrlHeld.value = true }
function onDocKeyUp(e: KeyboardEvent) { if (e.key === 'Control') ctrlHeld.value = false }
function onDocBlur() { ctrlHeld.value = false }

onMounted(() => {
  document.addEventListener('keydown', onDocKeyDown)
  document.addEventListener('keyup', onDocKeyUp)
  window.addEventListener('blur', onDocBlur)
})
onUnmounted(() => {
  document.removeEventListener('keydown', onDocKeyDown)
  document.removeEventListener('keyup', onDocKeyUp)
  window.removeEventListener('blur', onDocBlur)
})

const overlayState = computed(() => {
  if (selRect.value) return 'dragging'
  if (pendingCells.value.size > 0) return 'pending'
  if (ctrlHeld.value) return 'ctrl-ready'
  return 'idle'
})

function screenToSvg(clientX: number, clientY: number): { x: number; y: number } | null {
  const svg = svgEl.value
  if (!svg) return null
  const ctm = svg.getScreenCTM()
  if (!ctm) return null
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const svgPt = pt.matrixTransform(ctm.inverse())
  return { x: svgPt.x, y: svgPt.y }
}

function getContainedCells(rect: { x1: number; y1: number; x2: number; y2: number }): number[] {
  const sx = Math.min(rect.x1, rect.x2)
  const sy = Math.min(rect.y1, rect.y2)
  const ex = Math.max(rect.x1, rect.x2)
  const ey = Math.max(rect.y1, rect.y2)
  return gridRects.value
    .filter(r => r.x >= sx && r.x + r.w <= ex && r.y >= sy && r.y + r.h <= ey)
    .map(r => r.idx)
}

const highlightedCells = computed(() => {
  if (selRect.value) return new Set(getContainedCells(selRect.value))
  return pendingCells.value
})

function clearPending() {
  pendingCells.value = new Set()
}

function startRectSelection(e: MouseEvent) {
  const pt = screenToSvg(e.clientX, e.clientY)
  if (!pt) return
  clearPending()
  selRect.value = { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y }
  clearHover()

  const onMove = (ev: MouseEvent) => {
    const p = screenToSvg(ev.clientX, ev.clientY)
    if (!p || !selRect.value) return
    selRect.value = { ...selRect.value, x2: p.x, y2: p.y }
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    if (selRect.value) {
      const cells = getContainedCells(selRect.value)
      selRect.value = null
      if (cells.length > 0) {
        pendingCells.value = new Set(cells)
      }
    }
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function onBgMouseDown(e: MouseEvent) {
  if (e.ctrlKey && e.button === 0) {
    e.preventDefault()
    e.stopPropagation()
    startRectSelection(e)
    return
  }
  clearPending()
}

function onRectMouseDown(idx: number, e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()

  if (e.ctrlKey && e.button === 0) {
    startRectSelection(e)
    return
  }

  if (pendingCells.value.has(idx)) {
    const s = new Set(props.store.selected.value)
    if (e.button === 0) {
      for (const id of pendingCells.value) s.add(id)
    } else if (e.button === 2) {
      for (const id of pendingCells.value) s.delete(id)
    }
    props.store.selected.value = s
    clearPending()
    return
  }

  clearPending()
  const s = new Set(props.store.selected.value)
  if (e.button === 0) {
    s.add(idx)
  } else if (e.button === 2) {
    s.delete(idx)
  }
  props.store.selected.value = s
}

function onRectContextMenu(_idx: number, e: MouseEvent) {
  e.preventDefault()
}

function onRectMouseEnter(idx: number, e: MouseEvent) {
  if (overlayState.value !== 'idle') return
  if (hoverLeaveTimer) { clearTimeout(hoverLeaveTimer); hoverLeaveTimer = null }
  hoveredIdx.value = idx
  const el = e.currentTarget as SVGRectElement
  const rect = el.getBoundingClientRect()
  hoverAnchor.value = { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
}

function onRectMouseLeave() {
  if (overlayState.value !== 'idle') return
  scheduleHoverClose()
}

function scheduleHoverClose() {
  if (hoverLeaveTimer) clearTimeout(hoverLeaveTimer)
  hoverLeaveTimer = setTimeout(() => {
    hoveredIdx.value = null
    hoverAnchor.value = null
  }, 200)
}

function onPanelEnter() {
  if (hoverLeaveTimer) { clearTimeout(hoverLeaveTimer); hoverLeaveTimer = null }
}

function onPanelLeave() {
  scheduleHoverClose()
}

function onCellAction(key: string) {
  if (hoveredIdx.value === null) return
  if (key === 'zoom') {
    showZoomed(hoveredIdx.value)
  } else if (key === 'rename') {
    startRename(hoveredIdx.value)
  }
}

function showZoomed(idx: number) {
  const sprite = props.store.sprites.value.find(s => s.id === idx)
  if (!sprite) return
  zoomedSprite.value = {
    dataUrl: sprite.dataUrl,
    name: sprite.name,
    w: sprite.rect.w,
    h: sprite.rect.h,
  }
  clearHover()
}

function startRename(idx: number) {
  const sprite = props.store.sprites.value.find(s => s.id === idx)
  if (!sprite) return
  renameTarget.value = { id: sprite.id, name: sprite.name }
  renameValue.value = sprite.name
  renameDuplicate.value = false
  clearHover()
  nextTick(() => {
    renameInputEl.value?.focus()
    renameInputEl.value?.select()
  })
}

function onRenameInput() {
  if (!renameTarget.value) return
  renameDuplicate.value = props.store.isSpriteNameTaken(renameValue.value, renameTarget.value.id)
}

function confirmRename() {
  if (!renameTarget.value || renameDuplicate.value) return
  props.store.renameSprite(renameTarget.value.id, renameValue.value)
  renameTarget.value = null
}

function cancelRename() {
  renameTarget.value = null
}

function onRenameKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') confirmRename()
  if (e.key === 'Escape') cancelRename()
}

function clearHover() {
  hoveredIdx.value = null
  hoverAnchor.value = null
  if (hoverLeaveTimer) { clearTimeout(hoverLeaveTimer); hoverLeaveTimer = null }
}
</script>

<template>
  <ImageCanvas
    :src="store.cleanImageUrl.value || ''"
    :min-scale="0.25"
    :max-scale="8"
    show-info-bar
  >
    <template #toolbar-left>
      <span class="stats">{{ t(
        store.detectionMode.value === 'auto' ? 'slicer.hint.autoStats' : 'slicer.hint.gridStats',
        {
          selected: store.selectedSprites.value.length,
          total: store.sprites.value.length,
          rows: store.rows.value,
          cols: store.cols.value,
        }
      ) }}</span>
    </template>
    <template #toolbar-right>
      <span class="hint">{{ t('slicer.hint.select') }}</span>
    </template>

    <template #default>
      <svg
        ref="svgEl"
        class="grid-overlay"
        :class="overlayState"
        :viewBox="`0 0 ${store.imgSize.value.w} ${store.imgSize.value.h}`"
        preserveAspectRatio="xMidYMid meet"
        overflow="visible"
      >
        <rect
          :width="store.imgSize.value.w" :height="store.imgSize.value.h"
          fill="transparent"
          class="bg-hit"
          @mousedown="onBgMouseDown"
        />
        <rect
          v-for="r in gridRects" :key="'fill-'+r.idx"
          :x="r.x" :y="r.y" :width="r.w" :height="r.h"
          :fill="store.selected.value.has(r.idx) ? 'transparent' : 'rgba(0,0,0,0.45)'"
          :class="['grid-rect', { highlighted: highlightedCells.has(r.idx) }]"
          @mousedown="onRectMouseDown(r.idx, $event)"
          @mouseenter="onRectMouseEnter(r.idx, $event)"
          @mouseleave="onRectMouseLeave"
          @contextmenu="onRectContextMenu(r.idx, $event)"
        />
        <line
          v-for="(ln, i) in gridLines" :key="'ln-'+i"
          :x1="ln.x1" :y1="ln.y1" :x2="ln.x2" :y2="ln.y2"
          stroke="#888" stroke-width="1" shape-rendering="crispEdges"
          style="pointer-events:none"
        />
        <rect v-if="selRect"
          :x="Math.min(selRect.x1, selRect.x2)"
          :y="Math.min(selRect.y1, selRect.y2)"
          :width="Math.abs(selRect.x2 - selRect.x1)"
          :height="Math.abs(selRect.y2 - selRect.y1)"
          fill="rgba(74, 144, 226, 0.12)"
          stroke="rgba(74, 144, 226, 0.8)"
          stroke-width="1.5"
          stroke-dasharray="6 3"
          style="pointer-events: none"
        />
      </svg>
    </template>
  </ImageCanvas>

  <!-- Hover action panel -->
  <HoverActions
    :actions="cellActions"
    :anchor="hoverAnchor"
    @action="onCellAction"
    @mouseenter="onPanelEnter"
    @mouseleave="onPanelLeave"
  />

  <!-- Rename dialog -->
  <Teleport to="body">
    <div v-if="renameTarget" class="rename-overlay" @click="cancelRename">
      <div class="rename-dialog" @click.stop>
        <div class="rename-header">{{ t('slicer.hint.renameTitle') }}</div>
        <div class="rename-body">
          <label class="rename-label">{{ t('slicer.hint.renamePrompt') }}</label>
          <input
            ref="renameInputEl"
            v-model="renameValue"
            class="rename-input"
            :class="{ error: renameDuplicate }"
            @input="onRenameInput"
            @keydown="onRenameKeydown"
          />
          <span v-if="renameDuplicate" class="rename-error">{{ t('slicer.hint.renameDuplicate') }}</span>
        </div>
        <div class="rename-footer">
          <button class="rename-btn cancel" @click="cancelRename">{{ t('common.cancel') }}</button>
          <button class="rename-btn confirm" :disabled="renameDuplicate || !renameValue.trim()" @click="confirmRename">{{ t('common.confirm') }}</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Zoomed single sprite -->
  <ImageCanvas
    v-if="zoomedSprite"
    overlay
    :src="zoomedSprite.dataUrl"
    :overlay-title="zoomedSprite.name"
    :overlay-subtitle="`${zoomedSprite.w} × ${zoomedSprite.h} px`"
    :min-scale="0.5"
    :max-scale="32"
    @close="zoomedSprite = null"
  />
</template>

<style scoped>
.stats { font-size: 12px; color: #aaa; }
.hint { font-size: 12px; color: #666; }
.grid-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.bg-hit { pointer-events: all; }
.grid-rect {
  pointer-events: all;
  cursor: pointer;
  stroke: transparent;
  stroke-width: 2;
}
/* idle: normal hover */
.grid-overlay.idle .grid-rect:hover { stroke: rgba(74, 222, 128, 0.8); }
/* highlighted cells (drag preview + pending) */
.grid-rect.highlighted { stroke: rgba(74, 144, 226, 0.8); }
/* ctrl-ready & dragging: crosshair cursor */
.grid-overlay.ctrl-ready .grid-rect,
.grid-overlay.ctrl-ready .bg-hit,
.grid-overlay.dragging .grid-rect,
.grid-overlay.dragging .bg-hit { cursor: crosshair; }
/* pending: pulsing border on highlighted cells */
.grid-overlay.pending .grid-rect.highlighted {
  animation: pending-pulse 1.5s ease-in-out infinite;
}
@keyframes pending-pulse {
  0%, 100% { stroke: rgba(74, 144, 226, 0.9); }
  50% { stroke: rgba(74, 144, 226, 0.35); }
}

/* Rename dialog */
.rename-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}
.rename-dialog {
  background: #2a2a2a;
  border-radius: 10px;
  width: 340px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}
.rename-header {
  padding: 14px 18px 10px;
  font-size: 14px;
  font-weight: 600;
  color: #eee;
  border-bottom: 1px solid #3a3a3a;
}
.rename-body {
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rename-label {
  font-size: 12px;
  color: #999;
}
.rename-input {
  background: #1e1e1e;
  border: 1px solid #555;
  border-radius: 6px;
  padding: 8px 10px;
  color: #eee;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
}
.rename-input:focus { border-color: #8ab4f8; }
.rename-input.error { border-color: #f87171; }
.rename-error {
  font-size: 11px;
  color: #f87171;
}
.rename-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 18px 14px;
}
.rename-btn {
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  border: none;
  transition: all 0.15s;
}
.rename-btn.cancel {
  background: #3a3a3a;
  color: #aaa;
}
.rename-btn.cancel:hover { background: #444; color: #ddd; }
.rename-btn.confirm {
  background: #3b82f6;
  color: #fff;
}
.rename-btn.confirm:hover { background: #2563eb; }
.rename-btn.confirm:disabled {
  background: #333;
  color: #666;
  cursor: not-allowed;
}
</style>
