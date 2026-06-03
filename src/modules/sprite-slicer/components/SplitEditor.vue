<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from '../../../shared/i18n'
import { useSettings } from '../../../shared/settings'
import { confirm } from '../../../shared/components/confirm'
import ImageCanvas from '../../../shared/components/ImageCanvas.vue'
import SvgIcon from '../../../shared/icons/SvgIcon.vue'
import { createHistoryStack } from '../../../shared/history'
import type { Transaction } from '../../../shared/history'
import type { DetectedSprite } from '../interfaces/sprite-detector'
import type { Point } from '../core/split/line-splitter'
import {
  constrainAngle as _constrainAngle,
  snapToBoundary as _snapToBoundary,
  clampToRect as _clampToRect,
  findClosestHit as _findClosestHit,
} from '../core/split/geometry'

const { t } = useI18n()
const { settings } = useSettings()

const props = defineProps<{
  sprite: DetectedSprite
}>()

const emit = defineEmits<{
  (e: 'apply', lines: Point[][]): void
  (e: 'close'): void
}>()

// --- Mode ---
type EditorMode = 'create' | 'edit'
const mode = ref<EditorMode>('create')

// --- State ---
const completedLines = ref<Point[][]>([])
const currentPoints = ref<Point[]>([])
const svgEl = ref<SVGSVGElement>()
const mousePos = ref<Point | null>(null)
const startedFromExisting = ref(false)

// --- Point reference ---
interface PointRef {
  lineIdx: number // -1 for currentPoints
  ptIdx: number
}

// --- Hover ---
const hoveredPointRef = ref<PointRef | null>(null)

// --- Drag (edit mode) ---
const dragPointRef = ref<PointRef | null>(null)
const isDragging = ref(false)
let downClientPos: { x: number; y: number } | null = null
let dragTx: Transaction | null = null
const DRAG_THRESHOLD = 3

// --- Undo / Redo ---
interface SplitSnapshot {
  completed: Point[][]
  current: Point[]
  startedExisting: boolean
}

const splitHistory = createHistoryStack<SplitSnapshot>({
  capture() {
    return {
      completed: completedLines.value.map(l => l.map(p => ({ ...p }))),
      current: currentPoints.value.map(p => ({ ...p })),
      startedExisting: startedFromExisting.value,
    }
  },
  restore(s) {
    completedLines.value = s.completed.map(l => l.map(p => ({ ...p })))
    currentPoints.value = s.current.map(p => ({ ...p }))
    startedFromExisting.value = s.startedExisting
  },
})

function recordBefore() {
  splitHistory.record()
}
function undo() { splitHistory.undo() }
function redo() { splitHistory.redo() }
const canUndo = splitHistory.canUndo
const canRedo = splitHistory.canRedo

// --- Image data ---
const { x: ox, y: oy, w: sw, h: sh } = props.sprite.rect

const alphaData = computed(() => {
  const d = props.sprite.imageData.data
  const len = sw * sh
  const alpha = new Uint8Array(len)
  for (let i = 0; i < len; i++) alpha[i] = d[i * 4 + 3]
  return alpha
})

function lineHitsPixel(from: Point, to: Point): boolean {
  const alpha = alphaData.value
  const dx = Math.abs(to.x - from.x)
  const dy = Math.abs(to.y - from.y)
  const steps = Math.max(dx, dy)
  if (steps === 0) return false
  for (let i = 0; i <= steps; i++) {
    const px = Math.round(from.x + (to.x - from.x) * i / steps)
    const py = Math.round(from.y + (to.y - from.y) * i / steps)
    if (px >= 0 && px < sw && py >= 0 && py < sh && alpha[py * sw + px] > 0) return true
  }
  return false
}

// --- Coordinate helpers ---
function screenToLocal(clientX: number, clientY: number): Point | null {
  const svg = svgEl.value
  if (!svg) return null
  const ctm = svg.getScreenCTM()
  if (!ctm) return null
  const pt = svg.createSVGPoint()
  pt.x = clientX; pt.y = clientY
  const svgPt = pt.matrixTransform(ctm.inverse())
  return { x: Math.round(svgPt.x), y: Math.round(svgPt.y) }
}

function getScreenScale(): number {
  const svg = svgEl.value
  if (!svg) return 1
  const ctm = svg.getScreenCTM()
  return ctm ? ctm.a : 1
}

function svgSnapThreshold(): number {
  const dist = settings.spriteSlicer.defaults.snapDistance ?? 5
  return dist / getScreenScale()
}

function constrainAngle(from: Point, to: Point, shift: boolean): Point {
  return _constrainAngle(from, to, shift)
}

function snapToBoundary(pos: Point, threshold: number): Point {
  return _snapToBoundary(pos, threshold, sw, sh)
}

function clampToRect(pos: Point): Point {
  return _clampToRect(pos, sw, sh)
}

// --- Find nearest point within threshold ---
function findNearestPoint(pos: Point, threshold: number): PointRef | null {
  let best: PointRef | null = null
  let bestDist = threshold

  for (let li = 0; li < completedLines.value.length; li++) {
    const line = completedLines.value[li]
    for (let pi = 0; pi < line.length; pi++) {
      const dist = Math.hypot(pos.x - line[pi].x, pos.y - line[pi].y)
      if (dist < bestDist) { bestDist = dist; best = { lineIdx: li, ptIdx: pi } }
    }
  }
  for (let pi = 0; pi < currentPoints.value.length; pi++) {
    const dist = Math.hypot(pos.x - currentPoints.value[pi].x, pos.y - currentPoints.value[pi].y)
    if (dist < bestDist) { bestDist = dist; best = { lineIdx: -1, ptIdx: pi } }
  }
  return best
}

// --- Find nearest line segment within threshold ---
function findNearestLineSeg(pos: Point, threshold: number): { point: Point; lineIdx: number; segIdx: number } | null {
  let bestDist = threshold
  let bestResult: { point: Point; lineIdx: number; segIdx: number } | null = null

  for (let li = 0; li < completedLines.value.length; li++) {
    const line = completedLines.value[li]
    for (let si = 0; si < line.length - 1; si++) {
      const a = line[si], b = line[si + 1]
      const sdx = b.x - a.x, sdy = b.y - a.y
      const lenSq = sdx * sdx + sdy * sdy
      if (lenSq === 0) continue
      let t = ((pos.x - a.x) * sdx + (pos.y - a.y) * sdy) / lenSq
      t = Math.max(0, Math.min(1, t))
      const px = a.x + t * sdx, py = a.y + t * sdy
      const dist = Math.hypot(pos.x - px, pos.y - py)
      if (dist < bestDist) {
        bestDist = dist
        bestResult = { point: { x: Math.round(px), y: Math.round(py) }, lineIdx: li, segIdx: si }
      }
    }
  }
  return bestResult
}

function findClosestHit(origin: Point, dir: Point, otherLines: Point[][]): Point | null {
  return _findClosestHit(origin, dir, sw, sh, otherLines)
}

// --- Mouse handlers ---
function onSvgMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  downClientPos = { x: e.clientX, y: e.clientY }

  if (mode.value === 'edit') {
    const pos = screenToLocal(e.clientX, e.clientY)
    if (!pos) return
    const threshold = svgSnapThreshold()
    const nearPt = findNearestPoint(pos, threshold)
    if (nearPt) {
      dragPointRef.value = nearPt
      isDragging.value = false
      e.stopPropagation()
      e.preventDefault()
    }
  }
}

function onSvgMouseMove(e: MouseEvent) {
  const pos = screenToLocal(e.clientX, e.clientY)
  if (!pos) return

  if (dragPointRef.value && !isDragging.value && downClientPos) {
    const moved = Math.hypot(e.clientX - downClientPos.x, e.clientY - downClientPos.y)
    if (moved > DRAG_THRESHOLD) {
      isDragging.value = true
      dragTx = splitHistory.transaction()
    }
  }

  const threshold = svgSnapThreshold()

  if (isDragging.value && dragPointRef.value) {
    const snapped = snapToBoundary(pos, threshold)
    const ref = dragPointRef.value
    if (ref.lineIdx >= 0) {
      const newLines = completedLines.value.map(l => l.map(p => ({ ...p })))
      newLines[ref.lineIdx][ref.ptIdx] = snapped
      completedLines.value = newLines
    } else {
      const pts = currentPoints.value.map(p => ({ ...p }))
      pts[ref.ptIdx] = snapped
      currentPoints.value = pts
    }
    mousePos.value = snapped
    return
  }

  hoveredPointRef.value = findNearestPoint(pos, threshold)

  const last = currentPoints.value[currentPoints.value.length - 1]
  const constrained = last ? constrainAngle(last, pos, e.shiftKey) : pos
  mousePos.value = snapToBoundary(constrained, threshold)
}

function onSvgMouseUp(e: MouseEvent) {
  if (e.button !== 0) return

  if (isDragging.value) {
    isDragging.value = false
    dragPointRef.value = null
    dragTx?.commit()
    dragTx = null
    downClientPos = null
    return
  }
  dragPointRef.value = null

  if (!downClientPos) return
  const moved = Math.hypot(e.clientX - downClientPos.x, e.clientY - downClientPos.y)
  downClientPos = null
  if (moved > DRAG_THRESHOLD) return

  const pos = screenToLocal(e.clientX, e.clientY)
  if (!pos) return
  handleClick(pos, e.shiftKey)
}

function onSvgMouseLeave() {
  hoveredPointRef.value = null
}

function onDocMouseMove(e: MouseEvent) {
  const svg = svgEl.value
  if (!svg || (e.target instanceof Node && svg.contains(e.target as Node))) return

  const pos = screenToLocal(e.clientX, e.clientY)
  if (!pos) return
  const clamped = clampToRect(pos)
  const threshold = svgSnapThreshold()

  if (dragPointRef.value && !isDragging.value && downClientPos) {
    const moved = Math.hypot(e.clientX - downClientPos.x, e.clientY - downClientPos.y)
    if (moved > DRAG_THRESHOLD) {
      isDragging.value = true
      dragTx = splitHistory.transaction()
    }
  }

  if (isDragging.value && dragPointRef.value) {
    const snapped = snapToBoundary(clamped, threshold)
    const ref = dragPointRef.value
    if (ref.lineIdx >= 0) {
      const newLines = completedLines.value.map(l => l.map(p => ({ ...p })))
      newLines[ref.lineIdx][ref.ptIdx] = snapped
      completedLines.value = newLines
    } else {
      const pts = currentPoints.value.map(p => ({ ...p }))
      pts[ref.ptIdx] = snapped
      currentPoints.value = pts
    }
    mousePos.value = snapped
    return
  }

  hoveredPointRef.value = null
  const last = currentPoints.value[currentPoints.value.length - 1]
  const constrained = last ? constrainAngle(last, clamped, e.shiftKey) : clamped
  mousePos.value = snapToBoundary(constrained, threshold)
}

function onDocMouseUp(e: MouseEvent) {
  const svg = svgEl.value
  if (!svg || (e.target instanceof Node && svg.contains(e.target as Node))) return
  if (isDragging.value) {
    isDragging.value = false
    dragPointRef.value = null
    dragTx?.commit()
    dragTx = null
    downClientPos = null
  }
}

function handleClick(pos: Point, shift: boolean) {
  const threshold = svgSnapThreshold()

  if (mode.value === 'edit') {
    const nearSeg = findNearestLineSeg(pos, threshold)
    if (nearSeg) {
      recordBefore()
      const newLines = completedLines.value.map(l => l.map(p => ({ ...p })))
      newLines[nearSeg.lineIdx].splice(nearSeg.segIdx + 1, 0, nearSeg.point)
      completedLines.value = newLines
    }
    return
  }

  // Create mode
  if (currentPoints.value.length === 0) {
    const nearPt = findNearestPoint(pos, threshold)
    if (nearPt && nearPt.lineIdx >= 0) {
      recordBefore()
      const pt = completedLines.value[nearPt.lineIdx][nearPt.ptIdx]
      currentPoints.value = [{ ...pt }]
      startedFromExisting.value = true
      return
    }

    const nearSeg = findNearestLineSeg(pos, threshold)
    if (nearSeg) {
      recordBefore()
      const newLines = completedLines.value.map(l => l.map(p => ({ ...p })))
      newLines[nearSeg.lineIdx].splice(nearSeg.segIdx + 1, 0, nearSeg.point)
      completedLines.value = newLines
      currentPoints.value = [{ ...nearSeg.point }]
      startedFromExisting.value = true
      return
    }

    recordBefore()
    currentPoints.value = [snapToBoundary(pos, threshold)]
    startedFromExisting.value = false
  } else {
    const last = currentPoints.value[currentPoints.value.length - 1]
    const constrained = constrainAngle(last, pos, shift)
    const snapped = snapToBoundary(constrained, threshold)

    const nearSeg = findNearestLineSeg(snapped, threshold)
    const finalPt = nearSeg ? nearSeg.point : snapped

    recordBefore()
    currentPoints.value = [...currentPoints.value, finalPt]
  }
}

// --- Line operations ---
function finishLine() {
  if (currentPoints.value.length < 2) return
  const points = currentPoints.value.map(p => ({ ...p }))
  const result = [...points]
  const otherLines = completedLines.value

  if (!startedFromExisting.value) {
    const startDir = { x: points[0].x - points[1].x, y: points[0].y - points[1].y }
    const startHit = findClosestHit(points[0], startDir, otherLines)
    if (startHit) result[0] = startHit
  }

  const n = points.length
  const endDir = { x: points[n - 1].x - points[n - 2].x, y: points[n - 1].y - points[n - 2].y }
  const endHit = findClosestHit(points[n - 1], endDir, otherLines)
  if (endHit) result[n - 1] = endHit

  recordBefore()
  completedLines.value = [...completedLines.value, result]
  currentPoints.value = []
  startedFromExisting.value = false
}

function clearAll() {
  recordBefore()
  completedLines.value = []
  currentPoints.value = []
  startedFromExisting.value = false
}

async function apply() {
  finishLine()
  if (completedLines.value.length === 0) return

  if (hasRedSegment.value) {
    const ok = await confirm({
      title: t('slicer.split.title'),
      message: t('slicer.split.redWarning'),
    })
    if (!ok) return
  }

  const lines = completedLines.value.map(line =>
    line.map(p => ({ x: p.x + ox, y: p.y + oy })),
  )
  emit('apply', lines)
}

function deletePoint(ref: PointRef) {
  recordBefore()
  if (ref.lineIdx < 0) {
    const pts = [...currentPoints.value]
    pts.splice(ref.ptIdx, 1)
    currentPoints.value = pts
  } else {
    const newLines = completedLines.value.map(l => l.map(p => ({ ...p })))
    if (newLines[ref.lineIdx].length <= 2) {
      newLines.splice(ref.lineIdx, 1)
    } else {
      newLines[ref.lineIdx].splice(ref.ptIdx, 1)
    }
    completedLines.value = newLines
  }
}

function onContextMenu(e: MouseEvent) {
  const pos = screenToLocal(e.clientX, e.clientY)
  if (!pos) return
  const threshold = svgSnapThreshold()
  const nearPt = findNearestPoint(pos, threshold)
  if (nearPt) {
    deletePoint(nearPt)
    return
  }
  if (currentPoints.value.length >= 2) finishLine()
}

// --- Keyboard ---
function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter') { e.preventDefault(); if (currentPoints.value.length >= 2) finishLine() }
  if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); undo() }
  if ((e.key === 'y' && (e.ctrlKey || e.metaKey)) ||
      (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)) { e.preventDefault(); redo() }
}
onMounted(() => {
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('mousemove', onDocMouseMove)
  document.addEventListener('mouseup', onDocMouseUp)
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('mousemove', onDocMouseMove)
  document.removeEventListener('mouseup', onDocMouseUp)
})

// --- Rendering ---
interface Segment { from: Point; to: Point; hits: boolean }

const allSegments = computed<Segment[]>(() => {
  const segs: Segment[] = []
  for (const line of completedLines.value) {
    for (let i = 0; i < line.length - 1; i++) {
      segs.push({ from: line[i], to: line[i + 1], hits: lineHitsPixel(line[i], line[i + 1]) })
    }
  }
  for (let i = 0; i < currentPoints.value.length - 1; i++) {
    segs.push({ from: currentPoints.value[i], to: currentPoints.value[i + 1], hits: lineHitsPixel(currentPoints.value[i], currentPoints.value[i + 1]) })
  }
  return segs
})

const allPoints = computed(() => {
  const pts: Point[] = []
  for (const line of completedLines.value) pts.push(...line)
  pts.push(...currentPoints.value)
  return pts
})

const hoveredPoint = computed(() => {
  const h = hoveredPointRef.value
  if (!h) return null
  if (h.lineIdx >= 0) return completedLines.value[h.lineIdx]?.[h.ptIdx] ?? null
  return currentPoints.value[h.ptIdx] ?? null
})

const hasRedSegment = computed(() => allSegments.value.some(s => s.hits))

const previewLine = computed(() => {
  if (mode.value === 'edit') return null
  if (currentPoints.value.length === 0 || !mousePos.value) return null
  const last = currentPoints.value[currentPoints.value.length - 1]
  const to = mousePos.value
  return { from: last, to, hits: lineHitsPixel(last, to) }
})

const lineCount = computed(() => completedLines.value.length + (currentPoints.value.length >= 2 ? 1 : 0))

const svgCursor = computed(() => {
  if (mode.value === 'edit') {
    if (isDragging.value) return 'grabbing'
    if (hoveredPointRef.value) return 'grab'
    return 'default'
  }
  if (hoveredPointRef.value) return 'pointer'
  return 'crosshair'
})

const hintKey = computed(() => mode.value === 'edit' ? 'slicer.split.editHint' : 'slicer.split.drawHint')
</script>

<template>
  <ImageCanvas
    overlay
    prevent-esc-close
    :src="sprite.dataUrl"
    :overlay-title="t('slicer.split.title')"
    :overlay-subtitle="`${sw} × ${sh} px`"
    :min-scale="0.5"
    :max-scale="32"
    @close="emit('close')"
  >
    <template #default>
      <svg
        ref="svgEl"
        class="split-svg"
        :viewBox="`0 0 ${sw} ${sh}`"
        preserveAspectRatio="xMidYMid meet"
        :style="{ cursor: svgCursor }"
        @mousedown="onSvgMouseDown"
        @mousemove="onSvgMouseMove"
        @mouseup="onSvgMouseUp"
        @mouseleave="onSvgMouseLeave"
        @contextmenu.prevent="onContextMenu"
      >
        <!-- Sprite boundary -->
        <rect x="0" y="0" :width="sw" :height="sh"
          fill="transparent" stroke="rgba(74, 222, 128, 0.5)"
          stroke-width="1" stroke-dasharray="4 2"
          style="pointer-events: none"
        />

        <!-- Per-segment colored lines -->
        <line
          v-for="(seg, i) in allSegments" :key="'seg-' + i"
          :x1="seg.from.x" :y1="seg.from.y"
          :x2="seg.to.x" :y2="seg.to.y"
          :stroke="seg.hits ? '#ff6b6b' : '#4ade80'"
          stroke-width="2"
          stroke-linecap="round"
          style="pointer-events: none"
        />

        <!-- All points -->
        <circle
          v-for="(pt, i) in allPoints" :key="'pt-' + i"
          :cx="pt.x" :cy="pt.y" r="3"
          fill="#fff" stroke="#333" stroke-width="1"
          style="pointer-events: none"
        />

        <!-- Hovered point highlight (rendered on top) -->
        <circle v-if="hoveredPoint"
          :cx="hoveredPoint.x" :cy="hoveredPoint.y" r="5"
          fill="#ffd700" stroke="#fff" stroke-width="1.5"
          style="pointer-events: none"
        />

        <!-- Preview line -->
        <line v-if="previewLine"
          :x1="previewLine.from.x" :y1="previewLine.from.y"
          :x2="previewLine.to.x" :y2="previewLine.to.y"
          :stroke="previewLine.hits ? '#ff6b6b' : '#4ade80'"
          stroke-width="1.5" stroke-dasharray="4 3" stroke-linecap="round"
          style="pointer-events: none"
        />
        <circle v-if="previewLine"
          :cx="previewLine.to.x" :cy="previewLine.to.y" r="2.5"
          :fill="previewLine.hits ? '#ff6b6b' : '#4ade80'"
          stroke="#fff" stroke-width="0.8"
          style="pointer-events: none"
        />
      </svg>
    </template>

    <template #overlay-footer>
      <div class="split-toolbar">
        <div class="split-toolbar-top">
          <div class="mode-toggle">
            <button
              class="mode-btn"
              :class="{ active: mode === 'create' }"
              @click="mode = 'create'"
              :title="t('slicer.split.createMode')"
            >
              <SvgIcon name="edit" :size="11" />
            </button>
            <button
              class="mode-btn"
              :class="{ active: mode === 'edit' }"
              @click="mode = 'edit'"
              :title="t('slicer.split.editMode')"
            >
              <SvgIcon name="move" :size="11" />
            </button>
          </div>
          <span class="split-hint">{{ t(hintKey) }}</span>
        </div>
        <div class="split-actions">
          <span v-if="lineCount > 0" class="split-count">
            {{ t('slicer.split.lines', { count: lineCount }) }}
          </span>
          <button class="split-btn" @click="undo" :disabled="!canUndo" :title="t('common.undo') + ' (Ctrl+Z)'">
            <SvgIcon name="undo" :size="12" />
          </button>
          <button class="split-btn" @click="redo" :disabled="!canRedo" :title="t('common.redo') + ' (Ctrl+Y)'">
            <SvgIcon name="redo" :size="12" />
          </button>
          <button class="split-btn" @click="clearAll" :disabled="completedLines.length === 0 && currentPoints.length === 0">
            {{ t('slicer.split.clear') }}
          </button>
          <button class="split-btn accent" @click="apply" :disabled="completedLines.length === 0 && currentPoints.length < 2">
            {{ t('slicer.split.apply') }}
          </button>
        </div>
      </div>
    </template>
  </ImageCanvas>
</template>

<style scoped>
.split-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.split-toolbar {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  background: rgba(30, 30, 30, 0.92);
  border: 1px solid #555;
  border-radius: 8px;
  padding: 8px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  backdrop-filter: blur(8px);
  pointer-events: auto;
}
.split-toolbar-top {
  display: flex;
  align-items: center;
  gap: 10px;
}
.mode-toggle {
  display: flex;
  background: #2a2a2a;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid #555;
}
.mode-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3px 8px;
  background: transparent;
  border: none;
  color: #888;
  cursor: pointer;
  transition: all 0.15s;
}
.mode-btn:hover { color: #ccc; background: #383838; }
.mode-btn.active { color: #fff; background: #3b82f6; }
.split-hint { font-size: 11px; color: #888; }
.split-actions { display: flex; align-items: center; gap: 6px; }
.split-count { font-size: 11px; color: #8ab4f8; margin-right: 4px; }
.split-btn {
  display: flex; align-items: center; justify-content: center;
  gap: 4px; padding: 4px 10px;
  background: #3a3a3a; color: #ccc;
  border: 1px solid #555; border-radius: 4px;
  font-size: 11px; cursor: pointer; transition: all 0.15s;
}
.split-btn:hover:not(:disabled) { background: #4a4a4a; color: #fff; }
.split-btn:disabled { opacity: 0.4; cursor: default; }
.split-btn.accent { background: #3a6a5a; color: #d0f0e0; border-color: #4a7a6a; }
.split-btn.accent:hover:not(:disabled) { background: #4a7a6a; }
</style>
