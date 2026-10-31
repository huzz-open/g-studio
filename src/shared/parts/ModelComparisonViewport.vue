<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import LightingViewport from '../../modules/scene-lighting/LightingViewport.vue'
import { PITCH, YAW, type SceneState } from '../../modules/scene-lighting/model'
import { sceneCamera } from '../../modules/scene-lighting/scene-camera'
import { normalize, cross } from '../../modules/experiments/umbrella/math'
import { partRenderKey, type PartAsset } from './schema'
import { useI18n } from '../i18n'
const props=defineProps<{original:PartAsset;candidate:PartAsset;state:SceneState;fitView:()=>void;autoFit:boolean}>()
const emit=defineEmits<{interact:[];ready:[]}>()
const {t}=useI18n(),host=ref<HTMLElement>(),split=ref(50),leftReady=ref(false),rightReady=ref(false)
const splitting=ref(false)
let observer:ResizeObserver|undefined
let drag:{id:number;x:number;y:number;type:'split'|'orbit'|'pan';yaw:number;pitch:number;target:[number,number,number]}|undefined
watch(()=>partRenderKey(props.original),()=>{leftReady.value=false})
watch(()=>partRenderKey(props.candidate),()=>{rightReady.value=false})
function ready(side:'left'|'right'){
  if(side==='left')leftReady.value=true;else rightReady.value=true
  if(leftReady.value&&rightReady.value){
    if(props.autoFit)props.fitView()
    emit('ready')
  }
}
function start(event:PointerEvent,type:'split'|'orbit'|'pan'){
  if(event.button!==0&&event.button!==2)return
  event.preventDefault();event.stopPropagation()
  drag={id:event.pointerId,x:event.clientX,y:event.clientY,type,yaw:props.state.inspectionYaw??YAW,pitch:props.state.inspectionPitch??PITCH,target:[...(props.state.target??[0,1,0])]}
  splitting.value=type==='split'
  host.value!.setPointerCapture(event.pointerId)
  if(type!=='split')emit('interact')
  else move(event)
}
function canvasStart(event:PointerEvent){
  if(!(event.target instanceof HTMLCanvasElement))return
  start(event,props.state.mode!=='sprites'&&event.button===0&&!event.shiftKey?'orbit':'pan')
}
function move(event:PointerEvent){
  if(!drag||event.pointerId!==drag.id)return
  const rect=host.value!.getBoundingClientRect(),dx=event.clientX-drag.x,dy=event.clientY-drag.y
  if(drag.type==='split'){split.value=Math.max(0,Math.min(100,(event.clientX-rect.left)/rect.width*100));return}
  if(drag.type==='orbit'){
    props.state.inspectionYaw=drag.yaw-dx*.35;props.state.inspectionPitch=Math.max(-80,Math.min(80,drag.pitch+dy*.3));return
  }
  const camera=sceneCamera(props.state,rect.width/rect.height),forward=normalize((props.state.target??drag.target).map((v,i)=>v-camera.eye[i]) as [number,number,number]),right=normalize(cross(forward,[0,1,0])),up=cross(right,forward),unit=props.state.zoom*.8/rect.height
  props.state.target=drag.target.map((v,i)=>v-right[i]*dx*unit+up[i]*dy*unit) as [number,number,number]
}
function end(event:PointerEvent){if(drag?.id===event.pointerId){drag=undefined;splitting.value=false;if(host.value?.hasPointerCapture(event.pointerId))host.value.releasePointerCapture(event.pointerId)}}
function key(event:KeyboardEvent){
  const values:Record<string,number>={ArrowLeft:split.value-(event.shiftKey?10:1),ArrowRight:split.value+(event.shiftKey?10:1),Home:0,End:100,PageUp:split.value+10,PageDown:split.value-10}
  if(event.key in values){event.preventDefault();split.value=Math.max(0,Math.min(100,values[event.key]))}
}
onMounted(()=>{observer=new ResizeObserver(()=>{if(props.autoFit)props.fitView()});observer.observe(host.value!)})
onUnmounted(()=>observer?.disconnect())
</script>
<template>
  <div ref="host" class="model-comparison" :class="{'is-resizing':splitting}" :aria-label="t('parts.compareModels')" @pointerdown.capture="canvasStart" @pointermove="move" @pointerup="end" @pointercancel="end" @lostpointercapture="end" @contextmenu.prevent>
    <div class="comparison-layer original-layer"><LightingViewport :state="state" :assets="[original]" compact :editable="false" :controls="false" :fit-view="fitView" :auto-fit="false" @ready="ready('left')" @pan="emit('interact')" @zoom="emit('interact')"/></div>
    <div class="comparison-layer candidate-layer" :style="{clipPath:`inset(0 0 0 ${split}%)`}"><LightingViewport :state="state" :assets="[candidate]" compact :editable="false" :controls="false" :fit-view="fitView" :auto-fit="false" @ready="ready('right')" @pan="emit('interact')" @zoom="emit('interact')"/></div>
    <span class="comparison-label left-label">{{t('parts.originalModel')}}</span><span class="comparison-label right-label">{{t('parts.optimizedModel')}}</span>
    <div class="comparison-line" :style="{left:split+'%'}" role="slider" tabindex="0" :aria-label="t('parts.compareDivider')" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.round(split)" aria-orientation="horizontal" @pointerdown.stop="start($event,'split')" @keydown="key"/>
    <span class="comparison-help">{{t(state.mode==='sprites'?'parts.compareLightHelp':'parts.compareOrbitHelp')}}</span>
    <div v-if="!leftReady||!rightReady" class="comparison-loading" role="status">{{t('common.updating')}}</div>
  </div>
</template>
<style scoped>
.model-comparison{position:relative;flex:1;min-height:0;overflow:hidden;touch-action:none;background:#202526}.comparison-layer{position:absolute;inset:0;display:flex}.comparison-layer :deep(.lighting-viewport){flex:1;width:100%;height:100%}.comparison-line{position:absolute;top:0;bottom:0;width:18px;transform:translateX(-50%);cursor:ew-resize;touch-action:none;z-index:4}.comparison-line::before{content:"";position:absolute;top:0;bottom:0;left:50%;transform:translateX(-50%);width:2px;background:#cfdfd7;pointer-events:none}.comparison-line:hover::before,.comparison-line:focus-visible::before,.is-resizing .comparison-line::before{width:3px;background:#a8e8c4;box-shadow:0 0 8px #8edfb999}.comparison-line{outline:none}.is-resizing,.is-resizing :deep(*){cursor:ew-resize!important}.comparison-label{position:absolute;top:12px;padding:6px 10px;background:#15251de8;color:#e4eee8;border-radius:4px;pointer-events:none;z-index:3;font-size:12px}.left-label{left:12px}.right-label{right:12px}.comparison-help{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);font-size:11px;padding:5px 8px;background:#16221ed9;color:#c5d6cb;pointer-events:none;white-space:nowrap;z-index:3}.comparison-loading{position:absolute;top:48px;right:12px;padding:6px 10px;border-radius:4px;background:#15251de8;z-index:5;color:#b8ccbf;font-size:13px;pointer-events:none}
</style>
