<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from '../../../shared/i18n'
import SvgIcon from '../../../shared/icons/SvgIcon.vue'
import ImageCanvas from '../../../shared/components/ImageCanvas.vue'
import type { DetectedSprite } from '../interfaces/sprite-detector'

type SelectionMode = 'by-row' | 'by-count'

const props = defineProps<{
  frames: DetectedSprite[]
}>()

const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()

const playing = ref(true)
const frameIdx = ref(0)
const fps = ref(8)
const loop = ref(true)
let timer: number | null = null

const selectionMode = ref<SelectionMode>('by-row')
const groupFrameCount = ref(4)
const activeGroupIdx = ref(0)
const showCountInput = ref(false)
const countInputEl = ref<HTMLInputElement>()

const canvasRef = ref<InstanceType<typeof ImageCanvas>>()

let isResizing = false
let resizeStartX = 0
let resizeStartY = 0
let resizeStartW = 0
let resizeStartH = 0

const modalWidth = ref(780)
const modalHeight = ref(560)
const MIN_W = 480
const MIN_H = 360

const groups = computed<DetectedSprite[][]>(() => {
  const all = props.frames
  if (selectionMode.value === 'by-row') {
    const threshold = 20
    const rows: { y: number; sprites: DetectedSprite[] }[] = []
    for (const sprite of all) {
      const sy = sprite.rect.y
      let matched = false
      for (const row of rows) {
        if (Math.abs(sy - row.y) <= threshold) {
          row.sprites.push(sprite)
          matched = true
          break
        }
      }
      if (!matched) rows.push({ y: sy, sprites: [sprite] })
    }
    rows.sort((a, b) => a.y - b.y)
    return rows.map(r => r.sprites).filter(g => g.length > 0)
  }
  const n = Math.max(1, groupFrameCount.value)
  const result: DetectedSprite[][] = []
  for (let i = 0; i < all.length; i += n) {
    result.push(all.slice(i, i + n))
  }
  return result
})

const activeFrames = computed(() => {
  const idx = Math.min(activeGroupIdx.value, groups.value.length - 1)
  return groups.value[Math.max(0, idx)] || []
})

const currentFrame = computed(() => activeFrames.value[frameIdx.value])
const currentFrameSrc = computed(() => currentFrame.value?.dataUrl ?? '')

function scheduleNext() {
  if (timer !== null) clearTimeout(timer)
  if (!playing.value) return
  timer = window.setTimeout(() => {
    const total = activeFrames.value.length
    if (total === 0) { stop(); return }
    const next = frameIdx.value + 1
    if (next >= total) {
      if (loop.value) { frameIdx.value = 0; scheduleNext() }
      else { frameIdx.value = total - 1; stop() }
    } else {
      frameIdx.value = next
      scheduleNext()
    }
  }, Math.round(1000 / fps.value))
}

function start() { playing.value = true; scheduleNext() }
function stop() { playing.value = false; if (timer !== null) { clearTimeout(timer); timer = null } }
function toggle() { playing.value ? stop() : start() }
function goTo(idx: number) { frameIdx.value = Math.max(0, Math.min(idx, activeFrames.value.length - 1)) }
function stepPrev() {
  const len = activeFrames.value.length
  if (len === 0) return
  frameIdx.value = (frameIdx.value - 1 + len) % len
}
function stepNext() {
  const len = activeFrames.value.length
  if (len === 0) return
  frameIdx.value = (frameIdx.value + 1) % len
}

function selectGroup(idx: number) {
  activeGroupIdx.value = idx
  frameIdx.value = 0
  if (!playing.value) start()
}

function onCountBtnClick() {
  selectionMode.value = 'by-count'
  showCountInput.value = true
  nextTick(() => {
    countInputEl.value?.focus()
    countInputEl.value?.select()
  })
}

function closeCountInput() {
  showCountInput.value = false
}

function onResizeStart(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  isResizing = true
  resizeStartX = e.clientX
  resizeStartY = e.clientY
  resizeStartW = modalWidth.value
  resizeStartH = modalHeight.value
}

function onDocMouseMove(e: MouseEvent) {
  if (isResizing) {
    const dw = e.clientX - resizeStartX
    const dh = e.clientY - resizeStartY
    modalWidth.value = Math.max(MIN_W, resizeStartW + dw)
    modalHeight.value = Math.max(MIN_H, resizeStartH + dh)
  }
}

function onDocMouseUp() {
  isResizing = false
}

watch(fps, () => { if (playing.value) { if (timer !== null) clearTimeout(timer); scheduleNext() } })
watch(activeFrames, (f) => {
  if (frameIdx.value >= f.length) frameIdx.value = Math.max(0, f.length - 1)
  if (playing.value) { if (timer !== null) clearTimeout(timer); scheduleNext() }
})
watch(selectionMode, () => {
  activeGroupIdx.value = 0
  frameIdx.value = 0
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    if (canvasRef.value?.isInFullscreen()) return
    emit('close')
  }
}

onMounted(() => {
  document.addEventListener('mousemove', onDocMouseMove)
  document.addEventListener('mouseup', onDocMouseUp)
  document.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  if (timer !== null) clearTimeout(timer)
  document.removeEventListener('mousemove', onDocMouseMove)
  document.removeEventListener('mouseup', onDocMouseUp)
  document.removeEventListener('keydown', onKeydown)
})

scheduleNext()
</script>

<template>
  <Teleport to="body">
    <div class="anim-overlay">
      <div
        class="anim-modal"
        :style="{ width: modalWidth + 'px', height: modalHeight + 'px' }"
      >
        <!-- Header -->
        <div class="anim-header">
          <h3>{{ t('slicer.anim.title') }} · {{ frames.length }} {{ t('slicer.anim.frames') }}</h3>
          <span class="mode-label">{{ t('slicer.anim.splitMode') }}</span>
          <div class="mode-switch">
            <button
              class="mode-btn"
              :class="{ active: selectionMode === 'by-row' }"
              :title="t('slicer.anim.mode.byRow.tip')"
              @click="selectionMode = 'by-row'"
            >{{ t('slicer.anim.mode.byRow') }}</button>
            <button
              class="mode-btn"
              :class="{ active: selectionMode === 'by-count' }"
              :title="t('slicer.anim.mode.byCount.tip')"
              @click="onCountBtnClick"
            >{{ t('slicer.anim.mode.byCount') }}{{ selectionMode === 'by-count' ? ` (${groupFrameCount})` : '' }}</button>
          </div>
          <div v-if="showCountInput" class="count-popover" @click.stop>
            <label class="count-popover-label">{{ t('slicer.anim.frameCount') }}</label>
            <input
              ref="countInputEl"
              type="number"
              class="count-popover-input"
              v-model.number="groupFrameCount"
              min="1"
              :max="frames.length"
              @blur="closeCountInput"
              @keydown.enter="closeCountInput"
            />
          </div>
          <button class="header-btn" @click="emit('close')" :title="t('common.close')">
            <SvgIcon name="close" :size="14" />
          </button>
        </div>

        <div class="anim-body-wrap">
          <!-- Group list sidebar -->
          <div v-if="groups.length > 1" class="group-sidebar">
            <div class="group-list">
              <button
                v-for="(g, gi) in groups"
                :key="gi"
                class="group-item"
                :class="{ active: gi === activeGroupIdx }"
                @click="selectGroup(gi)"
              >
                <span class="group-label">{{ t('slicer.anim.group') }} {{ gi + 1 }}</span>
                <span class="group-count">{{ g.length }} {{ t('slicer.anim.frames') }}</span>
              </button>
            </div>
          </div>

          <!-- Main preview area -->
          <div class="anim-body">
            <ImageCanvas
              ref="canvasRef"
              :src="currentFrameSrc"
              :min-scale="0.25"
              :max-scale="32"
              keep-view-on-src-change
            />

            <!-- Transport controls -->
            <div class="anim-controls">
              <div class="anim-transport">
                <button class="anim-btn" @click="stepPrev">
                  <SvgIcon name="step-back" :size="14" />
                </button>
                <button class="anim-btn anim-btn-play" @click="toggle">
                  <SvgIcon :name="playing ? 'pause' : 'play'" :size="16" />
                </button>
                <button class="anim-btn" @click="stepNext">
                  <SvgIcon name="step-forward" :size="14" />
                </button>
              </div>
              <div class="anim-progress">
                <input
                  type="range" class="anim-slider"
                  :min="0" :max="Math.max(0, activeFrames.length - 1)"
                  :value="frameIdx"
                  @input="goTo(Number(($event.target as HTMLInputElement).value))"
                />
                <span class="anim-frame-num">{{ activeFrames.length > 0 ? frameIdx + 1 : 0 }} / {{ activeFrames.length }}</span>
              </div>
              <div class="anim-settings">
                <div class="anim-setting-row">
                  <label class="anim-label">{{ t('slicer.anim.fps') }}</label>
                  <input type="range" class="slider" v-model.number="fps" min="1" max="60" />
                  <input type="number" class="anim-num-input" v-model.number="fps" min="1" max="60" />
                </div>
                <label class="anim-toggle">
                  <input type="checkbox" v-model="loop" />
                  <span>{{ t('slicer.anim.loop') }}</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <!-- Filmstrip -->
        <div class="anim-filmstrip">
          <div
            v-for="(frame, idx) in activeFrames"
            :key="frame.id"
            class="anim-thumb"
            :class="{ active: idx === frameIdx }"
            @click="goTo(idx)"
          >
            <img :src="frame.dataUrl" />
            <span class="anim-thumb-num">{{ idx + 1 }}</span>
          </div>
        </div>

        <!-- Resize handle -->
        <div class="resize-handle" @mousedown="onResizeStart" />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.anim-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.85);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.anim-modal {
  background: #2a2a2a;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 12px 40px rgba(0,0,0,0.6);
  position: relative;
  max-width: 95vw;
  max-height: 92vh;
  transition: none;
}
.anim-header {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid #444;
  gap: 8px;
  flex-shrink: 0;
  position: relative;
}
.anim-header h3 { margin: 0; font-size: 13px; color: #eee; flex-shrink: 0; }
.mode-label { font-size: 11px; color: #888; margin-left: auto; flex-shrink: 0; }
.mode-switch {
  display: flex;
  border: 1px solid #444;
  border-radius: 5px;
  overflow: hidden;
  position: relative;
}
.count-popover {
  position: absolute;
  top: 100%;
  right: 80px;
  margin-top: 6px;
  background: #333;
  border: 1px solid #555;
  border-radius: 6px;
  padding: 8px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  z-index: 10;
}
.count-popover-label {
  font-size: 11px;
  color: #aaa;
  white-space: nowrap;
}
.count-popover-input {
  width: 56px;
  padding: 3px 6px;
  background: #2a2a2a;
  color: #eee;
  border: 1px solid #555;
  border-radius: 4px;
  font-size: 12px;
  text-align: center;
  -moz-appearance: textfield;
}
.count-popover-input::-webkit-outer-spin-button,
.count-popover-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.mode-btn {
  padding: 3px 10px;
  background: transparent;
  color: #888;
  border: none;
  border-right: 1px solid #444;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.mode-btn:last-child { border-right: none; }
.mode-btn:hover { background: #333; color: #bbb; }
.mode-btn.active { background: #3a3a3a; color: #eee; }
.header-btn {
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.header-btn:hover { color: #fff; background: #444; }

.anim-body-wrap {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}
.group-sidebar {
  width: 140px;
  min-width: 140px;
  border-right: 1px solid #3a3a3a;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.group-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}
.group-item {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 6px 8px;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
}
.group-item:hover { background: #333; }
.group-item.active { background: #3a4a5a; }
.group-label { font-size: 11px; color: #ccc; }
.group-count { font-size: 10px; color: #666; }

.anim-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 10px;
  gap: 8px;
  overflow: hidden;
  min-width: 0;
}
.anim-controls {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}
.anim-transport { display: flex; align-items: center; justify-content: center; gap: 12px; }
.anim-btn {
  background: #444;
  border: none;
  color: #ddd;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}
.anim-btn:hover { background: #555; }
.anim-btn-play { width: 38px; height: 38px; background: #3a6a5a; color: #d0f0e0; }
.anim-btn-play:hover { background: #4a7a6a; }
.anim-progress { display: flex; align-items: center; gap: 10px; }
.anim-slider { flex: 1; accent-color: #7aa2d4; }
.anim-frame-num { font-size: 11px; color: #888; min-width: 50px; text-align: right; }
.anim-settings { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.anim-setting-row { display: flex; align-items: center; gap: 6px; }
.anim-label { font-size: 11px; color: #888; min-width: 28px; }
.slider { accent-color: #5577aa; }
.anim-num-input {
  width: 44px;
  padding: 2px 4px;
  background: #333;
  color: #eee;
  border: 1px solid #555;
  border-radius: 3px;
  font-size: 12px;
  text-align: center;
  -moz-appearance: textfield;
}
.anim-num-input::-webkit-outer-spin-button,
.anim-num-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.anim-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #ccc;
  cursor: pointer;
}
.anim-toggle input[type="checkbox"] { accent-color: #7aa2d4; }
.anim-filmstrip {
  display: flex;
  gap: 4px;
  padding: 6px 10px;
  border-top: 1px solid #444;
  overflow-x: auto;
  max-height: 64px;
  flex-shrink: 0;
}
.anim-thumb {
  position: relative;
  flex-shrink: 0;
  width: 42px;
  height: 42px;
  border: 2px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #222;
  overflow: hidden;
  transition: border-color 0.15s;
}
.anim-thumb:hover { border-color: #555; }
.anim-thumb.active { border-color: #7aa2d4; }
.anim-thumb img { max-width: 100%; max-height: 100%; image-rendering: pixelated; object-fit: contain; }
.anim-thumb-num { position: absolute; bottom: 1px; right: 2px; font-size: 9px; color: #666; pointer-events: none; }
.resize-handle {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  cursor: se-resize;
  z-index: 10;
}
.resize-handle::after {
  content: '';
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 8px;
  height: 8px;
  border-right: 2px solid #555;
  border-bottom: 2px solid #555;
  border-radius: 0 0 3px 0;
}
</style>
