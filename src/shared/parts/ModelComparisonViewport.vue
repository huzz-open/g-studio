<script setup lang="ts">
import CanvasControls from '../components/CanvasControls.vue'
import ModelImageViewport from './ModelImageViewport.vue'
import type { PreviewDisplay } from '../../modules/scene-lighting/preview-display'
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import LightingViewport from '../../modules/scene-lighting/LightingViewport.vue'
import { PITCH, YAW, type SceneState } from '../../modules/scene-lighting/model'
import { sceneCamera } from '../../modules/scene-lighting/scene-camera'
import { normalize, cross } from '../../modules/experiments/umbrella/math'
import { partRenderKey, type PartAsset } from './schema'
import { useI18n } from '../i18n'
const props=defineProps<{original:PartAsset;candidate:PartAsset;state:SceneState;fitView:()=>void;autoFit:boolean;display?:PreviewDisplay;leftDisplay?:PreviewDisplay;leftLabel?:string;rightLabel?:string;presentation?:'split'|'overlay'|'difference';opacity?:number;guides?:boolean;showHelp?:boolean;referenceMode?:'overlay'|'difference';single?:boolean;fixedDivider?:boolean;sideBySide?:boolean;leftTarget?:[number,number,number];rightTarget?:[number,number,number]}>()
const emit=defineEmits<{interact:[];ready:[]}>()
const {t}=useI18n(),host=ref<HTMLElement>(),split=ref(50),leftReady=ref(false),rightReady=ref(false)
const splitting=ref(false)
const leftState=computed(()=>props.sideBySide&&!props.single&&props.leftTarget?{...props.state,target:props.leftTarget}:props.state)
const rightState=computed(()=>props.sideBySide&&!props.single&&props.rightTarget?{...props.state,target:props.rightTarget}:props.state)
let observer:ResizeObserver|undefined
let drag:{id:number;x:number;y:number;type:'split'|'orbit'|'pan';yaw:number;pitch:number;target:[number,number,number]}|undefined
watch(()=>partRenderKey(props.original),()=>{leftReady.value=false})
watch(()=>partRenderKey(props.candidate),()=>{rightReady.value=false})
function ready(side:'left'|'right'){
  if(side==='left')leftReady.value=true;else rightReady.value=true
  if(leftReady.value&&(props.single||rightReady.value)){
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
function wheel(event:WheelEvent){
  if(!(event.target instanceof HTMLCanvasElement))return
  event.preventDefault();event.stopPropagation();zoom(event.deltaY>0?1.06:1/1.06)
}
function zoom(factor:number){emit('interact');props.state.zoom=Math.max(4,Math.min(40,props.state.zoom*factor))}
function key(event:KeyboardEvent){
  const values:Record<string,number>={ArrowLeft:split.value-(event.shiftKey?10:1),ArrowRight:split.value+(event.shiftKey?10:1),Home:0,End:100,PageUp:split.value+10,PageDown:split.value-10}
  if(event.key in values){event.preventDefault();split.value=Math.max(0,Math.min(100,values[event.key]))}
}
onMounted(()=>{observer=new ResizeObserver(()=>{if(props.autoFit)props.fitView()});observer.observe(host.value!)})
onUnmounted(()=>observer?.disconnect())
</script>
<template>
  <div ref="host" class="model-comparison" :class="{'is-resizing':splitting,'side-by-side':sideBySide&&!single}" :aria-label="t('parts.compareModels')" @pointerdown.capture="canvasStart" @pointermove="move" @pointerup="end" @pointercancel="end" @lostpointercapture="end" @contextmenu.prevent @wheel.capture="wheel">
    <div class="comparison-layer original-layer"><ModelImageViewport v-if="referenceMode" :part="original" :state="leftState" :mode="referenceMode" :opacity="opacity??.5" @ready="ready('left')" @interact="emit('interact')"/><LightingViewport v-else :state="leftState" :assets="[original]" compact :editable="false" :controls="false" :auto-fit="false" :display="leftDisplay??display" :guides="guides" @ready="ready('left')" @pan="emit('interact')" @zoom="emit('interact')"/></div>
    <div v-if="!single" class="comparison-layer candidate-layer" :style="sideBySide?{}:presentation==='difference'?{mixBlendMode:'difference'}:presentation==='overlay'?{opacity:opacity??.5}:{clipPath:`inset(0 0 0 ${fixedDivider?50:split}%)`}"><ModelImageViewport v-if="referenceMode" :part="candidate" :state="rightState" :mode="referenceMode" :opacity="opacity??.5" @ready="ready('right')" @interact="emit('interact')"/><LightingViewport v-else :state="rightState" :assets="[candidate]" compact :editable="false" :controls="false" :auto-fit="false" :display="display" :guides="guides" @ready="ready('right')" @pan="emit('interact')" @zoom="emit('interact')"/></div>
    <span v-if="!single" class="comparison-label left-label">{{leftLabel??t('parts.originalModel')}}</span><span v-if="!single" class="comparison-label right-label">{{rightLabel??t('parts.optimizedModel')}}</span>
    <div v-if="!single&&(sideBySide||fixedDivider)&&(!presentation||presentation==='split')" class="comparison-line fixed-line" style="left:50%" aria-hidden="true"/>
    <div v-else-if="!single&&!sideBySide&&(!presentation||presentation==='split')" class="comparison-line" :style="{left:split+'%'}" role="slider" tabindex="0" :aria-label="t('parts.compareDivider')" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.round(split)" aria-orientation="horizontal" @pointerdown.stop="start($event,'split')" @keydown="key"/>
    <CanvasControls :show-actual-size="false" @fit="fitView" @zoom-in="zoom(1/1.2)" @zoom-out="zoom(1.2)"/>
    <span v-if="showHelp!==false" class="comparison-help">{{t(state.mode==='sprites'?'parts.compareLightHelp':'parts.compareOrbitHelp')}}</span>
    <div v-if="!leftReady||(!single&&!rightReady)" class="comparison-loading" role="status">{{t('common.updating')}}</div>
  </div>
</template>
<style scoped>
.model-comparison{position:relative;flex:1;min-height:0;overflow:hidden;touch-action:none;isolation:isolate;background:#202526}.comparison-layer{position:absolute;inset:0;display:flex}.side-by-side .original-layer{right:50%;overflow:hidden}.side-by-side .candidate-layer{left:50%;overflow:hidden}.comparison-layer :deep(.lighting-viewport){flex:1;width:100%;height:100%}.comparison-line{position:absolute;top:0;bottom:0;width:18px;transform:translateX(-50%);cursor:ew-resize;touch-action:none;z-index:4}.comparison-line::before{content:"";position:absolute;top:0;bottom:0;left:50%;transform:translateX(-50%);width:2px;background:#cfdfd7;pointer-events:none}.comparison-line:hover::before,.comparison-line:focus-visible::before,.is-resizing .comparison-line::before{width:3px;background:#8ab4f8;box-shadow:0 0 8px #8ab4f855}.comparison-line{outline:none}.comparison-line.fixed-line{pointer-events:none;width:2px;cursor:default}.is-resizing,.is-resizing :deep(*){cursor:ew-resize!important}.comparison-label{position:absolute;top:12px;padding:6px 10px;background:#252525ee;color:#eee;border-radius:4px;pointer-events:none;z-index:3;font-size:12px}.left-label{left:12px}.right-label{right:12px}.comparison-help{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);font-size:11px;padding:5px 8px;background:#252525ee;color:#ccc;pointer-events:none;white-space:nowrap;z-index:3}.comparison-loading{position:absolute;top:48px;right:12px;padding:6px 10px;border-radius:4px;background:#252525ee;z-index:5;color:#bbb;font-size:13px;pointer-events:none}
</style>
