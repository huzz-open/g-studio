<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import SidebarSection from '../../shared/components/editor-shell/SidebarSection.vue'
import { SliderRow, ActionButtons } from '../../shared/components/editor-shell/sidebar-atoms'
import SegmentedControl from '../../shared/components/SegmentedControl.vue'
import InlineSwitch from '../../shared/components/InlineSwitch.vue'
import { useI18n } from '../../shared/i18n'
import { DEFAULT_SHAPE } from './umbrella/model'
import { camera, type CameraSettings, type Vec3 } from './umbrella/math'
import { createUmbrellaRenderer, type DemoFrame } from './umbrella/renderer'

const { t } = useI18n()
const canvas = ref<HTMLCanvasElement>(), error = ref('')
const shape = reactive({ ...DEFAULT_SHAPE })
const lightDefaults = { height: 5, azimuth: 140, radius: 2.5 }
const cameraDefaults: CameraSettings = { yaw: 25, pitch: 30, distance: 8.5, projection: 'orthographic' }
const light = reactive({ ...lightDefaults }), view = reactive({ ...cameraDefaults })
const wireframe = ref(false), shadowsOnly = ref(false), filtered = ref(true)
const lightPosition = computed<Vec3>(() => {
  const angle = light.azimuth * Math.PI / 180
  return [light.radius * Math.cos(angle), light.height, light.radius * Math.sin(angle)]
})
let renderer: ReturnType<typeof createUmbrellaRenderer> | undefined
let observer: ResizeObserver | undefined, frameId = 0, shapeDirty = false
let drag: 'light' | 'camera' | null = null, previousX = 0, previousY = 0
function frame(): DemoFrame {
  return { light: [...lightPosition.value], camera: { ...view }, wireframe: wireframe.value, shadowsOnly: shadowsOnly.value, filtered: filtered.value }
}
function draw() {
  if (frameId) return
  frameId = requestAnimationFrame(() => {
    frameId = 0
    try {
      if (shapeDirty) { renderer?.setShape({ ...shape }); shapeDirty = false }
      renderer?.render(frame())
    } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
  })
}
function reset() {
  Object.assign(shape, DEFAULT_SHAPE); Object.assign(light, lightDefaults); Object.assign(view, cameraDefaults)
  wireframe.value = false; shadowsOnly.value = false; filtered.value = true
}
function setProjection(value: string) { if (value === 'orthographic' || value === 'perspective') view.projection = value }
function moveLight(event: PointerEvent) {
  const rect = canvas.value!.getBoundingClientRect()
  const point = camera(view, rect.width / rect.height).pickGround((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2)
  if (!point) return
  const distance = Math.hypot(point[0], point[2])
  light.radius = Math.min(4.8, Math.round(distance * 100) / 100)
  if (distance > 0.001) light.azimuth = (Math.atan2(point[2], point[0]) * 180 / Math.PI + 360) % 360
}
function pointerDown(event: PointerEvent) {
  if (event.button !== 0 && event.button !== 2) return
  event.preventDefault(); canvas.value!.setPointerCapture(event.pointerId)
  drag = event.button === 2 ? 'camera' : 'light'; previousX = event.clientX; previousY = event.clientY
  if (drag === 'light') moveLight(event)
}
function pointerMove(event: PointerEvent) {
  if (drag === 'light') moveLight(event)
  if (drag === 'camera') {
    view.yaw = ((view.yaw + (event.clientX - previousX) * 0.4 + 540) % 360) - 180
    view.pitch = Math.max(10, Math.min(80, view.pitch + (event.clientY - previousY) * 0.3))
  }
  previousX = event.clientX; previousY = event.clientY
}
function endDrag() { drag = null }
function wheel(event: WheelEvent) { view.distance = Math.max(4, Math.min(12, view.distance * (event.deltaY > 0 ? 1.08 : 1 / 1.08))) }
watch(shape, () => { shapeDirty = true; draw() }, { deep: true })
watch([light, view, wireframe, shadowsOnly, filtered], draw, { deep: true })
onMounted(() => {
  try {
    renderer = createUmbrellaRenderer(canvas.value!, shape)
    observer = new ResizeObserver(draw); observer.observe(canvas.value!)
    draw()
  } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
})
onUnmounted(() => { observer?.disconnect(); cancelAnimationFrame(frameId); renderer?.dispose() })
defineExpose({
  getState: () => ({ shape: { ...shape }, frame: frame() }),
  probeShadow: (points: Vec3[], normals?: Vec3[]) => { if (shapeDirty) { renderer?.setShape({ ...shape }); shapeDirty = false }; renderer?.render(frame()); return renderer?.probeShadow(points, normals) },
})
</script>

<template>
  <div class="umbrella-demo">
    <aside class="demo-sidebar">
      <div class="demo-heading"><h2>{{ t('umbrella.title') }}</h2><p>{{ t('umbrella.assumption') }}</p></div>
      <SidebarSection :title="t('umbrella.light')" :collapsible="false">
        <SliderRow v-model="light.height" :default-value="lightDefaults.height" :label="t('umbrella.lightHeight')" :min="0.5" :max="8" :step="0.1" :precision="1" />
        <SliderRow v-model="light.azimuth" :default-value="lightDefaults.azimuth" :label="t('umbrella.azimuth')" :min="0" :max="360" :step="1" :precision="0" suffix="°" />
        <SliderRow v-model="light.radius" :default-value="lightDefaults.radius" :label="t('umbrella.distance')" :min="0" :max="4.8" :step="0.01" :precision="2" />
      </SidebarSection>
      <SidebarSection :title="t('umbrella.camera')" :collapsible="false">
        <SegmentedControl :label="t('umbrella.projection')" :model-value="view.projection" :options="[{ value: 'orthographic', label: t('umbrella.orthographic') }, { value: 'perspective', label: t('umbrella.perspective') }]" role="group" :aria-label="t('umbrella.projection')" @update:model-value="setProjection" />
        <SliderRow v-model="view.pitch" :default-value="cameraDefaults.pitch" :label="t('umbrella.pitch')" :min="10" :max="80" :step="1" :precision="0" suffix="°" />
        <SliderRow v-model="view.yaw" :default-value="cameraDefaults.yaw" :label="t('umbrella.yaw')" :min="-180" :max="180" :step="1" :precision="0" suffix="°" />
        <SliderRow v-model="view.distance" :default-value="cameraDefaults.distance" :label="t('umbrella.cameraDistance')" :min="4" :max="12" :step="0.1" :precision="1" />
      </SidebarSection>
      <SidebarSection :title="t('umbrella.model')">
        <SliderRow v-model="shape.rimHeight" :default-value="DEFAULT_SHAPE.rimHeight" :label="t('umbrella.rimHeight')" :min="1" :max="3.2" :step="0.05" :precision="2" />
        <SliderRow v-model="shape.radius" :default-value="DEFAULT_SHAPE.radius" :label="t('umbrella.radius')" :min="0.5" :max="1.8" :step="0.05" :precision="2" />
        <SliderRow v-model="shape.rise" :default-value="DEFAULT_SHAPE.rise" :label="t('umbrella.rise')" :min="0.15" :max="1" :step="0.05" :precision="2" />
        <InlineSwitch v-model="wireframe" :label="t('umbrella.wireframe')" block />
      </SidebarSection>
      <SidebarSection :title="t('umbrella.display')" :collapsible="false">
        <InlineSwitch v-model="shadowsOnly" :label="t('umbrella.shadowsOnly')" block />
        <InlineSwitch v-model="filtered" :label="t('umbrella.filtered')" :tooltip="t('umbrella.filteredTip')" block />
        <ActionButtons :buttons="[{ id: 'reset', label: t('umbrella.reset') }]" @click="reset" />
      </SidebarSection>
      <p class="demo-note">{{ t('umbrella.method') }}</p>
    </aside>
    <main class="demo-scene">
      <canvas ref="canvas" :aria-label="t('umbrella.title')" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag" @contextmenu.prevent @wheel.prevent="wheel" />
      <div v-if="error" class="demo-error" role="alert">{{ error }}</div>
      <div class="scene-caption"><span>{{ t('umbrella.controls') }}</span><span>{{ t('umbrella.scaleNote') }}</span></div>
    </main>
  </div>
</template>

<style scoped>
.umbrella-demo { display: flex; flex: 1; min-height: 0; height: 100%; overflow: hidden; color: #ccc; }
.demo-sidebar { flex: 0 0 300px; overflow-y: auto; background: #202020; border-right: 1px solid #383838; }
.demo-heading { padding: 14px 10px 10px; border-bottom: 1px solid #333; }
h2 { margin: 0 0 8px; font-size: 15px; color: #eee; font-weight: 600; }
p { margin: 0; font-size: 11px; color: #999; line-height: 1.6; }
.demo-note { padding: 10px; }
.demo-scene { position: relative; flex: 1; min-width: 0; min-height: 0; background: #14171c; }
canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
.scene-caption { position: absolute; left: 14px; right: 14px; bottom: 12px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px 20px; font-size: 11px; color: #b6bcc4; pointer-events: none; }
.scene-caption span { background: #171a20dd; padding: 5px 8px; border-radius: 4px; }
.demo-error { position: absolute; top: 16px; left: 16px; right: 16px; padding: 10px; background: #422; color: #fcc; border-radius: 4px; }
@media (max-width: 760px) { .demo-sidebar { flex-basis: 250px; } }
</style>
