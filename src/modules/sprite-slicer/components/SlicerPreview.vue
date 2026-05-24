<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from '../../../shared/i18n'
import ImageCanvas from '../../../shared/components/ImageCanvas.vue'
import ActionMenu, { type ActionItem } from '../../../shared/components/ActionMenu.vue'
import SplitEditor from './SplitEditor.vue'
import type { Point } from '../core/split/line-splitter'

const { t } = useI18n()

const props = defineProps<{
  store: ReturnType<typeof import('../store').useSlicerStore>
}>()

// --- Unified actions: showOnHover controls what appears in hover bar ---
const cellActions = computed<ActionItem[]>(() => [
  { key: 'zoom', icon: 'zoom-in', label: t('slicer.ctx.zoom'), showOnHover: true, disabled: pendingCells.value.size > 1 },
  { key: 'rename', icon: 'edit', label: t('slicer.ctx.rename'), showOnHover: true, disabled: pendingCells.value.size > 1 },
  { key: 'merge', icon: 'layers', label: t('slicer.ctx.merge'), disabled: pendingCells.value.size < 2 },
  { key: 'split', icon: 'scissors', label: t('slicer.ctx.split'), disabled: pendingCells.value.size !== 1 },
  { key: 'toggle-export', icon: 'check', label: ctxIsExported.value ? t('slicer.ctx.excludeExport') : t('slicer.ctx.includeExport'), separator: true },
])

const gridRects = computed(() =>
  props.store.sprites.value.map(s => ({
    idx: s.id,
    x: s.rect.x, y: s.rect.y,
    w: s.rect.w, h: s.rect.h,
    merged: !!s.mergedFrom && s.mergedFrom.length > 0,
  })),
)

const checkIcons = computed(() =>
  gridRects.value.map(r => {
    const s = Math.max(6, Math.min(14, Math.min(r.w, r.h) * 0.25))
    const pad = Math.max(1, s * 0.15)
    return {
      idx: r.idx,
      cx: r.x + r.w - s / 2 - pad,
      cy: r.y + s / 2 + pad,
      size: s,
      hitX: r.x + r.w - s - pad * 2,
      hitY: r.y,
      hitW: s + pad * 2,
      hitH: s + pad * 2,
    }
  }),
)

const gridLines = computed(() => {
  if (props.store.detectionMode.value !== 'grid') return []
  const { w, h } = props.store.imgSize.value
  const c = props.store.cols.value
  const r = props.store.rows.value
  const gh = props.store.gapH.value
  const gv = props.store.gapV.value
  const mh = props.store.marginH.value
  const mv = props.store.marginV.value
  const innerW = w - mh * 2
  const innerH = h - mv * 2
  const cellW = (innerW - (c - 1) * gh) / c
  const cellH = (innerH - (r - 1) * gv) / r
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = []
  for (let i = 1; i < c; i++) {
    const x = mh + i * cellW + (i - 1) * gh + gh / 2
    lines.push({ x1: x, y1: 0, x2: x, y2: h })
  }
  for (let i = 1; i < r; i++) {
    const y = mv + i * cellH + (i - 1) * gv + gv / 2
    lines.push({ x1: 0, y1: y, x2: w, y2: y })
  }
  return lines
})

const hoveredIdx = ref<number | null>(null)
const hoverAnchor = ref<{ top: number; left: number; width: number; height: number } | null>(null)
let hoverLeaveTimer: ReturnType<typeof setTimeout> | null = null

const zoomedSprite = ref<{ dataUrl: string; name: string; w: number; h: number } | null>(null)
const renameTarget = ref<{ id: number; name: string } | null>(null)
const renameValue = ref('')
const renameDuplicate = ref(false)
const renameInputEl = ref<HTMLInputElement>()

const svgEl = ref<SVGSVGElement>()
const selRect = ref<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
const pendingCells = ref<Set<number>>(new Set())

const ctxMenu = ref({ visible: false, x: 0, y: 0 })
const splitTarget = ref<{ sprite: any; dataUrl: string } | null>(null)

const ctrlHeld = ref(false)

function onDocKeyDown(e: KeyboardEvent) {
  if (e.key === 'Control' && !ctrlHeld.value) ctrlHeld.value = true
  if (e.key === 'Escape') {
    if (ctxMenu.value.visible) { closeCtxMenu(); return }
    if (pendingCells.value.size > 0) { clearPending(); return }
  }
}
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

const DRAG_THRESHOLD = 5

function startRectSelection(e: MouseEvent, clickedIdx?: number) {
  const pt = screenToSvg(e.clientX, e.clientY)
  if (!pt) return
  const startX = e.clientX
  const startY = e.clientY
  let dragged = false

  const onMove = (ev: MouseEvent) => {
    const dx = ev.clientX - startX
    const dy = ev.clientY - startY
    if (!dragged && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
      dragged = true
      clearPending()
      selRect.value = { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y }
      clearHover()
    }
    if (dragged) {
      const p = screenToSvg(ev.clientX, ev.clientY)
      if (!p || !selRect.value) return
      selRect.value = { ...selRect.value, x2: p.x, y2: p.y }
    }
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    if (dragged && selRect.value) {
      const cells = getContainedCells(selRect.value)
      selRect.value = null
      if (cells.length > 0) {
        pendingCells.value = new Set(cells)
      }
    } else if (!dragged && clickedIdx != null) {
      const next = new Set(pendingCells.value)
      if (next.has(clickedIdx)) {
        next.delete(clickedIdx)
      } else {
        next.add(clickedIdx)
      }
      pendingCells.value = next
    }
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function onCanvasCtrlMouseDown(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  startRectSelection(e)
}

function onBgMouseDown(e: MouseEvent) {
  if (e.ctrlKey && e.button === 0) {
    e.preventDefault()
    e.stopPropagation()
    startRectSelection(e)
    return
  }
  clearPending()
  closeCtxMenu()
}

function onRectMouseDown(idx: number, e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()

  if (e.ctrlKey && e.button === 0) {
    startRectSelection(e, idx)
    return
  }

  if (e.button === 0) {
    closeCtxMenu()
    pendingCells.value = new Set([idx])
    return
  }

  if (e.button === 2) {
    if (!pendingCells.value.has(idx)) {
      pendingCells.value = new Set([idx])
    }
    showCtxMenu(e.clientX, e.clientY)
    return
  }
}

function onRectContextMenu(_idx: number, e: MouseEvent) {
  e.preventDefault()
}

function onCheckClick(idx: number, e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  const s = new Set(props.store.selected.value)
  if (s.has(idx)) {
    s.delete(idx)
  } else {
    s.add(idx)
  }
  props.store.selected.value = s
}

// --- Context menu ---
function showCtxMenu(x: number, y: number) {
  clearHover()
  ctxMenu.value = { visible: true, x, y }
}

function closeCtxMenu() {
  ctxMenu.value = { ...ctxMenu.value, visible: false }
}

const ctxIsExported = computed(() => {
  for (const id of pendingCells.value) {
    if (!props.store.selected.value.has(id)) return false
  }
  return true
})

// --- Unified action handler (both hover and context actions) ---
function resolveTarget(): number | undefined {
  return hoveredIdx.value ?? [...pendingCells.value][0]
}

function onAction(key: string) {
  if (key === 'zoom') {
    const target = resolveTarget()
    if (target != null) showZoomed(target)
    clearPending()
  } else if (key === 'rename') {
    const target = resolveTarget()
    if (target != null) startRename(target)
    clearPending()
  } else if (key === 'merge') {
    props.store.mergeSprites([...pendingCells.value])
    clearPending()
  } else if (key === 'split') {
    const ids = [...pendingCells.value]
    if (ids.length !== 1) return
    const sprite = props.store.sprites.value.find(s => s.id === ids[0])
    if (!sprite) return
    if (sprite.mergedFromRects && sprite.mergedFromRects.length >= 2) {
      props.store.unmergeSprite(sprite.id)
      clearPending()
    } else {
      splitTarget.value = { sprite, dataUrl: props.store.cleanImageUrl.value || '' }
      clearPending()
    }
  } else if (key === 'toggle-export') {
    const s = new Set(props.store.selected.value)
    if (ctxIsExported.value) {
      for (const id of pendingCells.value) s.delete(id)
    } else {
      for (const id of pendingCells.value) s.add(id)
    }
    props.store.selected.value = s
    clearPending()
  }
}

function onSplitApply(lines: Point[][]) {
  if (splitTarget.value) {
    props.store.splitSprite(splitTarget.value.sprite.id, lines)
  }
  splitTarget.value = null
}

// --- Hover ---
function onRectMouseEnter(idx: number, e: MouseEvent) {
  const s = overlayState.value
  if (s === 'dragging' || s === 'ctrl-ready') return
  if (hoverLeaveTimer) { clearTimeout(hoverLeaveTimer); hoverLeaveTimer = null }
  hoveredIdx.value = idx
  const el = e.currentTarget as SVGRectElement
  const rect = el.getBoundingClientRect()
  hoverAnchor.value = { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
}

function onRectMouseLeave() {
  const s = overlayState.value
  if (s === 'dragging' || s === 'ctrl-ready') return
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
    :viewport-cursor="ctrlHeld ? 'crosshair' : undefined"
    @ctrl-mousedown="onCanvasCtrlMouseDown"
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
      <span class="hint">{{ t('slicer.hint.select2') }}</span>
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

        <!-- Cell rects -->
        <rect
          v-for="r in gridRects" :key="'fill-'+r.idx"
          :x="r.x" :y="r.y" :width="r.w" :height="r.h"
          :fill="store.selected.value.has(r.idx) ? 'transparent' : 'rgba(0,0,0,0.45)'"
          :class="['grid-rect', { highlighted: highlightedCells.has(r.idx), merged: r.merged }]"
          @mousedown="onRectMouseDown(r.idx, $event)"
          @mouseenter="onRectMouseEnter(r.idx, $event)"
          @mouseleave="onRectMouseLeave"
          @contextmenu="onRectContextMenu(r.idx, $event)"
        />

        <!-- Checkmark icons for export toggle -->
        <g v-for="ci in checkIcons" :key="'chk-'+ci.idx" class="check-group">
          <rect
            :x="ci.hitX" :y="ci.hitY"
            :width="ci.hitW" :height="ci.hitH"
            fill="transparent"
            class="check-hit"
            @mousedown.stop.prevent="onCheckClick(ci.idx, $event)"
          />
          <circle
            :cx="ci.cx" :cy="ci.cy"
            :r="ci.size * 0.45"
            :fill="store.selected.value.has(ci.idx) ? 'rgba(34,197,94,0.85)' : 'rgba(100,100,100,0.6)'"
            style="pointer-events: none"
          />
          <path
            :d="`M${ci.cx - ci.size*0.22} ${ci.cy} l${ci.size*0.15} ${ci.size*0.15} l${ci.size*0.25} ${-ci.size*0.3}`"
            fill="none"
            :stroke="store.selected.value.has(ci.idx) ? '#fff' : '#999'"
            :stroke-width="Math.max(1, ci.size * 0.12)"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="pointer-events: none"
          />
        </g>

        <!-- Grid lines (grid mode only) -->
        <line
          v-for="(ln, i) in gridLines" :key="'ln-'+i"
          :x1="ln.x1" :y1="ln.y1" :x2="ln.x2" :y2="ln.y2"
          stroke="#888" stroke-width="1" shape-rendering="crispEdges"
          style="pointer-events:none"
        />

        <!-- Selection rectangle -->
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

  <!-- Unified action menu (hover bar at top-left + context menu) -->
  <ActionMenu
    :actions="cellActions"
    :hover-anchor="hoverAnchor"
    hover-placement="top-left"
    :context-visible="ctxMenu.visible"
    :context-x="ctxMenu.x"
    :context-y="ctxMenu.y"
    @action="onAction"
    @hover-enter="onPanelEnter"
    @hover-leave="onPanelLeave"
    @context-close="closeCtxMenu"
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

  <!-- Split Editor -->
  <SplitEditor
    v-if="splitTarget"
    :sprite="splitTarget.sprite"
    @apply="onSplitApply"
    @close="splitTarget = null"
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
  stroke: rgba(120, 120, 120, 0.5);
  stroke-width: 1;
  transition: fill 0.1s;
}
/* Hover: uniform light fill, independent of selection state */
.grid-rect:hover {
  fill: rgba(255, 255, 255, 0.08) !important;
}
/* Selected (pending) */
.grid-rect.highlighted {
  stroke: rgba(74, 144, 226, 0.85);
  stroke-width: 2;
}
/* Merged cells */
.grid-rect.merged {
  stroke: rgba(255, 200, 50, 0.6);
  stroke-dasharray: 4 2;
}
.grid-rect.merged.highlighted {
  stroke: rgba(74, 144, 226, 0.85);
  stroke-dasharray: none;
}
/* Ctrl / drag cursor */
.grid-overlay.ctrl-ready .grid-rect,
.grid-overlay.ctrl-ready .bg-hit,
.grid-overlay.dragging .grid-rect,
.grid-overlay.dragging .bg-hit { cursor: crosshair; }
.check-hit {
  pointer-events: all;
  cursor: pointer;
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
.rename-btn.confirm:hover:not(:disabled) { background: #2563eb; }
.rename-btn.confirm:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
