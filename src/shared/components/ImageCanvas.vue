<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import SvgIcon from '../icons/SvgIcon.vue'
import { useI18n } from '../i18n'

const { t } = useI18n()

type ControlsPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'none'
type ControlsDirection = 'horizontal' | 'vertical'

const props = withDefaults(defineProps<{
  src?: string
  checkerBackground?: boolean
  pixelated?: boolean
  minScale?: number
  maxScale?: number
  showInfoBar?: boolean
  showZoomLabel?: boolean
  fullscreenToggle?: boolean
  controlsPosition?: ControlsPosition
  controlsDirection?: ControlsDirection
  overlay?: boolean
  overlayTitle?: string
  overlaySubtitle?: string
  keepViewOnSrcChange?: boolean
  viewportCursor?: string
  preventEscClose?: boolean
}>(), {
  src: '',
  checkerBackground: true,
  pixelated: true,
  minScale: 0.1,
  maxScale: 16,
  showInfoBar: false,
  showZoomLabel: true,
  fullscreenToggle: true,
  controlsPosition: 'bottom-left',
  controlsDirection: 'horizontal',
  overlay: false,
  overlayTitle: '',
  overlaySubtitle: '',
  keepViewOnSrcChange: false,
})

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'scale-change', scale: number): void
  (e: 'ctrl-mousedown', event: MouseEvent): void
}>()

const containerEl = ref<HTMLElement>()
const scale = ref(1)
const panX = ref(0)
const panY = ref(0)
let isPanning = false
let panStartX = 0
let panStartY = 0
let panStartPanX = 0
let panStartPanY = 0
const isFullscreen = ref(false)
const imgNaturalW = ref(0)
const imgNaturalH = ref(0)
const imageReady = ref(false)

const zoomPercent = computed(() => Math.round(scale.value * 100))
const showControls = computed(() => props.controlsPosition !== 'none')
const controlsClass = computed(() => [
  `pos-${props.controlsPosition}`,
  `dir-${props.controlsDirection}`,
])

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
  const newScale = Math.min(props.maxScale, Math.max(props.minScale, scale.value * factor))

  panX.value = cursorX - worldX * newScale
  panY.value = cursorY - worldY * newScale
  scale.value = newScale
  emit('scale-change', newScale)
}

function onContainerMouseDown(e: MouseEvent) {
  if (e.button === 0) {
    if (e.ctrlKey) {
      emit('ctrl-mousedown', e)
    } else {
      e.preventDefault()
      startPan(e.clientX, e.clientY)
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
}

function onDocMouseUp() {
  if (isPanning) {
    isPanning = false
    document.body.style.cursor = ''
  }
}

function fitToView() {
  const container = containerEl.value
  if (!container || !imgNaturalW.value || !imgNaturalH.value) return
  const rect = container.getBoundingClientRect()
  const vw = rect.width, vh = rect.height
  if (vw === 0 || vh === 0) return
  const iw = imgNaturalW.value, ih = imgNaturalH.value
  const margin = props.overlay ? 0.85 : 0.95
  let s = Math.min(vw / iw, vh / ih) * margin
  if (props.overlay) s = Math.min(s, 4)
  const clamped = Math.min(props.maxScale, Math.max(props.minScale, s))
  scale.value = clamped
  panX.value = (vw - iw * clamped) / 2
  panY.value = (vh - ih * clamped) / 2
  emit('scale-change', clamped)
}

function zoomIn() {
  setScaleCentered(scale.value * 1.4)
}

function zoomOut() {
  setScaleCentered(scale.value / 1.4)
}

function setScaleCentered(newVal: number) {
  const container = containerEl.value
  if (!container) { scale.value = newVal; return }
  const rect = container.getBoundingClientRect()
  const cx = rect.width / 2, cy = rect.height / 2
  const worldX = (cx - panX.value) / scale.value
  const worldY = (cy - panY.value) / scale.value
  const clamped = Math.min(props.maxScale, Math.max(props.minScale, newVal))
  panX.value = cx - worldX * clamped
  panY.value = cy - worldY * clamped
  scale.value = clamped
  emit('scale-change', clamped)
}

function toggleFullscreen() {
  imageReady.value = false
  isFullscreen.value = !isFullscreen.value
  nextTick(() => {
    const card = containerEl.value?.closest('.ic-overlay-card') as HTMLElement | null
    if (card) {
      const onEnd = () => {
        card.removeEventListener('transitionend', onEnd)
        fitToView()
        imageReady.value = true
      }
      card.addEventListener('transitionend', onEnd)
    } else {
      setTimeout(() => { fitToView(); imageReady.value = true }, 50)
    }
  })
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (isFullscreen.value) {
      e.preventDefault()
      e.stopImmediatePropagation()
      toggleFullscreen()
      return
    }
    if (props.overlay && !props.preventEscClose) {
      emit('close')
    }
  }
}

function isInFullscreen(): boolean {
  return isFullscreen.value
}

function onImageLoad(e: Event) {
  const img = e.target as HTMLImageElement
  imgNaturalW.value = img.naturalWidth
  imgNaturalH.value = img.naturalHeight
  if (props.keepViewOnSrcChange && imageReady.value) return
  nextTick(() => {
    fitToView()
    imageReady.value = true
  })
}

watch(() => props.src, () => {
  if (!props.keepViewOnSrcChange) {
    imageReady.value = false
  }
})

onMounted(() => {
  document.addEventListener('mousemove', onDocMouseMove)
  document.addEventListener('mouseup', onDocMouseUp)
  document.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  document.removeEventListener('mousemove', onDocMouseMove)
  document.removeEventListener('mouseup', onDocMouseUp)
  document.removeEventListener('keydown', onKeyDown)
})

defineExpose({
  scale,
  panX,
  panY,
  fitToView,
  zoomIn,
  zoomOut,
  setScaleCentered,
  isInFullscreen,
})
</script>

<template>
  <!-- Overlay mode -->
  <Teleport v-if="overlay" to="body">
    <div class="ic-overlay" @click="emit('close')">
      <div class="ic-overlay-card" :class="{ fullscreen: isFullscreen }" @click.stop>
        <div class="ic-overlay-header">
          <span v-if="overlayTitle" class="ic-overlay-title">{{ overlayTitle }}</span>
          <span v-if="overlaySubtitle" class="ic-overlay-subtitle">{{ overlaySubtitle }}</span>
          <span class="ic-spacer" />
          <button class="ic-close-btn" @click="emit('close')" :title="t('common.close')">✕</button>
        </div>
        <div
          ref="containerEl"
          class="ic-viewport"
          :class="{ checker: checkerBackground }"
          @wheel.prevent="onWheel"
          @mousedown="onContainerMouseDown"
          @contextmenu.prevent
        >
          <div
            class="ic-transform"
            :style="{
              transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
              transformOrigin: '0 0',
              visibility: imageReady ? 'visible' : 'hidden',
            }"
          >
            <img
              v-if="src"
              :src="src"
              class="ic-image"
              :class="{ pixelated }"
              draggable="false"
              @load="onImageLoad"
            />
            <slot :scale="scale" :panX="panX" :panY="panY" />
          </div>

          <div v-if="showControls" class="ic-controls" :class="controlsClass">
            <span v-if="showZoomLabel" class="ic-ctrl-zoom">{{ zoomPercent }}%</span>
            <button class="ic-ctrl-btn" @click="fitToView" :title="t('common.fitView')">
              <SvgIcon name="fit-view" :size="12" />
            </button>
            <button class="ic-ctrl-btn" @click="zoomIn" :title="t('common.zoomIn')">+</button>
            <button class="ic-ctrl-btn" @click="zoomOut" :title="t('common.zoomOut')">−</button>
            <button v-if="fullscreenToggle" class="ic-ctrl-btn" @click="toggleFullscreen" :title="t('common.fullscreen')">
              <SvgIcon name="maximize" :size="12" />
            </button>
          </div>
          <slot name="overlay-footer" />
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Inline mode -->
  <template v-else>
    <div class="ic-inline" :class="{ fullscreen: isFullscreen }">
      <div v-if="showInfoBar" class="ic-infobar">
        <slot name="toolbar-left" />
        <span class="ic-spacer" />
        <slot name="toolbar-right" />
      </div>
      <div
        ref="containerEl"
        class="ic-viewport"
        :class="{ checker: checkerBackground }"
        :style="viewportCursor ? { cursor: viewportCursor } : undefined"
        @wheel.prevent="onWheel"
        @mousedown="onContainerMouseDown"
        @contextmenu.prevent
      >
        <div
          class="ic-transform"
          :style="{
            transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
            transformOrigin: '0 0',
            visibility: imageReady ? 'visible' : 'hidden',
          }"
        >
          <img
            v-if="src"
            :src="src"
            class="ic-image"
            :class="{ pixelated }"
            draggable="false"
            @load="onImageLoad"
          />
          <slot :scale="scale" :panX="panX" :panY="panY" />
        </div>

        <div v-if="showControls" class="ic-controls" :class="controlsClass">
          <span v-if="showZoomLabel" class="ic-ctrl-zoom">{{ zoomPercent }}%</span>
          <button class="ic-ctrl-btn" @click="fitToView" :title="t('common.fitView')">
            <SvgIcon name="fit-view" :size="12" />
          </button>
          <button class="ic-ctrl-btn" @click="zoomIn" :title="t('common.zoomIn')">+</button>
          <button class="ic-ctrl-btn" @click="zoomOut" :title="t('common.zoomOut')">−</button>
          <button v-if="fullscreenToggle" class="ic-ctrl-btn" @click="toggleFullscreen" :title="t('common.fullscreen')">
            <SvgIcon name="maximize" :size="12" />
          </button>
        </div>
      </div>
    </div>
  </template>
</template>

<style scoped>
/* Inline mode */
.ic-inline {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ic-inline.fullscreen {
  position: fixed;
  inset: 0;
  z-index: 9998;
  background: #1a1a1a;
}
.ic-infobar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  flex-shrink: 0;
}
.ic-spacer { flex: 1; }

/* Viewport */
.ic-viewport {
  flex: 1;
  overflow: hidden;
  position: relative;
  cursor: grab;
}
.ic-viewport:active { cursor: grabbing; }
.ic-viewport.checker {
  background: repeating-conic-gradient(#3a3a3a 0% 25%, #2a2a2a 0% 50%) 0 0 / 16px 16px;
}
.ic-transform {
  display: inline-block;
  will-change: transform;
  position: relative;
}
.ic-image {
  display: block;
  user-select: none;
  -webkit-user-drag: none;
}
.ic-image.pixelated { image-rendering: pixelated; }

/* Floating controls */
.ic-controls {
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
.ic-controls.pos-bottom-left { bottom: 10px; left: 10px; }
.ic-controls.pos-bottom-right { bottom: 10px; right: 10px; }
.ic-controls.pos-top-left { top: 10px; left: 10px; }
.ic-controls.pos-top-right { top: 10px; right: 10px; }
.ic-controls.dir-vertical { flex-direction: column; }
.ic-ctrl-zoom {
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
.ic-ctrl-btn {
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
.ic-ctrl-btn:hover { background: rgba(80, 80, 80, 0.8); color: #fff; border-color: rgba(140, 140, 140, 0.5); }

/* Overlay mode */
.ic-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}
.ic-overlay-card {
  background: #2a2a2a;
  border: 1px solid #555;
  border-radius: 12px;
  overflow: hidden;
  width: 70vw;
  height: 70vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
  transition: all 0.2s;
}
.ic-overlay-card.fullscreen {
  width: 100vw;
  height: 100vh;
  border-radius: 0;
  border: none;
}
.ic-overlay-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid #3a3a3a;
  background: #252525;
  flex-shrink: 0;
}
.ic-overlay-title { font-size: 13px; color: #eee; font-weight: 500; }
.ic-overlay-subtitle { font-size: 11px; color: #888; }
.ic-close-btn {
  background: none;
  border: none;
  color: #888;
  font-size: 16px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  margin-left: 4px;
}
.ic-close-btn:hover { color: #ddd; }
</style>
