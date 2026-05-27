<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import SvgIcon from '../icons/SvgIcon.vue'
import { useI18n } from '../i18n'
import PanZoomViewport from './PanZoomViewport.vue'

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

const pzvRef = ref<InstanceType<typeof PanZoomViewport>>()
const isFullscreen = ref(false)
const imgNaturalW = ref(0)
const imgNaturalH = ref(0)
const imageReady = ref(false)

const scale = computed(() => pzvRef.value?.scale ?? 1)
const panX = computed(() => pzvRef.value?.panX ?? 0)
const panY = computed(() => pzvRef.value?.panY ?? 0)
const zoomPercent = computed(() => Math.round(scale.value * 100))
const showPzvControls = computed(() => props.controlsPosition !== 'none')
const controlsClass = computed(() => [
  `pos-${props.controlsPosition}`,
  `dir-${props.controlsDirection}`,
])

const pzvControlsPosition = computed(() => {
  if (props.controlsPosition === 'none') return 'bottom-left'
  return props.controlsPosition as 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
})

function onScaleChange(s: number) {
  emit('scale-change', s)
}

function onCtrlMouseDown(e: MouseEvent) {
  emit('ctrl-mousedown', e)
}

function fitToView() {
  pzvRef.value?.fitToView()
}

function zoomIn() {
  pzvRef.value?.zoomIn()
}

function zoomOut() {
  pzvRef.value?.zoomOut()
}

function setScaleCentered(newVal: number) {
  pzvRef.value?.setScaleCentered(newVal)
}

function saveState() {
  return pzvRef.value?.saveState() ?? { scale: 1, panX: 0, panY: 0 }
}

function restoreState(s: { scale: number; panX: number; panY: number }) {
  pzvRef.value?.restoreState(s)
}

function toggleFullscreen() {
  imageReady.value = false
  isFullscreen.value = !isFullscreen.value
  nextTick(() => {
    const container = pzvRef.value?.$el
    const card = container?.closest('.ic-overlay-card') as HTMLElement | null
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
  document.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
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
  saveState,
  restoreState,
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
        <PanZoomViewport
          ref="pzvRef"
          transform-mode="css"
          pan-mode="left"
          :min-scale="minScale"
          :max-scale="maxScale"
          :content-width="imgNaturalW"
          :content-height="imgNaturalH"
          :checker-background="checkerBackground"
          :pixelated="pixelated"
          :show-controls="false"
          @scale-change="onScaleChange"
          @ctrl-mousedown="onCtrlMouseDown"
        >
          <template #default="slotProps">
            <div :style="{ visibility: imageReady ? 'visible' : 'hidden' }">
              <img
                v-if="src"
                :src="src"
                class="ic-image"
                :class="{ pixelated }"
                draggable="false"
                @load="onImageLoad"
              />
              <slot :scale="slotProps.scale" :panX="slotProps.panX" :panY="slotProps.panY" />
            </div>
          </template>
        </PanZoomViewport>

        <!-- Custom controls for overlay (with fullscreen toggle) -->
        <div v-if="showPzvControls" class="ic-controls ic-controls-overlay" :class="controlsClass">
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
  </Teleport>

  <!-- Inline mode -->
  <template v-else>
    <div class="ic-inline" :class="{ fullscreen: isFullscreen }">
      <div v-if="showInfoBar" class="ic-infobar">
        <slot name="toolbar-left" />
        <span class="ic-spacer" />
        <slot name="toolbar-right" />
      </div>
      <PanZoomViewport
        ref="pzvRef"
        transform-mode="css"
        pan-mode="left"
        :min-scale="minScale"
        :max-scale="maxScale"
        :content-width="imgNaturalW"
        :content-height="imgNaturalH"
        :checker-background="checkerBackground"
        :pixelated="pixelated"
        :show-controls="false"
        :viewport-cursor="viewportCursor"
        @scale-change="onScaleChange"
        @ctrl-mousedown="onCtrlMouseDown"
      >
        <template #default="slotProps">
          <div :style="{ visibility: imageReady ? 'visible' : 'hidden' }">
            <img
              v-if="src"
              :src="src"
              class="ic-image"
              :class="{ pixelated }"
              draggable="false"
              @load="onImageLoad"
            />
            <slot :scale="slotProps.scale" :panX="slotProps.panX" :panY="slotProps.panY" />
          </div>
        </template>
      </PanZoomViewport>

      <!-- Custom controls for inline (with fullscreen toggle) -->
      <div v-if="showPzvControls" class="ic-controls" :class="controlsClass">
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
  </template>
</template>

<style scoped>
.ic-inline {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
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

.ic-image {
  display: block;
  user-select: none;
  -webkit-user-drag: none;
}
.ic-image.pixelated { image-rendering: pixelated; }

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
.ic-controls-overlay {
  position: absolute;
  bottom: 10px;
  left: 10px;
}
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
  position: relative;
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
