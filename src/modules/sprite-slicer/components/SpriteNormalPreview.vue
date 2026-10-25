<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import ImageCanvas from '../../../shared/components/ImageCanvas.vue'
import SegmentedControl from '../../../shared/components/SegmentedControl.vue'
import { useI18n } from '../../../shared/i18n'
import { DEFAULT_NORMAL_SETTINGS, NORMAL_RANGES, type NormalSettings } from '../../../shared/types/normal-settings'
import type { DetectedSprite } from '../interfaces/sprite-detector'
import { computeNormals } from '../core/normal/client'
import { spritePixels } from '../core/normal/source'
import { createLighting, previewLight, DEFAULT_PREVIEW_LIGHT } from '../core/normal/lighting'
import ParameterReset from '../../../shared/components/ParameterReset.vue'
import { createLatestTask } from '../../../shared/utils/latest-task'

const props = defineProps<{ sprite: DetectedSprite }>()
const emit = defineEmits<{ close: []; settings: [settings?: NormalSettings] }>()
const { t } = useI18n()
const viewport = ref<InstanceType<typeof ImageCanvas>>()
const canvas = ref<HTMLCanvasElement>()
const panel = ref(false), pinned = ref(false), temporary = ref(false), normalView = ref(false)
const busy = ref(false), error = ref(''), ready = ref(false)
const enabled = computed(() => pinned.value || temporary.value)
const settings = computed(() => props.sprite.normalSettings ?? DEFAULT_NORMAL_SETTINGS)
const visible = computed(() => ready.value && (enabled.value || normalView.value))
const mainKeys = ['normalStrength', 'shapeStrength', 'detailStrength', 'detailScale'] as const
const advancedKeys = ['shapeRadius', 'shapeSoftness', 'alphaThreshold'] as const
const lightRows = [
  { key: 'brightness', min: 0, max: 3 },
  { key: 'height', min: 0.05, max: 3 },
  { key: 'ambient', min: 0, max: 1 },
] as const
function resetParameter(key: keyof NormalSettings) {
  const next = { ...settings.value, [key]: DEFAULT_NORMAL_SETTINGS[key] }
  const isDefault = (Object.keys(DEFAULT_NORMAL_SETTINGS) as (keyof NormalSettings)[]).every(k => next[k] === DEFAULT_NORMAL_SETTINGS[k])
  emit('settings', isDefault ? undefined : next)
  void flushGeneration()
}
function resetLight<K extends keyof typeof previewLight>(key: K) {
  previewLight[key] = DEFAULT_PREVIEW_LIGHT[key]
}
let renderer: ReturnType<typeof createLighting> | undefined
let frame = 0
let lightX = props.sprite.imageData.width * 0.25, lightY = props.sprite.imageData.height * 0.25
let generatedSettings = { ...settings.value }
const bulbCursor = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="28" viewBox="0 0 24 28"><path d="M8 19v-3a7 7 0 1 1 8 0v3z" fill="#ffe494" stroke="#222" stroke-width="2"/><path d="M8 22h8m-6 3h4" stroke="#fff" stroke-width="2"/></svg>')}") 12 10, crosshair`

function draw() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    if (ready.value && visible.value) renderer?.draw(lightX, lightY, normalView.value && !enabled.value, generatedSettings.normalFormat === 'directx')
  })
}
const generation = createLatestTask<
  { source: string; sprite: DetectedSprite; settings: NormalSettings },
  { pixels: ImageData; normal: ImageData }
>({
  interval: 100, adaptive: { min: 60, max: 300 }, acceptIntermediate: true,
  onBusy: value => { busy.value = value },
  onError: e => { error.value = e instanceof Error ? e.message : String(e) },
  async run(input, signal) {
    const pixels = await spritePixels(input.sprite)
    return { pixels, normal: await computeNormals(pixels, input.settings, signal) }
  },
  apply(result, input) {
    if (props.sprite.dataUrl !== input.source) return
    if (!renderer) renderer = createLighting(canvas.value!, result.pixels)
    renderer.update(result.normal); generatedSettings = input.settings; ready.value = true; draw()
  },
})
function queueGeneration(immediate = false) {
  error.value = ''
  generation.request({ source: props.sprite.dataUrl, sprite: props.sprite, settings: { ...settings.value } }, immediate)
}
function generate() { queueGeneration(true) }
async function flushGeneration() { await nextTick(); generation.flush() }
function ensureNormal() { if (!ready.value && !busy.value) void generate() }
function toggleLight() {
  pinned.value = !pinned.value; temporary.value = false; normalView.value = false
  if (pinned.value) ensureNormal()
  draw()
}
function showNormal(value: boolean) {
  normalView.value = value; pinned.value = false; temporary.value = false
  if (value) ensureNormal()
  draw()
}
function move(event: MouseEvent) {
  if (!enabled.value || (event.buttons & 5)) return
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const view = viewport.value
  if (!view) return
  lightX = (event.clientX - rect.left - view.panX) / view.scale
  lightY = (event.clientY - rect.top - view.panY) / view.scale
  draw()
}
function down(event: MouseEvent) {
  if (event.button !== 2) return
  event.preventDefault()
  if (!pinned.value) temporary.value = true
  normalView.value = false
  move(event); ensureNormal(); draw()
}
function release(event?: MouseEvent) {
  if (!event || event.button === 2) temporary.value = false
}
function blur() { release() }
function updateNumber(key: keyof typeof NORMAL_RANGES, event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  const [min, max] = NORMAL_RANGES[key]
  if (Number.isFinite(value)) emit('settings', { ...settings.value, [key]: Math.min(max, Math.max(min, value)) })
}
function updateFlag(key: 'invertX' | 'invertY', event: Event) {
  emit('settings', { ...settings.value, [key]: (event.target as HTMLInputElement).checked })
}
function updateFormat(value: string) {
  if (value !== 'opengl' && value !== 'directx') return
  emit('settings', { ...settings.value, normalFormat: value })
  void flushGeneration()
}
watch(() => props.sprite.normalSettings, () => queueGeneration(), { deep: true, flush: 'sync' })
watch(previewLight, draw, { deep: true })
watch([enabled, normalView], draw)
watch(enabled, active => { if (active) panel.value = true })
watch(() => props.sprite.dataUrl, () => {
  generation.cancel()
  renderer?.dispose(false); renderer = undefined; ready.value = false; busy.value = false
  lightX = props.sprite.rect.w * 0.25; lightY = props.sprite.rect.h * 0.25
  if (enabled.value || normalView.value) void generate()
}, { flush: 'sync' })
onMounted(() => {
  document.addEventListener('mouseup', release)
  window.addEventListener('blur', blur)
})
onUnmounted(() => {
  generation.dispose(); cancelAnimationFrame(frame); renderer?.dispose()
  document.removeEventListener('mouseup', release); window.removeEventListener('blur', blur)
})
</script>

<template>
  <ImageCanvas ref="viewport" overlay :src="sprite.dataUrl" :image-hidden="visible" :overlay-title="sprite.name"
    :overlay-subtitle="`${sprite.rect.w} × ${sprite.rect.h} px`" :min-scale="0.5" :max-scale="32"
    :viewport-cursor="enabled ? bulbCursor : undefined"
    @close="emit('close')" @canvas-mousedown="down" @canvas-mousemove="move" @canvas-mouseleave="release()">
    <canvas ref="canvas" class="normal-canvas" :data-mode="visible ? (enabled ? 'lighting' : 'normal') : 'original'" :style="{ visibility: visible ? 'visible' : 'hidden' }" />
    <template #controls-extra>
      <span class="control-divider" />
      <button class="normal-control" :class="{ active: enabled }" :aria-pressed="enabled" :title="t('normal.lightTip')" :aria-label="t('normal.light')" @click="toggleLight">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 17v-2a7 7 0 1 1 8 0v2M8 18h8M9 21h6M12 2v1" /></svg>
      </button>
    </template>
    <template #viewport-overlay>
      <div v-if="busy || error" class="normal-status" role="status" @mousedown.stop @mousemove.stop @wheel.stop>
        <template v-if="error">{{ t('normal.failed') }}: {{ error }} <button @click="generate">{{ t('normal.retry') }}</button></template>
        <template v-else>{{ ready ? t('normal.updating') : t('normal.generating') }}</template>
      </div>
      <aside v-if="panel" class="normal-panel" :aria-label="t('normal.panel')" @mousedown.stop @mousemove.stop @wheel.stop @mouseenter="release()" @change="flushGeneration">
        <header><strong>{{ t('normal.panel') }}</strong><button :aria-label="t('normal.collapse')" @click="panel = false">−</button></header>
        <div class="view-tabs">
          <button :class="{ active: !normalView && !enabled }" @click="showNormal(false)">{{ t('normal.original') }}</button>
          <button :class="{ active: normalView }" @click="showNormal(true)">{{ t('normal.map') }}</button>
          <span v-if="enabled">{{ t('normal.lit') }}</span>
        </div>
        <h4>{{ t('normal.currentSprite') }} <small>{{ sprite.normalSettings ? t('normal.custom') : t('normal.default') }}</small></h4>
        <div v-for="key in mainKeys" :key="key" class="normal-row">
          <span>{{ t(`normal.${key}`) }}</span>
          <ParameterReset :changed="settings[key] !== DEFAULT_NORMAL_SETTINGS[key]" :label="t(`normal.${key}`)" :default-value="DEFAULT_NORMAL_SETTINGS[key]" @reset="resetParameter(key)" />
          <input type="range" :aria-label="t(`normal.${key}`)" :min="NORMAL_RANGES[key][0]" :max="NORMAL_RANGES[key][1]" step="0.05" :value="settings[key]" @input="updateNumber(key, $event)" />
          <input class="numeric" type="number" :aria-label="t(`normal.${key}`)" :min="NORMAL_RANGES[key][0]" :max="NORMAL_RANGES[key][1]" step="0.05" :value="settings[key]" @change="updateNumber(key, $event)" />
        </div>
        <details><summary>{{ t('normal.advanced') }}</summary>
          <div v-for="key in advancedKeys" :key="key" class="normal-row">
            <span>{{ t(`normal.${key}`) }}</span>
            <ParameterReset :changed="settings[key] !== DEFAULT_NORMAL_SETTINGS[key]" :label="t(`normal.${key}`)" :default-value="DEFAULT_NORMAL_SETTINGS[key]" @reset="resetParameter(key)" />
            <input type="range" :aria-label="t(`normal.${key}`)" :min="NORMAL_RANGES[key][0]" :max="NORMAL_RANGES[key][1]" :step="key === 'alphaThreshold' ? 0.01 : 0.05" :value="settings[key]" @input="updateNumber(key, $event)" />
            <input class="numeric" type="number" :aria-label="t(`normal.${key}`)" :min="NORMAL_RANGES[key][0]" :max="NORMAL_RANGES[key][1]" :step="key === 'alphaThreshold' ? 0.01 : 0.05" :value="settings[key]" @change="updateNumber(key, $event)" />
          </div>
          <div class="orientation-settings">
            <div class="property-row"><span>{{ t('normal.format') }}</span>
              <ParameterReset :changed="settings.normalFormat !== DEFAULT_NORMAL_SETTINGS.normalFormat" :label="t('normal.format')" default-value="OpenGL" @reset="resetParameter('normalFormat')" />
              <SegmentedControl role="group" :aria-label="t('normal.format')" :model-value="settings.normalFormat"
                :options="[{ value: 'opengl', label: 'OpenGL' }, { value: 'directx', label: 'DirectX' }]"
                :indicator="false" @update:model-value="updateFormat" />
            </div>
            <div class="axis-options">
              <div v-for="key in (['invertX', 'invertY'] as const)" :key="key" class="axis-option" :class="{ checked: settings[key] }">
                <label><input type="checkbox" :checked="settings[key]" @change="updateFlag(key, $event)" /><span>{{ t(`normal.${key}`) }}</span></label>
                <ParameterReset :changed="settings[key] !== DEFAULT_NORMAL_SETTINGS[key]" :label="t(`normal.${key}`)" :default-value="t('normal.off')" @reset="resetParameter(key)" />
              </div>
            </div>
          </div>
        </details>
        <h4>{{ t('normal.previewLight') }}</h4>
        <div v-for="row in lightRows" :key="row.key" class="normal-row"><span>{{ t(`normal.${row.key}`) }}</span>
          <ParameterReset :changed="previewLight[row.key] !== DEFAULT_PREVIEW_LIGHT[row.key]" :label="t(`normal.${row.key}`)" :default-value="DEFAULT_PREVIEW_LIGHT[row.key]" @reset="resetLight(row.key)" />
          <input v-model.number="previewLight[row.key]" :aria-label="t(`normal.${row.key}`)" type="range" :min="row.min" :max="row.max" step="0.05" /><output>{{ previewLight[row.key].toFixed(2) }}</output>
        </div>
        <div class="property-row"><span>{{ t('normal.color') }}</span>
          <ParameterReset :changed="previewLight.color !== DEFAULT_PREVIEW_LIGHT.color" :label="t('normal.color')" :default-value="DEFAULT_PREVIEW_LIGHT.color" @reset="resetLight('color')" />
          <label class="color-field"><input v-model="previewLight.color" :aria-label="t('normal.color')" type="color" /><span>{{ previewLight.color.toUpperCase() }}</span></label>
        </div>
        <p>{{ t('normal.hint') }}</p>
      </aside>
    </template>
  </ImageCanvas>
</template>

<style scoped>
.normal-canvas { position: absolute; top: 0; left: 0; pointer-events: none; image-rendering: pixelated; }
.control-divider { width: 1px; background: #6666; margin: 2px 3px; }
.normal-control { width: 24px; height: 22px; padding: 0; display: grid; place-items: center; background: #3c3c3c99; border: 1px solid #64646466; border-radius: 4px; color: #bbb; cursor: pointer; }
.active { color: #bcd8ff !important; border-color: #709ed4 !important; background: #304d70 !important; }
.normal-panel { position: absolute; right: 12px; top: 12px; width: min(304px, calc(100% - 24px)); max-height: calc(100% - 64px); overflow-y: auto; box-sizing: border-box; padding: 12px; background: #242424f2; border: 1px solid #555; border-radius: 8px; color: #ccc; font-size: 12px; cursor: default; box-shadow: 0 8px 24px #0005; z-index: 12; }
header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.normal-panel button:not(.parameter-reset), .normal-status button { background: #353535; color: #ccc; border: 1px solid #555; border-radius: 4px; padding: 3px 8px; cursor: pointer; }
.normal-panel button:disabled { opacity: .4; cursor: default; }
.view-tabs { display: flex; gap: 6px; align-items: center; }
.view-tabs span { color: #e8c677; margin-left: auto; font-size: 11px; }
h4 { font-size: 11px; font-weight: 500; color: #aaa; margin: 14px 0 9px; border-top: 1px solid #444; padding-top: 10px; }
h4 small { float: right; color: #8ab4f8; }
.normal-row { display: grid; grid-template-columns: 60px 22px minmax(30px, 1fr) 48px; gap: 5px; align-items: center; margin-bottom: 8px; min-height: 26px; }
.property-row { display: grid; grid-template-columns: 60px 22px minmax(0, 1fr); gap: 5px; align-items: center; min-height: 28px; }
.orientation-settings { border-top: 1px solid #444; padding-top: 10px; margin: 12px 0; }
.axis-options { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
.axis-option { display: flex; align-items: center; gap: 4px; padding: 4px 6px; background: #303030; border: 1px solid #484848; border-radius: 5px; }
.axis-option.checked { background: #30445d; border-color: #698dbd; }
.axis-option label { display: flex; align-items: center; gap: 7px; flex: 1; min-height: 24px; cursor: pointer; }
.axis-option input { margin: 0; width: 14px; height: 14px; accent-color: #8ab4f8; }
.color-field { display: flex; gap: 8px; align-items: center; padding: 3px 6px; border: 1px solid #484848; border-radius: 4px; background: #303030; cursor: pointer; }
.color-field span { font-size: 11px; color: #bbb; font-variant-numeric: tabular-nums; }
input[type=range] { width: 100%; min-width: 0; accent-color: #8ab4f8; }
.numeric { min-width: 0; width: 48px; background: #303030; color: #ddd; border: 1px solid #555; border-radius: 3px; padding: 3px; font-size: 11px; box-sizing: border-box; }
input[type=color] { width: 36px; height: 24px; padding: 0; background: none; border: 1px solid #555; }
output { text-align: right; font-variant-numeric: tabular-nums; }
summary { cursor: pointer; color: #aaa; margin: 8px 0; }
p { color: #888; font-size: 11px; line-height: 1.5; margin: 10px 0 0; }
.normal-status { position: absolute; top: 12px; left: 12px; max-width: min(360px, 50%); padding: 6px 10px; background: #222e; color: #ddd; border-radius: 5px; font-size: 12px; z-index: 11; cursor: default; }
</style>
