<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import SvgIcon from '../icons/SvgIcon.vue'
import { useI18n } from '../i18n'

const { t } = useI18n()

type ControlsPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

const props = withDefaults(defineProps<{
  minScale?: number
  maxScale?: number
  contentWidth?: number
  contentHeight?: number
  transformMode?: 'css' | 'logical'
  panMode?: 'left' | 'middle'
  checkerBackground?: boolean
  pixelated?: boolean
  showControls?: boolean
  controlsPosition?: ControlsPosition
  viewportCursor?: string
  showZoomLabel?: boolean
  fullscreenToggle?: boolean
}>(), {
  minScale: 0.1,
  maxScale: 16,
  transformMode: 'css',
  panMode: 'left',
  checkerBackground: true,
  pixelated: true,
  showControls: true,
  controlsPosition: 'bottom-left',
  showZoomLabel: true,
  fullscreenToggle: false,
})

const emit = defineEmits<{
  'scale-change': [scale: number]
  'pan-change': [x: number, y: number]
  'ctrl-mousedown': [event: MouseEvent]
  'resize': [width: number, height: number]
}>()

const containerEl = ref<HTMLElement>()
const scale = ref(1)
const panX = ref(0)
const panY = ref(0)
const containerWidth = ref(0)
const containerHeight = ref(0)

let isPanning = false
let panStartX = 0
let panStartY = 0
let panStartPanX = 0
let panStartPanY = 0
let resizeObserver: ResizeObserver | null = null
let resizeDebounceTimer = 0

const zoomPercent = computed(() => Math.round(scale.value * 100))

function clampScale(v: number): number {
  return Math.min(props.maxScale, Math.max(props.minScale, v))
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const container = containerEl.value
  if (!container) return

  const rect = container.getBoundingClientRect()
  const cursorX = e.clientX - rect.left
  const cursorY = e.clientY - rect.top

  const worldX = (cursorX - panX.value) / scale.value
  const worldY = (cursorY - panY.value) / scale.value

  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
  const newScale = clampScale(scale.value * factor)

  panX.value = cursorX - worldX * newScale
  panY.value = cursorY - worldY * newScale
  scale.value = newScale
  emit('scale-change', newScale)
  emit('pan-change', panX.value, panY.value)
}

function onContainerMouseDown(e: MouseEvent) {
  if (props.panMode === 'left') {
    if (e.button === 0) {
      if (e.ctrlKey) {
        emit('ctrl-mousedown', e)
      } else {
        e.preventDefault()
        startPan(e.clientX, e.clientY)
      }
    } else if (e.button === 1) {
      e.preventDefault()
      startPan(e.clientX, e.clientY)
    }
  } else {
    if (e.button === 1) {
      e.preventDefault()
      startPan(e.clientX, e.clientY)
    } else if (e.button === 0 && e.altKey) {
      e.preventDefault()
      startPan(e.clientX, e.clientY)
    } else if (e.button === 0 && e.ctrlKey) {
      emit('ctrl-mousedown', e)
    }
  }
}

function startPan(clientX: number, clientY: number) {
  isPanning = true
  panStartX = clientX
  panStartY = clientY
  panStartPanX = panX.value
  panStartPanY = panY.value
  document.body.style.cursor = 'grabbing'
}

function onDocMouseMove(e: MouseEvent) {
  if (!isPanning) return
  panX.value = panStartPanX + (e.clientX - panStartX)
  panY.value = panStartPanY + (e.clientY - panStartY)
  emit('pan-change', panX.value, panY.value)
}

function onDocMouseUp() {
  if (isPanning) {
    isPanning = false
    document.body.style.cursor = ''
  }
}

function fitToView() {
  const container = containerEl.value
  if (!container) return
  const cw = props.contentWidth
  const ch = props.contentHeight
  if (!cw || !ch) return

  const rect = container.getBoundingClientRect()
  const vw = rect.width, vh = rect.height
  if (vw === 0 || vh === 0) return

  const s = clampScale(Math.min(vw / cw, vh / ch) * 0.95)
  scale.value = s
  panX.value = (vw - cw * s) / 2
  panY.value = (vh - ch * s) / 2
  emit('scale-change', s)
  emit('pan-change', panX.value, panY.value)
}

function zoomIn() {
  setScaleCentered(scale.value * 1.4)
}

function zoomOut() {
  setScaleCentered(scale.value / 1.4)
}

function setScaleCentered(newVal: number) {
  const container = containerEl.value
  if (!container) { scale.value = clampScale(newVal); return }
  const rect = container.getBoundingClientRect()
  const cx = rect.width / 2, cy = rect.height / 2
  const worldX = (cx - panX.value) / scale.value
  const worldY = (cy - panY.value) / scale.value
  const clamped = clampScale(newVal)
  panX.value = cx - worldX * clamped
  panY.value = cy - worldY * clamped
  scale.value = clamped
  emit('scale-change', clamped)
  emit('pan-change', panX.value, panY.value)
}

function saveState() {
  return { scale: scale.value, panX: panX.value, panY: panY.value }
}

function restoreState(s: { scale: number; panX: number; panY: number }) {
  scale.value = s.scale
  panX.value = s.panX
  panY.value = s.panY
  emit('scale-change', s.scale)
  emit('pan-change', s.panX, s.panY)
}

function handleResize() {
  const container = containerEl.value
  if (!container) return
  const rect = container.getBoundingClientRect()
  containerWidth.value = rect.width
  containerHeight.value = rect.height
  emit('resize', rect.width, rect.height)
}

function setupResizeObserver() {
  if (!containerEl.value) return
  resizeObserver = new ResizeObserver(() => {
    clearTimeout(resizeDebounceTimer)
    resizeDebounceTimer = window.setTimeout(handleResize, 16)
  })
  resizeObserver.observe(containerEl.value)
  nextTick(handleResize)
}

onMounted(() => {
  document.addEventListener('mousemove', onDocMouseMove)
  document.addEventListener('mouseup', onDocMouseUp)
  setupResizeObserver()
})

onUnmounted(() => {
  document.removeEventListener('mousemove', onDocMouseMove)
  document.removeEventListener('mouseup', onDocMouseUp)
  resizeObserver?.disconnect()
  clearTimeout(resizeDebounceTimer)
})

watch(() => [props.contentWidth, props.contentHeight], () => {
  if (props.contentWidth && props.contentHeight && scale.value === 1 && panX.value === 0 && panY.value === 0) {
    nextTick(fitToView)
  }
})

const cursorStyle = computed(() => {
  if (props.viewportCursor) return props.viewportCursor
  if (props.panMode === 'left') return 'grab'
  return 'default'
})

defineExpose({
  scale,
  panX,
  panY,
  containerWidth,
  containerHeight,
  fitToView,
  zoomIn,
  zoomOut,
  setScaleCentered,
  saveState,
  restoreState,
})
</script>

<template>
  <div
    ref="containerEl"
    class="pzv-container"
    :class="{
      checker: checkerBackground,
      'mode-logical': transformMode === 'logical',
    }"
    :style="{ cursor: cursorStyle }"
    @wheel.prevent="onWheel"
    @mousedown="onContainerMouseDown"
    @contextmenu.prevent
  >
    <!-- CSS transform mode -->
    <div
      v-if="transformMode === 'css'"
      class="pzv-transform"
      :style="{
        transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
        transformOrigin: '0 0',
      }"
      :class="{ pixelated }"
    >
      <slot
        :scale="scale"
        :panX="panX"
        :panY="panY"
        :containerWidth="containerWidth"
        :containerHeight="containerHeight"
      />
    </div>

    <!-- Logical mode: slot fills viewport, no CSS transform wrapper -->
    <slot
      v-else
      :scale="scale"
      :panX="panX"
      :panY="panY"
      :containerWidth="containerWidth"
      :containerHeight="containerHeight"
    />

    <!-- Zoom controls -->
    <div v-if="showControls" class="pzv-controls" :class="`pos-${controlsPosition}`">
      <span v-if="showZoomLabel" class="pzv-ctrl-zoom">{{ zoomPercent }}%</span>
      <button class="pzv-ctrl-btn" @click="fitToView" :title="t('common.fitView')">
        <SvgIcon name="fit-view" :size="12" />
      </button>
      <button class="pzv-ctrl-btn" @click="zoomIn" :title="t('common.zoomIn')">+</button>
      <button class="pzv-ctrl-btn" @click="zoomOut" :title="t('common.zoomOut')">−</button>
      <slot name="controls-extra" />
    </div>

    <slot name="toolbar-left" />
    <slot name="toolbar-right" />
  </div>
</template>

<style scoped>
.pzv-container {
  flex: 1;
  overflow: hidden;
  position: relative;
}
.pzv-container:active {
  cursor: grabbing;
}
.pzv-container.checker {
  background: repeating-conic-gradient(#3a3a3a 0% 25%, #2a2a2a 0% 50%) 0 0 / 16px 16px;
}
.pzv-container.mode-logical {
  display: flex;
}

.pzv-transform {
  display: inline-block;
  will-change: transform;
  position: relative;
}
.pzv-transform.pixelated {
  image-rendering: pixelated;
}

.pzv-controls {
  position: absolute;
  display: flex;
  gap: 3px;
  padding: 4px;
  background: rgba(30, 30, 30, 0.75);
  border-radius: 6px;
  backdrop-filter: blur(6px);
  z-index: 10;
  pointer-events: auto;
}
.pzv-controls.pos-bottom-left { bottom: 10px; left: 10px; }
.pzv-controls.pos-bottom-right { bottom: 10px; right: 10px; }
.pzv-controls.pos-top-left { top: 10px; left: 10px; }
.pzv-controls.pos-top-right { top: 10px; right: 10px; }

.pzv-ctrl-zoom {
  font-size: 10px;
  color: #8ab4f8;
  font-variant-numeric: tabular-nums;
  min-width: 32px;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
  user-select: none;
}
.pzv-ctrl-btn {
  background: rgba(60, 60, 60, 0.6);
  color: #bbb;
  border: 1px solid rgba(100, 100, 100, 0.4);
  border-radius: 4px;
  padding: 0;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 22px;
  transition: all 0.15s;
}
.pzv-ctrl-btn:hover {
  background: rgba(80, 80, 80, 0.8);
  color: #fff;
  border-color: rgba(140, 140, 140, 0.5);
}
</style>
