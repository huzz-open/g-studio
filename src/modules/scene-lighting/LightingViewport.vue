<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from '../../shared/i18n'
import SceneViewControls from './SceneViewControls.vue'
import { sunSphereFrame, sunSphereGrid, spherePoint, pickSunSphere, pickSunAzimuth, wrapAzimuth, type SunSphere, type SunSpherePath } from './direction-control'
import InfoHint from '../../shared/components/InfoHint.vue'
import { createLatestTask } from '../../shared/utils/latest-task'
import { clonePart, partRenderKey, type PartAsset } from '../../shared/parts/schema'
import { partMovementLimits } from './part-geometry'
import { createSceneRenderer, sceneCamera } from './renderer'
import { PITCH, roomBounds, type SceneState } from './model'
import { sunAnchor, sunDirection } from './lighting-math'
import type { Vec3 } from '../experiments/umbrella/math'

const props = withDefaults(defineProps<{ state: SceneState; assets: PartAsset[]; compact?: boolean; editable?: boolean; controls?: boolean; showShadowPoints?: boolean }>(), { compact: false, editable: true, controls: true, showShadowPoints: false })
const emit = defineEmits<{ edit: [assetId: string]; coverage: [value: Record<string, number>] }>()
const { t } = useI18n(), canvas = ref<HTMLCanvasElement>(), ready = ref(false), busy = ref(false), error = ref('')
const assetsById = computed(() => Object.fromEntries(props.assets.map(a => [a.id, a])))
const markers = ref<{ id: string; x: number; y: number }[]>([]), lightMarker = ref({ x: -100, y: -100 }), lightFoot = ref({ x: -100, y: -100 })
const roomHandles=ref<{axis:'width'|'depth'|'height';x:number;y:number}[]>([]),originMarker=ref({x:0,y:0})
const directional=computed(()=>props.state.lightKind==='directional')
const sunFrame=ref<SunSphere>({x:0,y:0,radius:1}),sunPaths=ref<SunSpherePath[]>([]),azimuthMarker=ref({x:0,y:0})
const activePower=computed(()=>directional.value?props.state.sun.intensity:props.state.power)
let renderer: ReturnType<typeof createSceneRenderer> | undefined, observer: ResizeObserver | undefined, frame = 0
let dragging: { id: string; light: boolean; dx: number; dz: number; height?: {y:number;value:number};sphere?:{frame:SunSphere;offsetX:number;offsetY:number;orbit:boolean};resize?:{axis:'width'|'depth'|'height';x:number;y:number;value:number;vx:number;vy:number} } | null = null
function name(id: string) { const item = props.state.items.find(i => i.id === id); return item ? assetsById.value[item.assetId]?.name ?? t('parts.missing') : '' }
function draw() {
  if (frame || !ready.value) return
  frame = requestAnimationFrame(() => {
    frame = 0
    if (!canvas.value || canvas.value.clientWidth < 1 || canvas.value.clientHeight < 1) return
    try {
      renderer!.render(props.state, props.showShadowPoints)
      markers.value = props.state.items.filter(i => i.visible).map(i => ({ id: i.id, ...renderer!.project([i.x, 0, i.z], props.state) }))
      const anchor=directional.value?sunAnchor(props.state):[props.state.light[0],0,props.state.light[2]] as Vec3
      lightFoot.value=renderer!.project(anchor,props.state)
      if(directional.value){
        const frame=sunSphereFrame(canvas.value.clientWidth,canvas.value.clientHeight)
        sunFrame.value=frame;lightFoot.value={x:frame.x,y:frame.y};lightMarker.value=spherePoint(sunDirection(props.state),frame)
        const az=props.state.sun.azimuth*Math.PI/180
        azimuthMarker.value=spherePoint([Math.sin(az),0,Math.cos(az)],frame)
        sunPaths.value=sunSphereGrid(frame,props.state.sun.azimuth)
      }else lightMarker.value=renderer!.project(props.state.light,props.state)
      const b=roomBounds(props.state.room)
      originMarker.value=renderer!.project([b.minX,0,b.minZ],props.state)
      roomHandles.value=[{axis:'width' as const,p:[b.maxX,0,b.minZ+props.state.room.depth*.6] as Vec3},{axis:'depth' as const,p:[b.minX+props.state.room.width*.6,0,b.maxZ] as Vec3},...(props.state.scene==='corner'?[{axis:'height' as const,p:[(b.minX+b.maxX)/2,b.height,b.minZ] as Vec3}]:[])].map(h=>({axis:h.axis,...renderer!.project(h.p,props.state)}))
    } catch (e) { error.value = String(e) }
  })
}
const assetKey=(parts:PartAsset[])=>parts.map(p=>p.id+':'+partRenderKey(p)).join('\n')
const updates = createLatestTask<PartAsset[], boolean>({
  interval: 140,
  onBusy: value => { busy.value = value }, onError: e => { error.value = String(e) },
  async run(parts) { const key=assetKey(parts); return renderer!.syncAssets(parts,()=>assetKey(props.assets)===key) },
  apply(committed) { if(!committed)return; ready.value = true; error.value = ''; emit('coverage', renderer!.coverage()); draw() },
})
function refresh() { if (renderer) { error.value = ''; updates.request(props.assets.map(clonePart), true) } }
// The editor passes a fresh [draft] array on render. Compare content, not array
// identity, so publishing coverage cannot trigger an endless reload loop.
watch(() => assetKey(props.assets), () => { if (renderer) updates.request(props.assets.map(clonePart)) })
watch(() => props.state, draw, { deep: true })
watch(() => props.showShadowPoints, draw)
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
  if(directional.value){startSun(event,false);return}
  dragging={id:'',light:true,dx:0,dz:0,height:{y:event.clientY,value:props.state.light[1]}}
  canvas.value!.setPointerCapture(event.pointerId)
}
function startSun(event:PointerEvent,orbit:boolean){
  if(event.button!==0||!ready.value)return
  event.preventDefault();props.state.tool='light';(event.currentTarget as HTMLElement).focus({preventScroll:true})
  const r=canvas.value!.getBoundingClientRect(),marker=orbit?azimuthMarker.value:lightMarker.value
  dragging={id:'',light:true,dx:0,dz:0,sphere:{frame:{...sunFrame.value},offsetX:event.clientX-r.left-marker.x,offsetY:event.clientY-r.top-marker.y,orbit}}
  canvas.value!.setPointerCapture(event.pointerId)
}
function positionStart(event:PointerEvent){if(directional.value)startSun(event,true);else start(event,undefined,true)}
function positionKey(event:KeyboardEvent){
  if(!directional.value){key(event,true);return}
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return
  event.preventDefault();props.state.sun.azimuth=wrapAzimuth(props.state.sun.azimuth+(event.key==='ArrowLeft'||event.key==='ArrowDown'?-1:1)*(event.shiftKey?.2:2))
}
function heightKey(event:KeyboardEvent){
  if(['+','=','-','_'].includes(event.key)){event.preventDefault();changePower(event.key==='-'||event.key==='_'?-1:1);return}
  if(directional.value){
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return
    event.preventDefault();const step=event.shiftKey?.2:2
    if(event.key==='ArrowLeft'||event.key==='ArrowRight')props.state.sun.azimuth=wrapAzimuth(props.state.sun.azimuth+(event.key==='ArrowLeft'?-step:step))
    else props.state.sun.elevation=Math.max(5,Math.min(85,props.state.sun.elevation+(event.key==='ArrowUp'?step:-step)))
    return
  }
  if(event.key!=='ArrowUp'&&event.key!=='ArrowDown')return
  event.preventDefault()
  props.state.light[1]=Math.max(.5,Math.min(12,props.state.light[1]+(event.key==='ArrowUp'?.1:-.1)))
}
function changePower(direction:number){
  if(directional.value)props.state.sun.intensity=Math.round(Math.max(0,Math.min(4,props.state.sun.intensity+direction*.05))*100)/100
  else props.state.power=Math.max(0,Math.min(60,props.state.power+direction))
}
function resizeRoom(event:PointerEvent,axis:'width'|'depth'|'height'){
  if(event.button!==0||!ready.value)return
  event.preventDefault();(event.currentTarget as HTMLElement).focus({preventScroll:true})
  const a=renderer!.project([0,0,0],props.state),unit:Vec3=axis==='width'?[1,0,0]:axis==='depth'?[0,0,1]:[0,1,0],b=renderer!.project(unit,props.state)
  dragging={id:'',light:false,dx:0,dz:0,resize:{axis,x:event.clientX,y:event.clientY,value:props.state.room[axis],vx:b.x-a.x,vy:b.y-a.y}}
  canvas.value!.setPointerCapture(event.pointerId)
}
function roomKey(event:KeyboardEvent,axis:'width'|'depth'|'height'){
  if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))return
  event.preventDefault();const d=event.key==='ArrowUp'||event.key==='ArrowRight'?.1:-.1
  props.state.room[axis]=Math.round(Math.max(axis==='height'?.5:2,Math.min(axis==='height'?12:24,props.state.room[axis]+d))*10)/10
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
  if(dragging.sphere){
    const r=canvas.value!.getBoundingClientRect(),g=dragging.sphere,x=event.clientX-r.left-g.offsetX,y=event.clientY-r.top-g.offsetY
    if(g.orbit)props.state.sun.azimuth=pickSunAzimuth(x,y,g.frame,props.state.sun.azimuth)
    else Object.assign(props.state.sun,pickSunSphere(x,y,g.frame,sunDirection(props.state)))
    return
  }
  if(dragging.resize){const r=dragging.resize,delta=((event.clientX-r.x)*r.vx+(event.clientY-r.y)*r.vy)/(r.vx*r.vx+r.vy*r.vy);props.state.room[r.axis]=Math.round(Math.max(r.axis==='height'?.5:2,Math.min(r.axis==='height'?12:24,r.value+delta))*10)/10;return}
  if(dragging.height){
    const pixelsPerUnit=canvas.value!.clientHeight/(props.state.zoom*.8)*Math.cos(PITCH*Math.PI/180)
    props.state.light[1]=Math.round(Math.max(.5,Math.min(12,dragging.height.value-(event.clientY-dragging.height.y)/pixelsPerUnit))*100)/100
    return
  }
  const point = ground(event); if (!point) return
  const round = (v: number) => Math.round(v * 100) / 100
  if (dragging.light) {const b=roomBounds(props.state.room); props.state.light[0] = Math.max(b.minX, Math.min(b.maxX, round(point[0] + dragging.dx))); props.state.light[2] = Math.max(b.minZ, Math.min(b.maxZ, round(point[2] + dragging.dz))) }
  else {
    const item = props.state.items.find(i => i.id === dragging!.id); if (!item) return
    const b = partMovementLimits(assetsById.value[item.assetId], item.scale,props.state.room)
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
  if (light) {const b=roomBounds(props.state.room); props.state.light[0] = Math.max(b.minX, Math.min(b.maxX, props.state.light[0] + dx)); props.state.light[2] = Math.max(b.minZ, Math.min(b.maxZ, props.state.light[2] + dz)) }
  else { const item = props.state.items.find(i => i.id === props.state.selected); if (item) { const b = partMovementLimits(assetsById.value[item.assetId], item.scale,props.state.room); item.x = Math.max(b.minX, Math.min(b.maxX, item.x + dx)); item.z = Math.max(b.minZ, Math.min(b.maxZ, item.z + dz)) } }
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
    <div class="viewport-stage" :aria-busy="busy">
      <canvas ref="canvas" tabindex="0" :aria-label="t('sceneLight.canvas')" @pointerdown="start($event)" @pointermove="move" @pointerup="dragging=null" @pointercancel="dragging=null" @lostpointercapture="dragging=null" @dblclick="edit" @keydown="key" @contextmenu.prevent @wheel.prevent="!dragging && (state.zoom=Math.max(4,Math.min(40,state.zoom*($event.deltaY>0?1.06:1/1.06))))" />
      <div v-if="busy&&!ready" class="viewport-status" role="status">{{ t('common.updating') }}</div>
      <div v-if="error" class="viewport-error" role="alert">{{ error }} <button @click="refresh">{{ t('normal.retry') }}</button></div>
      <template v-if="ready&&!error">
        <svg class="light-guide" aria-hidden="true"><line :x1="lightFoot.x" :y1="lightFoot.y" :x2="lightMarker.x" :y2="lightMarker.y"/><template v-if="directional"><line v-for="offset in [-6,6]" :key="offset" :x1="lightFoot.x+offset" :y1="lightFoot.y" :x2="lightMarker.x+offset" :y2="lightMarker.y" class="parallel-ray"/></template><circle v-else :cx="lightFoot.x" :cy="lightFoot.y" r="5"/></svg>
        <svg v-if="directional" class="sun-sphere" aria-hidden="true"><path v-for="(path,i) in sunPaths" :key="i" :d="path.d" :class="path.kind"/></svg>
        <button class="light-handle" :class="{directional}" :style="{left:lightMarker.x+'px',top:lightMarker.y+'px'}" :aria-label="t(directional?'sceneLight.dragDirection':'sceneLight.dragHeight')" :title="t(directional?'sceneLight.sphereDrag':'sceneLight.dragHeight')+' · '+t('sceneLight.powerShortcut')" @pointerdown.stop="startHeight" @keydown="heightKey" @wheel.stop.prevent="changePower($event.deltaY<0?1:-1)">
          <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>
          <span class="power-hint">{{t('sceneLight.power')}} {{directional?activePower.toFixed(2):activePower}}</span>
        </button>
        <button class="light-position" :style="{left:(directional?azimuthMarker.x:lightFoot.x)+'px',top:(directional?azimuthMarker.y:lightFoot.y)+'px'}" :aria-label="t(directional?'sceneLight.orbitSun':'sceneLight.dragPosition')" :title="t(directional?'sceneLight.orbitSun':'sceneLight.dragPosition')" @pointerdown.stop="positionStart" @keydown="positionKey"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4M18 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <template v-if="!compact">
          <span class="origin-marker" :style="{left:originMarker.x+'px',top:originMarker.y+'px'}" :title="t('sceneLight.cornerOrigin')">0, 0, 0</span>
          <button v-for="handle in roomHandles" :key="handle.axis" class="room-handle" :style="{left:handle.x+'px',top:handle.y+'px'}" :title="t('sceneLight.resizeRoom')" :aria-label="t(handle.axis==='width'?'sceneLight.roomWidth':handle.axis==='depth'?'sceneLight.roomDepth':'sceneLight.wallHeight')" @pointerdown.stop="resizeRoom($event,handle.axis)" @keydown="roomKey($event,handle.axis)">{{handle.axis==='width'?'X':handle.axis==='depth'?'Z':'Y'}}</button>
        </template>
        <span v-for="m in markers.filter(m=>m.id===state.selected)" :key="'ring'+m.id" class="selection-ring" :style="{left:m.x+'px',top:m.y+'px'}"/>
        <button v-for="m in state.showNames===false?[]:markers" :key="m.id" class="object-marker" :data-instance-id="m.id" :data-asset-id="state.items.find(i=>i.id===m.id)?.assetId" :class="{active:m.id===state.selected}" :style="{left:m.x+'px',top:m.y+'px'}" @pointerdown.stop="start($event,m.id)" @dblclick.stop="editable&&emit('edit',state.items.find(i=>i.id===m.id)!.assetId)">{{ name(m.id) }}</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.sun-sphere{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.sun-sphere path{fill:none;stroke:#d0d9df;stroke-width:1.5;opacity:.72;filter:drop-shadow(0 1px 1px #000b)}.sun-sphere .meridian{stroke-dasharray:4 3}.sun-sphere .latitude{stroke-width:1.6}.sun-sphere .equator{stroke:#edcd86;stroke-width:2.2;opacity:.95}.sun-sphere .direction{stroke:#ffda85;stroke-width:2.4;stroke-dasharray:none;opacity:1}.viewport-stage .light-handle.directional{cursor:grab}.viewport-stage .light-handle.directional:active{cursor:grabbing}.viewport-stage .light-handle,.viewport-stage .light-position{display:grid;place-items:center;box-sizing:border-box;padding:0}.light-handle svg,.light-position svg{display:block;pointer-events:none}.power-hint{display:none;position:absolute;top:36px;left:50%;transform:translateX(-50%);font-size:10px;line-height:1.4;white-space:nowrap;background:#2e2b20e8;border:1px solid #8c7443;border-radius:3px;padding:3px 5px;pointer-events:none}.light-handle:hover .power-hint,.light-handle:focus-visible .power-hint{display:block}.viewport-stage .room-handle{position:absolute;transform:translate(-50%,-50%);width:23px;height:23px;display:grid;place-items:center;padding:0;border:1px solid #9ab8c3;border-radius:4px;background:#24343ddd;color:#cce8f2;font-size:10px;cursor:move;touch-action:none}.origin-marker{position:absolute;transform:translate(5px,5px);font-size:9px;color:#adc1c7;pointer-events:none}.camera-angle{font-size:10px;color:#89958e;margin-left:auto}
.lighting-viewport{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;background:#171a1c;color:#d4d8d8}.viewport-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid #383d3d;background:#252a2a}.viewport-toolbar strong{margin-right:auto;color:#d5e7d9;font-size:16px}.viewport-toolbar small{font-size:10px;font-weight:400;color:#a0aaa7}.viewport-stage{position:relative;flex:1;min-height:220px;overflow:hidden}.viewport-stage canvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab;outline:none}.viewport-stage canvas:focus-visible{outline:2px solid #93b2a1;outline-offset:-2px}button{font:inherit;color:inherit;cursor:pointer}.viewport-status,.viewport-error{position:absolute;top:10px;left:10px;padding:7px 10px;background:#25342de8;border-radius:5px;font-size:12px}.viewport-error{right:10px;color:#ffd1c6;background:#422a29}.light-guide{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.light-guide line{stroke:#d4b35c;stroke-width:2;stroke-dasharray:6 5;opacity:.9}.light-guide .parallel-ray{stroke-width:1;opacity:.4}.light-guide circle{fill:none;stroke:#e1bd64;stroke-width:1.5}.light-position{position:absolute;transform:translate(-50%,-50%);width:26px;height:26px;border:1px solid #dfbb6c;border-radius:50%;background:#3c3322;color:#ffe4a1;touch-action:none;cursor:move;font-size:21px;line-height:1;padding:0}.selection-ring{position:absolute;transform:translate(-50%,-50%);width:42px;height:14px;border:1px solid #bfd4ad;border-radius:50%;pointer-events:none;box-shadow:0 0 4px #a8cfa355}.light-handle{position:absolute;transform:translate(-50%,-50%);width:31px;height:31px;border:1px solid #dfbb6c;border-radius:50%;background:#3c3322;color:#ffe4a1;font-size:23px;line-height:1;touch-action:none;cursor:ns-resize}.object-marker{position:absolute;transform:translate(-50%,8px);padding:3px 7px;border:1px solid #6b78715e;border-radius:4px;background:#17201dcc;color:#bdc7bf;font-size:10px;white-space:nowrap;touch-action:none;cursor:grab}.object-marker.active{color:#e4efce;border-color:#b8ce92;background:#384735e6}.viewport-caption{position:absolute;bottom:10px;left:12px;font-size:10px;color:#a2afa7;background:#17201dd9;padding:5px 8px;pointer-events:none}.viewport-error button{border:1px solid #48514e;border-radius:4px;padding:6px;background:#2a3230}.compact .viewport-toolbar strong small{display:none}.compact .viewport-caption{font-size:9px;max-width:80%}
</style>
