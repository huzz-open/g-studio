<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from '../../shared/i18n'
import SceneViewControls from './SceneViewControls.vue'
import InfoHint from '../../shared/components/InfoHint.vue'
import { createLatestTask } from '../../shared/utils/latest-task'
import { clonePart, partRenderKey, type PartAsset } from '../../shared/parts/schema'
import { partMovementLimits } from './part-geometry'
import { createSceneRenderer, sceneCamera, type ReceiverReport } from './renderer'
import { PITCH, type SceneState } from './model'
import type { Vec3 } from '../experiments/umbrella/math'

const props = withDefaults(defineProps<{ state: SceneState; assets: PartAsset[]; compact?: boolean; editable?: boolean; controls?: boolean }>(), { compact: false, editable: true, controls: true })
const emit = defineEmits<{ edit: [assetId: string]; coverage: [value: Record<string, number>] }>()
const { t } = useI18n(), canvas = ref<HTMLCanvasElement>(), ready = ref(false), busy = ref(false), error = ref('')
const assetsById = computed(() => Object.fromEntries(props.assets.map(a => [a.id, a])))
const markers = ref<{ id: string; x: number; y: number }[]>([]), lightMarker = ref({ x: -100, y: -100 }), lightFoot = ref({ x: -100, y: -100 })
const report = ref<ReceiverReport | null>(null), inspecting = ref(false)
let renderer: ReturnType<typeof createSceneRenderer> | undefined, observer: ResizeObserver | undefined, frame = 0
let dragging: { id: string; light: boolean; dx: number; dz: number; height?: {y:number;value:number} } | null = null
function name(id: string) { const item = props.state.items.find(i => i.id === id); return item ? assetsById.value[item.assetId]?.name ?? t('parts.missing') : '' }
function draw() {
  if (frame || !ready.value) return
  frame = requestAnimationFrame(() => {
    frame = 0
    if (!canvas.value || canvas.value.clientWidth < 1 || canvas.value.clientHeight < 1) return
    try {
      renderer!.render(props.state)
      markers.value = props.state.items.filter(i => i.visible).map(i => ({ id: i.id, ...renderer!.project([i.x, 0, i.z], props.state) }))
      lightMarker.value = renderer!.project(props.state.light, props.state); lightFoot.value = renderer!.project([props.state.light[0], 0, props.state.light[2]], props.state)
    } catch (e) { error.value = String(e) }
  })
}
const updates = createLatestTask<PartAsset[], void>({
  interval: 140, acceptIntermediate: true,
  onBusy: value => { busy.value = value }, onError: e => { error.value = String(e) },
  async run(parts) { await renderer!.syncAssets(parts) },
  apply() { ready.value = true; error.value = ''; emit('coverage', renderer!.coverage()); draw() },
})
function refresh() { if (renderer) { error.value = ''; updates.request(props.assets.map(clonePart), true) } }
// The editor passes a fresh [draft] array on render. Compare content, not array
// identity, so publishing coverage cannot trigger an endless reload loop.
watch(() => props.assets.map(p => p.id + ':' + partRenderKey(p)).join('\n'), () => { if (renderer) updates.request(props.assets.map(clonePart)); report.value = null })
watch(() => props.state, () => { report.value = null; draw() }, { deep: true })
function ground(event: {clientX:number;clientY:number}): Vec3 | null {
  const r = canvas.value!.getBoundingClientRect()
  return sceneCamera(props.state, r.width / r.height).pickGround((event.clientX - r.left) / r.width * 2 - 1, 1 - (event.clientY - r.top) / r.height * 2)
}
function dropPoint(clientX:number,clientY:number) {
  const r=canvas.value?.getBoundingClientRect()
  if(!r||clientX<r.left||clientX>r.right||clientY<r.top||clientY>r.bottom)return null
  const point=ground({clientX,clientY});return point?{x:point[0],z:point[2]}:null
}
defineExpose({dropPoint})
function startHeight(event:PointerEvent){
  if(event.button!==0||!ready.value)return
  event.preventDefault();props.state.tool='light'
  ;(event.currentTarget as HTMLElement).focus({preventScroll:true})
  dragging={id:'',light:true,dx:0,dz:0,height:{y:event.clientY,value:props.state.light[1]}}
  canvas.value!.setPointerCapture(event.pointerId)
}
function heightKey(event:KeyboardEvent){
  if(event.key!=='ArrowUp'&&event.key!=='ArrowDown')return
  event.preventDefault()
  props.state.light[1]=Math.max(.5,Math.min(8,props.state.light[1]+(event.key==='ArrowUp'?.1:-.1)))
}
function start(event: PointerEvent, explicit?: string, isLight = false) {
  if (event.button !== 0 || !ready.value) return
  event.preventDefault()
  const r = canvas.value!.getBoundingClientRect(), light = isLight
  const id = light ? '' : explicit ?? renderer!.pick(event.clientX - r.left, event.clientY - r.top, props.state)
  if (!light && !id) return
  const point = ground(event); if (!point) return
  const item = props.state.items.find(i => i.id === id)
  if (item) props.state.selected = item.id
  props.state.tool=light?'light':'objects'
  const x = light ? props.state.light[0] : item!.x, z = light ? props.state.light[2] : item!.z
  dragging = { id: id ?? '', light, dx: light && !isLight ? 0 : x - point[0], dz: light && !isLight ? 0 : z - point[2] }
  canvas.value!.setPointerCapture(event.pointerId)
  if(!light)canvas.value!.focus({ preventScroll: true })
  else (event.currentTarget as HTMLElement).focus({preventScroll:true})
}
function move(event: PointerEvent) {
  if (!dragging) return
  if(dragging.height){
    const pixelsPerUnit=canvas.value!.clientHeight/(props.state.zoom*.8)*Math.cos(PITCH*Math.PI/180)
    props.state.light[1]=Math.round(Math.max(.5,Math.min(8,dragging.height.value-(event.clientY-dragging.height.y)/pixelsPerUnit))*100)/100
    return
  }
  const point = ground(event); if (!point) return
  const round = (v: number) => Math.round(v * 100) / 100
  if (dragging.light) { props.state.light[0] = Math.max(-5, Math.min(5, round(point[0] + dragging.dx))); props.state.light[2] = Math.max(-3.5, Math.min(5, round(point[2] + dragging.dz))) }
  else {
    const item = props.state.items.find(i => i.id === dragging!.id); if (!item) return
    const b = partMovementLimits(assetsById.value[item.assetId], item.scale)
    item.x = Math.max(b.minX, Math.min(b.maxX, round(point[0] + dragging.dx))); item.z = Math.max(b.minZ, Math.min(b.maxZ, round(point[2] + dragging.dz)))
  }
}
function edit(event: MouseEvent) {
  if (!props.editable || !ready.value) return
  const r = canvas.value!.getBoundingClientRect(), id = renderer!.pick(event.clientX - r.left, event.clientY - r.top, props.state)
  const item = props.state.items.find(i => i.id === id); if (item) emit('edit', item.assetId)
}
function key(event: KeyboardEvent, light = false) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault()
  const n = event.shiftKey ? .5 : .1, dx = event.key === 'ArrowLeft' ? -n : event.key === 'ArrowRight' ? n : 0, dz = event.key === 'ArrowUp' ? -n : event.key === 'ArrowDown' ? n : 0
  if (light) { props.state.light[0] = Math.max(-5, Math.min(5, props.state.light[0] + dx)); props.state.light[2] = Math.max(-3.5, Math.min(5, props.state.light[2] + dz)) }
  else { const item = props.state.items.find(i => i.id === props.state.selected); if (item) { const b = partMovementLimits(assetsById.value[item.assetId], item.scale); item.x = Math.max(b.minX, Math.min(b.maxX, item.x + dx)); item.z = Math.max(b.minZ, Math.min(b.maxZ, item.z + dz)) } }
}
async function inspect() {
  inspecting.value = true; await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  try { if (renderer) report.value = renderer.inspect(props.state) } catch (e) { error.value = String(e) } finally { inspecting.value = false }
}
onMounted(() => { try { renderer = createSceneRenderer(canvas.value!); observer = new ResizeObserver(draw); observer.observe(canvas.value!); refresh() } catch (e) { error.value = String(e) } })
onUnmounted(() => { updates.dispose(); observer?.disconnect(); cancelAnimationFrame(frame); renderer?.dispose(); renderer = undefined })
</script>

<template>
  <div class="lighting-viewport" :class="{compact}">
    <div v-if="controls" class="viewport-toolbar">
      <SceneViewControls :state="state"/>
      <span class="camera-angle" :title="t('sceneLight.fixed')">20°</span><slot name="actions"/><InfoHint :label="t('parts.previewHelp')" :text="t('parts.previewHelpText')"/>
    </div>
    <div class="viewport-stage">
      <canvas ref="canvas" tabindex="0" :aria-label="t('sceneLight.canvas')" @pointerdown="start($event)" @pointermove="move" @pointerup="dragging=null" @pointercancel="dragging=null" @lostpointercapture="dragging=null" @dblclick="edit" @keydown="key" @contextmenu.prevent @wheel.prevent="state.zoom=Math.max(4,Math.min(20,state.zoom*($event.deltaY>0?1.06:1/1.06)))" />
      <div v-if="busy" class="viewport-status" role="status">{{ t('common.updating') }}</div>
      <div v-if="error" class="viewport-error" role="alert">{{ error }} <button @click="refresh">{{ t('normal.retry') }}</button></div>
      <template v-if="ready&&!error">
        <svg class="light-guide" aria-hidden="true"><line :x1="lightFoot.x" :y1="lightFoot.y" :x2="lightMarker.x" :y2="lightMarker.y"/><circle :cx="lightFoot.x" :cy="lightFoot.y" r="5"/></svg>
        <button class="light-handle" :title="t('sceneLight.dragHeight')" :style="{left:lightMarker.x+'px',top:lightMarker.y+'px'}" :aria-label="t('sceneLight.dragHeight')" @pointerdown.stop="startHeight" @keydown="heightKey">☀</button>
        <button class="light-position" :style="{left:lightFoot.x+'px',top:lightFoot.y+'px'}" :aria-label="t('sceneLight.dragPosition')" :title="t('sceneLight.dragPosition')" @pointerdown.stop="start($event,undefined,true)" @keydown="key($event,true)">✥</button>
        <span v-for="m in markers.filter(m=>m.id===state.selected)" :key="'ring'+m.id" class="selection-ring" :style="{left:m.x+'px',top:m.y+'px'}"/>
        <button v-for="m in state.showNames===false?[]:markers" :key="m.id" class="object-marker" :data-instance-id="m.id" :data-asset-id="state.items.find(i=>i.id===m.id)?.assetId" :class="{active:m.id===state.selected}" :style="{left:m.x+'px',top:m.y+'px'}" @pointerdown.stop="start($event,m.id)" @dblclick.stop="editable&&emit('edit',state.items.find(i=>i.id===m.id)!.assetId)">{{ name(m.id) }}</button>
      </template>
    </div>
    <details v-if="!compact" class="shadow-inspector"><summary>{{t('parts.shadowInspector')}}</summary>
      <div class="receiver-strip"><button :disabled="!ready||busy||inspecting" @click="inspect">{{ t(inspecting?'sceneLight.checking':'sceneLight.inspect') }}</button><InfoHint :label="t('parts.shadowInspector')" :text="t('sceneLight.sampleNote')"/></div>
      <div v-if="report" class="receiver-report" role="status"><span>{{ t('sceneLight.groundHits',{count:report.ground}) }}</span><span>{{ t('sceneLight.wallHits',{count:report.walls}) }}</span><span v-for="i in report.objects" :key="i.id">{{ name(i.id) }} {{ i.shadows }}</span></div>
    </details>
  </div>
</template>

<style scoped>
.camera-angle{font-size:10px;color:#89958e;margin-left:auto}.shadow-inspector{background:#1e2221;border-top:1px solid #333;font-size:10px;color:#888}.shadow-inspector>summary{padding:5px 10px;cursor:pointer}.shadow-inspector .receiver-strip{border:0;padding:5px 10px;justify-content:flex-start}
.lighting-viewport{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;background:#171a1c;color:#d4d8d8}.viewport-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid #383d3d;background:#252a2a}.viewport-toolbar strong{margin-right:auto;color:#d5e7d9;font-size:16px}.viewport-toolbar small{font-size:10px;font-weight:400;color:#a0aaa7}.viewport-stage{position:relative;flex:1;min-height:220px;overflow:hidden}.viewport-stage canvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab;outline:none}.viewport-stage canvas:focus-visible{outline:2px solid #93b2a1;outline-offset:-2px}button{font:inherit;color:inherit;cursor:pointer}.viewport-status,.viewport-error{position:absolute;top:10px;left:10px;padding:7px 10px;background:#25342de8;border-radius:5px;font-size:12px}.viewport-error{right:10px;color:#ffd1c6;background:#422a29}.light-guide{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.light-guide line{stroke:#d4b35c;stroke-dasharray:4 5;opacity:.55}.light-guide circle{fill:none;stroke:#e1bd64;stroke-width:1.5}.light-position{position:absolute;transform:translate(-50%,-50%);width:26px;height:26px;border:1px solid #dfbb6c;border-radius:50%;background:#3c3322;color:#ffe4a1;touch-action:none;cursor:move;font-size:21px;line-height:1;padding:0}.selection-ring{position:absolute;transform:translate(-50%,-50%);width:42px;height:14px;border:1px solid #bfd4ad;border-radius:50%;pointer-events:none;box-shadow:0 0 4px #a8cfa355}.light-handle{position:absolute;transform:translate(-50%,-50%);width:31px;height:31px;border:1px solid #dfbb6c;border-radius:50%;background:#3c3322;color:#ffe4a1;font-size:23px;line-height:1;touch-action:none;cursor:ns-resize}.object-marker{position:absolute;transform:translate(-50%,8px);padding:3px 7px;border:1px solid #6b78715e;border-radius:4px;background:#17201dcc;color:#bdc7bf;font-size:10px;white-space:nowrap;touch-action:none;cursor:grab}.object-marker.active{color:#e4efce;border-color:#b8ce92;background:#384735e6}.viewport-caption{position:absolute;bottom:10px;left:12px;font-size:10px;color:#a2afa7;background:#17201dd9;padding:5px 8px;pointer-events:none}.receiver-strip{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-top:1px solid #383d3d;font-size:11px;gap:10px;background:#222929}.receiver-strip button,.viewport-error button{border:1px solid #48514e;border-radius:4px;padding:6px;background:#2a3230}.receiver-strip button:disabled{opacity:.4}.receiver-report{display:flex;gap:7px 14px;flex-wrap:wrap;padding:9px 12px;background:#293630;font-size:11px;color:#d3e1d5}.receiver-report small{width:100%;color:#9fb1a4}.compact .viewport-toolbar strong small{display:none}.compact .viewport-caption{font-size:9px;max-width:80%}
</style>
