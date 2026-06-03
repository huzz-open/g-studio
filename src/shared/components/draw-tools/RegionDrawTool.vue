<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { DrawPoint, DrawnPolygon } from './types'

const props = withDefaults(defineProps<{
  imageWidth: number
  imageHeight: number
  polygons: DrawnPolygon[]
  selectedId: string | null
  active: boolean
  creationMode: 'polygon' | 'rect'
  polygonColors: Record<string, string>
  previewFill?: boolean
  previewColor?: string
}>(), {
  previewFill: false,
  previewColor: '#4ade80',
})

const emit = defineEmits<{
  'polygon-created': [vertices: DrawPoint[]]
  'polygon-updated': [payload: { id: string; vertices: DrawPoint[] }]
  'polygon-selected': [id: string | null]
  'vertex-drag-start': []
  'vertex-drag-end': []
}>()

const svgEl = ref<SVGSVGElement>()

const creatingPoints = ref<DrawPoint[]>([])
const mousePos = ref<DrawPoint | null>(null)
const isDrawingRect = ref(false)
const rectStart = ref<DrawPoint | null>(null)

const draggingVertexIndex = ref<number | null>(null)
const hoverVertexIndex = ref<number | null>(null)
const hoverEdgeIndex = ref<number | null>(null)

const CLOSE_THRESHOLD = 8
const MIN_RECT_DRAG = 4

function screenToLocal(clientX: number, clientY: number): DrawPoint | null {
  const svg = svgEl.value
  if (!svg) return null
  const ctm = svg.getScreenCTM()
  if (!ctm) return null
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const svgPt = pt.matrixTransform(ctm.inverse())
  return { x: Math.round(svgPt.x), y: Math.round(svgPt.y) }
}

function getScreenScale(): number {
  const svg = svgEl.value
  if (!svg) return 1
  const ctm = svg.getScreenCTM()
  return ctm ? ctm.a : 1
}

function distScreen(a: DrawPoint, b: DrawPoint): number {
  const scale = getScreenScale()
  const dx = (a.x - b.x) * scale
  const dy = (a.y - b.y) * scale
  return Math.sqrt(dx * dx + dy * dy)
}

function pointsToPath(pts: DrawPoint[], close = true): string {
  if (pts.length === 0) return ''
  let d = `M${pts[0].x},${pts[0].y}`
  for (let i = 1; i < pts.length; i++) {
    d += ` L${pts[i].x},${pts[i].y}`
  }
  if (close) d += ' Z'
  return d
}

function isInsidePolygon(p: DrawPoint, verts: DrawPoint[]): boolean {
  let inside = false
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const vi = verts[i], vj = verts[j]
    if ((vi.y > p.y) !== (vj.y > p.y) &&
        p.x < (vj.x - vi.x) * (p.y - vi.y) / (vj.y - vi.y) + vi.x) {
      inside = !inside
    }
  }
  return inside
}

function closestPointOnEdge(p: DrawPoint, a: DrawPoint, b: DrawPoint): { point: DrawPoint; dist: number } {
  const dx = b.x - a.x, dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return { point: { ...a }, dist: Math.hypot(p.x - a.x, p.y - a.y) }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const proj = { x: a.x + t * dx, y: a.y + t * dy }
  return { point: proj, dist: Math.hypot(p.x - proj.x, p.y - proj.y) }
}

function distToEdgeScreen(p: DrawPoint, a: DrawPoint, b: DrawPoint): { point: DrawPoint; screenDist: number } {
  const cp = closestPointOnEdge(p, a, b)
  return { point: cp.point, screenDist: distScreen(p, cp.point) }
}

const selectedPolygon = computed(() =>
  props.selectedId ? props.polygons.find(p => p.id === props.selectedId) : null
)

const isCreating = computed(() => {
  if (!props.active) return false
  if (props.creationMode === 'rect') return isDrawingRect.value
  return creatingPoints.value.length > 0
})

const rectPreview = computed<DrawPoint[] | null>(() => {
  if (!isDrawingRect.value || !rectStart.value || !mousePos.value) return null
  const s = rectStart.value, e = mousePos.value
  return [
    { x: Math.min(s.x, e.x), y: Math.min(s.y, e.y) },
    { x: Math.max(s.x, e.x), y: Math.min(s.y, e.y) },
    { x: Math.max(s.x, e.x), y: Math.max(s.y, e.y) },
    { x: Math.min(s.x, e.x), y: Math.max(s.y, e.y) },
  ]
})

const hoverEdgePoint = ref<DrawPoint | null>(null)

watch(() => props.active, (v) => {
  if (!v) cancelCreation()
})

watch(() => props.creationMode, () => {
  cancelCreation()
})

function cancelCreation() {
  creatingPoints.value = []
  isDrawingRect.value = false
  rectStart.value = null
  mousePos.value = null
}

function onSvgMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  const pt = screenToLocal(e.clientX, e.clientY)
  if (!pt) return

  if (props.active && props.creationMode === 'rect' && !selectedPolygon.value) {
    isDrawingRect.value = true
    rectStart.value = pt
    mousePos.value = pt
    e.preventDefault()
    e.stopPropagation()
    return
  }

  if (props.active && props.creationMode === 'polygon' && creatingPoints.value.length > 0) {
    return
  }

  if (selectedPolygon.value) {
    const poly = selectedPolygon.value
    const scale = getScreenScale()

    for (let i = 0; i < poly.vertices.length; i++) {
      if (distScreen(pt, poly.vertices[i]) < CLOSE_THRESHOLD) {
        draggingVertexIndex.value = i
        emit('vertex-drag-start')
        e.preventDefault()
        e.stopPropagation()
        return
      }
    }

    if (hoverEdgeIndex.value !== null) {
      const i = hoverEdgeIndex.value
      const next = (i + 1) % poly.vertices.length
      const cp = closestPointOnEdge(pt, poly.vertices[i], poly.vertices[next])
      const newVerts = [...poly.vertices]
      newVerts.splice(i + 1, 0, cp.point)
      emit('polygon-updated', { id: poly.id, vertices: newVerts })
      draggingVertexIndex.value = i + 1
      emit('vertex-drag-start')
      hoverEdgeIndex.value = null
      hoverEdgePoint.value = null
      e.preventDefault()
      e.stopPropagation()
      return
    }

    if (isInsidePolygon(pt, poly.vertices)) {
      return
    }
  }

  if (!props.active) {
    for (const poly of props.polygons) {
      if (isInsidePolygon(pt, poly.vertices)) {
        emit('polygon-selected', poly.id)
        e.preventDefault()
        return
      }
    }
    emit('polygon-selected', null)
    return
  }

  for (const poly of props.polygons) {
    if (isInsidePolygon(pt, poly.vertices)) {
      emit('polygon-selected', poly.id)
      e.preventDefault()
      return
    }
  }

  emit('polygon-selected', null)
}

function onSvgClick(e: MouseEvent) {
  if (e.button !== 0) return
  const pt = screenToLocal(e.clientX, e.clientY)
  if (!pt) return

  if (!props.active || props.creationMode !== 'polygon') return
  if (selectedPolygon.value) return

  const pts = creatingPoints.value
  if (pts.length >= 3 && distScreen(pt, pts[0]) < CLOSE_THRESHOLD) {
    emit('polygon-created', [...pts])
    creatingPoints.value = []
    return
  }

  creatingPoints.value.push(pt)
}

function onSvgMouseMove(e: MouseEvent) {
  const pt = screenToLocal(e.clientX, e.clientY)
  if (!pt) return

  mousePos.value = pt

  if (draggingVertexIndex.value !== null && selectedPolygon.value) {
    const newVerts = [...selectedPolygon.value.vertices]
    newVerts[draggingVertexIndex.value] = pt
    emit('polygon-updated', { id: selectedPolygon.value.id, vertices: newVerts })
    return
  }

  if (selectedPolygon.value && draggingVertexIndex.value === null) {
    const poly = selectedPolygon.value
    hoverVertexIndex.value = null
    hoverEdgeIndex.value = null
    hoverEdgePoint.value = null
    for (let i = 0; i < poly.vertices.length; i++) {
      if (distScreen(pt, poly.vertices[i]) < CLOSE_THRESHOLD) {
        hoverVertexIndex.value = i
        return
      }
    }
    let bestEdge = -1
    let bestDist = Infinity
    let bestPoint: DrawPoint | null = null
    for (let i = 0; i < poly.vertices.length; i++) {
      const next = (i + 1) % poly.vertices.length
      const { point: ep, screenDist } = distToEdgeScreen(pt, poly.vertices[i], poly.vertices[next])
      if (screenDist < CLOSE_THRESHOLD && screenDist < bestDist) {
        bestEdge = i
        bestDist = screenDist
        bestPoint = ep
      }
    }
    if (bestEdge >= 0) {
      hoverEdgeIndex.value = bestEdge
      hoverEdgePoint.value = bestPoint
    }
  }
}

function onSvgMouseUp(e: MouseEvent) {
  if (draggingVertexIndex.value !== null) {
    draggingVertexIndex.value = null
    emit('vertex-drag-end')
    return
  }

  if (isDrawingRect.value && rectStart.value && mousePos.value) {
    const s = rectStart.value, end = mousePos.value
    const dx = Math.abs(s.x - end.x)
    const dy = Math.abs(s.y - end.y)
    if (dx >= MIN_RECT_DRAG || dy >= MIN_RECT_DRAG) {
      const verts: DrawPoint[] = [
        { x: Math.min(s.x, end.x), y: Math.min(s.y, end.y) },
        { x: Math.max(s.x, end.x), y: Math.min(s.y, end.y) },
        { x: Math.max(s.x, end.x), y: Math.max(s.y, end.y) },
        { x: Math.min(s.x, end.x), y: Math.max(s.y, end.y) },
      ]
      emit('polygon-created', verts)
    }
    isDrawingRect.value = false
    rectStart.value = null
  }
}

function onSvgContextMenu(e: MouseEvent) {
  e.preventDefault()
  const pt = screenToLocal(e.clientX, e.clientY)
  if (!pt) return

  if (creatingPoints.value.length > 0) {
    creatingPoints.value.pop()
    return
  }

  if (selectedPolygon.value) {
    const poly = selectedPolygon.value
    for (let i = 0; i < poly.vertices.length; i++) {
      if (distScreen(pt, poly.vertices[i]) < CLOSE_THRESHOLD) {
        if (poly.vertices.length > 3) {
          const newVerts = [...poly.vertices]
          newVerts.splice(i, 1)
          emit('polygon-updated', { id: poly.id, vertices: newVerts })
        }
        return
      }
    }
  }
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && creatingPoints.value.length > 0) {
    cancelCreation()
    e.preventDefault()
  }
}

function getColor(id: string, fallback = '#4ade80'): string {
  return props.polygonColors[id] || fallback
}

const svgCursor = computed(() => {
  if (draggingVertexIndex.value !== null) return 'grabbing'
  if (hoverVertexIndex.value !== null) return 'grab'
  if (hoverEdgeIndex.value !== null) return 'copy'
  if (props.active) return 'crosshair'
  return 'default'
})

const firstPointHover = computed(() => {
  if (props.creationMode !== 'polygon') return false
  if (creatingPoints.value.length < 3) return false
  if (!mousePos.value) return false
  return distScreen(mousePos.value, creatingPoints.value[0]) < CLOSE_THRESHOLD
})
</script>

<template>
  <svg
    ref="svgEl"
    class="region-draw-svg"
    :viewBox="`0 0 ${imageWidth} ${imageHeight}`"
    preserveAspectRatio="xMidYMid meet"
    :style="{ cursor: svgCursor }"
    @mousedown="onSvgMouseDown"
    @click="onSvgClick"
    @mousemove="onSvgMouseMove"
    @mouseup="onSvgMouseUp"
    @contextmenu="onSvgContextMenu"
    @keydown="onKeyDown"
    tabindex="0"
  >
    <!-- Existing closed polygons (unselected) -->
    <template v-for="poly in polygons" :key="poly.id">
      <template v-if="poly.id !== selectedId">
        <path
          :d="pointsToPath(poly.vertices)"
          :fill="getColor(poly.id) + '30'"
          :stroke="getColor(poly.id)"
          stroke-width="1"
          class="poly-closed"
          @mousedown.stop="emit('polygon-selected', poly.id)"
        />
      </template>
    </template>

    <!-- Selected polygon -->
    <template v-if="selectedPolygon">
      <path
        :d="pointsToPath(selectedPolygon.vertices)"
        :fill="getColor(selectedPolygon.id) + '40'"
        :stroke="getColor(selectedPolygon.id)"
        stroke-width="2"
        class="poly-selected"
      />

      <!-- Dynamic edge hover handle (follows cursor along edge) -->
      <rect
        v-if="hoverEdgePoint && hoverEdgeIndex !== null"
        :x="hoverEdgePoint.x - 3"
        :y="hoverEdgePoint.y - 3"
        width="6"
        height="6"
        fill="#ffd700"
        stroke="#555"
        stroke-width="0.5"
        class="edge-handle"
      />

      <!-- Vertex handles -->
      <template v-for="(v, i) in selectedPolygon.vertices" :key="'v-' + i">
        <circle
          :cx="v.x"
          :cy="v.y"
          r="4"
          :fill="draggingVertexIndex === i ? '#ffd700' : hoverVertexIndex === i ? '#ffd700' : '#ffffff'"
          stroke="#333"
          stroke-width="1"
          class="vertex-handle"
        />
      </template>
    </template>

    <!-- Polygon creation: existing vertices + edges -->
    <template v-if="creatingPoints.length > 0 && creationMode === 'polygon'">
      <polyline
        :points="creatingPoints.map(p => `${p.x},${p.y}`).join(' ')"
        fill="none"
        :stroke="previewColor"
        stroke-width="1.5"
      />

      <!-- Preview line to cursor -->
      <line
        v-if="mousePos && !firstPointHover"
        :x1="creatingPoints[creatingPoints.length - 1].x"
        :y1="creatingPoints[creatingPoints.length - 1].y"
        :x2="mousePos.x"
        :y2="mousePos.y"
        :stroke="previewColor"
        stroke-width="1"
        stroke-dasharray="4,3"
        opacity="0.6"
      />

      <!-- Close preview line to first point -->
      <line
        v-if="mousePos && firstPointHover && creatingPoints.length >= 3"
        :x1="creatingPoints[creatingPoints.length - 1].x"
        :y1="creatingPoints[creatingPoints.length - 1].y"
        :x2="creatingPoints[0].x"
        :y2="creatingPoints[0].y"
        stroke="#ffd700"
        stroke-width="1.5"
        stroke-dasharray="4,3"
      />

      <!-- Vertices -->
      <template v-for="(p, i) in creatingPoints" :key="'cp-' + i">
        <circle
          :cx="p.x"
          :cy="p.y"
          :r="i === 0 && firstPointHover ? 5 : 3"
          :fill="i === 0 && firstPointHover ? '#ffd700' : '#ffffff'"
          stroke="#333"
          stroke-width="1"
        />
      </template>
    </template>

    <!-- Rectangle creation preview -->
    <template v-if="isDrawingRect && rectPreview">
      <path
        :d="pointsToPath(rectPreview)"
        :fill="previewFill ? previewColor + '30' : previewColor + '15'"
        :stroke="previewColor"
        :stroke-width="previewFill ? 2 : 1.5"
        :stroke-dasharray="previewFill ? 'none' : '6,3'"
      />
    </template>
  </svg>
</template>

<style scoped>
.region-draw-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  outline: none;
}
.poly-closed {
  cursor: pointer;
}
.poly-selected {
  pointer-events: none;
}
.vertex-handle {
  cursor: grab;
}
.edge-handle {
  cursor: copy;
}
</style>
