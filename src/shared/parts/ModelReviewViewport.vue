<script setup lang="ts">
import { computed, nextTick, ref, watch, onUnmounted } from 'vue'
import { clonePart, type PartAsset } from './schema'
import { originalVersion, optimizedVersion, comparisonCurrent, chooseModelVersion, inspectionBounds } from './model-comparison'
import { optimizeModel } from './optimize-model'
import { cross, normalize, dot, type Vec3 } from '../../modules/experiments/umbrella/math'
import { sceneCamera } from '../../modules/scene-lighting/scene-camera'
import type { SceneState } from '../../modules/scene-lighting/model'
import { PITCH, YAW } from '../../modules/scene-lighting/model'
import ModelComparisonViewport from './ModelComparisonViewport.vue'
import SegmentedControl from '../components/SegmentedControl.vue'
import type { PreviewDisplay } from '../../modules/scene-lighting/preview-display'
import { readReview, saveReview } from './optimization-storage'
import { useI18n } from '../i18n'
const props=defineProps<{modelValue:PartAsset;state:SceneState;fitView:()=>void;autoFit:boolean;previewPart?:PartAsset;hovering?:boolean;disabled?:boolean;modelOnly?:boolean;viewControlsTarget?:string;controlsTarget?:string}>()
const emit=defineEmits<{'update:modelValue':[PartAsset];busy:[boolean];interact:[]}>()
const {t}=useI18n(),host=ref<HTMLElement>()
const draft=computed({get:()=>props.modelValue,set:value=>emit('update:modelValue',value)})
const candidate=computed(()=>optimizedVersion(draft.value)),original=computed(()=>originalVersion(draft.value))
const candidateCurrent=computed(()=>comparisonCurrent(draft.value))
const saving=computed(()=>!!props.disabled)
const aligning=ref(false),error=ref('')
let alignmentController:AbortController|undefined,disposed=false
watch(()=>[draft.value.id,draft.value.model.mesh?.sha256],()=>alignmentController?.abort())
onUnmounted(()=>{disposed=true;alignmentController?.abort();emit('busy',false)})

const surface=ref<'effect'|'model'>('model'),showSource=ref(false),showOriginal=ref(true),showOptimized=ref(true),overlayOpacity=ref(50)
const comparisonLayout=ref<'side-by-side'|'swipe'>('side-by-side')
const canCompare=computed(()=>!!candidate.value&&candidateCurrent.value)
const optimizedVisible=computed({get:()=>canCompare.value&&showOptimized.value,set:(value:boolean)=>{showOptimized.value=value}})
const shownPart=computed(()=>props.hovering&&props.previewPart?props.previewPart:draft.value)
const modelSurface=computed(()=>props.modelOnly||surface.value==='model')
const display=computed<PreviewDisplay>(()=>({mode:modelSurface.value?'alignment':'effect'}))
const comparisonAvailable=computed(()=>modelSurface.value&&!props.hovering&&canCompare.value&&showOriginal.value&&showOptimized.value)
const comparisonLeft=computed(()=>!modelSurface.value||props.hovering?shownPart.value:!showOriginal.value&&canCompare.value?candidate.value!:original.value)
const comparisonRight=computed(()=>candidate.value??draft.value)
const sideBySide=computed(()=>comparisonAvailable.value&&comparisonLayout.value==='side-by-side')
const leftBounds=computed(()=>inspectionBounds(comparisonLeft.value,props.state,showSource.value))
const rightBounds=computed(()=>inspectionBounds(comparisonRight.value,props.state,showSource.value))
const center=computed(()=>leftBounds.value.center.map((v,i)=>comparisonAvailable.value?(v+rightBounds.value.center[i])/2:v) as Vec3)
const sideTarget=(bounds:ReturnType<typeof inspectionBounds>)=>bounds.center.map((v,i)=>v+(props.state.target??center.value)[i]-center.value[i]) as Vec3
const comparisonKey=computed(()=>[modelSurface.value,comparisonAvailable.value,showSource.value,comparisonLeft.value.model.id].join(':'))
watch(canCompare,available=>{if(!available)showOriginal.value=true})
watch(modelSurface,value=>{props.state.mode=value?'model':'sprites'},{immediate:true})
function fitComparison(){
  const rect=host.value?.getBoundingClientRect();if(!rect?.height)return
  const aspect=rect.width/(sideBySide.value?2:1)/rect.height
  const camera=sceneCamera(props.state,aspect),forward=normalize((props.state.target??[0,1.15,0]).map((v,i)=>v-camera.eye[i]) as Vec3),right=normalize(cross(forward,[0,1,0])),up=cross(right,forward)
  let extentX=0,extentY=0
  for(const bounds of comparisonAvailable.value?[leftBounds.value,rightBounds.value]:[leftBounds.value]){
    const target=sideBySide.value?bounds.center:center.value
    for(const x of [bounds.min[0],bounds.max[0]])for(const y of [bounds.min[1],bounds.max[1]])for(const z of [bounds.min[2],bounds.max[2]]){
      const point:Vec3=[x-target[0],y-target[1],z-target[2]]
      extentX=Math.max(extentX,Math.abs(dot(point,right)));extentY=Math.max(extentY,Math.abs(dot(point,up)))
    }
  }
  props.state.target=[...center.value]
  props.state.zoom=Math.max(4,Math.min(40,1.3*Math.max(extentY*2,extentX*2/Math.max(.1,aspect))/.8))
}
watch([comparisonLayout,comparisonAvailable],()=>{if(modelSurface.value)void nextTick(fitComparison)})
function resetView(){
  props.state.inspectionYaw=YAW;props.state.inspectionPitch=PITCH
  if(modelSurface.value)fitComparison();else props.fitView()
}
const helpText=computed(()=>t(modelSurface.value?'parts.compareOrbitHelp':'parts.reviewPanHelp'))
let preferenceRevision=0
function toggleOptimization(enabled:boolean){
  preferenceRevision++
  alignmentController?.abort()
  const next=clonePart(draft.value),c=next.modelComparison
  if(!c)return
  c.autoOptimize=enabled;delete c.optimizationError
  chooseModelVersion(next,enabled&&c.candidate?'optimized':'original');draft.value=next
  if(enabled&&!c.candidate)void nextTick(()=>selectAlignedModel())
}
const hydrating=ref(false)
watch([aligning,hydrating],([computing,reading])=>emit('busy',computing||reading),{flush:'sync'})
watch(()=>[draft.value.modelComparison?.source.id,draft.value.modelComparison?.source.mesh?.modelId,draft.value.modelComparison?.inputKey].join(':'),async(id,_,cleanup)=>{
  if(!id||!draft.value.modelComparison)return
  let current=true;const revision=preferenceRevision;cleanup(()=>{current=false});hydrating.value=true
  try{
    const saved=await readReview(draft.value)
    if(current&&saved&&!draft.value.modelComparison?.candidate){
      const next=clonePart(draft.value);if(revision!==preferenceRevision)saved.autoOptimize=next.modelComparison!.autoOptimize;next.modelComparison=saved;chooseModelVersion(next,saved.autoOptimize&&saved.candidate?'optimized':'original');draft.value=next
    }
    if(current&&draft.value.modelComparison?.candidate)await saveReview(draft.value)
  }catch(e){error.value=String(e)}finally{if(current)hydrating.value=false}
},{immediate:true})
watch(()=>draft.value.modelComparison,()=>{if(draft.value.modelComparison&&!hydrating.value)void saveReview(draft.value).catch(e=>{error.value=String(e)})},{deep:true})
defineExpose({toggleOptimization})
async function selectAlignedModel(){
  if(disposed||aligning.value||saving.value||!candidateCurrent.value||!draft.value.modelComparison?.autoOptimize)return false
  aligning.value=true;error.value=''
  const controller=new AbortController();alignmentController=controller
  const sourceId=draft.value.modelComparison?.source.id,inputKey=draft.value.modelComparison?.inputKey
  try{
    const result=await optimizeModel(draft.value,controller.signal)
    if(controller.signal.aborted||disposed||sourceId!==draft.value.modelComparison?.source.id||inputKey!==draft.value.modelComparison?.inputKey||!draft.value.modelComparison?.autoOptimize)return false
    const next=clonePart(draft.value);next.modelComparison=result.modelComparison;next.model=result.model;draft.value=next;return true
  }catch(e){
    if(!controller.signal.aborted&&!disposed){error.value=String(e);const next=clonePart(draft.value);if(next.modelComparison)next.modelComparison.optimizationError=error.value;draft.value=next}
    return false
  }finally{aligning.value=false;alignmentController=undefined}

}
</script>

<template>
  <div class="review-layout">
  <div ref="host" class="model-review">
    <ModelComparisonViewport :show-help="false" :key="comparisonKey" :original="comparisonLeft" :candidate="comparisonRight" :single="!comparisonAvailable" :side-by-side="sideBySide" :left-target="sideTarget(leftBounds)" :right-target="sideTarget(rightBounds)" :state="state" :fit-view="resetView" :auto-fit="autoFit" :display="display" presentation="split" :guides="!modelSurface" :reference-mode="modelSurface&&showSource?'overlay':undefined" :opacity="overlayOpacity/100" @interact="emit('interact')"/>
    <p v-if="error&&error!==draft.modelComparison?.optimizationError" class="review-error" role="alert">{{error}}</p>
    <div class="comparison-tools">
      <Teleport defer v-if="!modelOnly" :to="viewControlsTarget || 'body'" :disabled="!viewControlsTarget">
      <SegmentedControl v-model="surface" :options="[{value:'effect',label:t('parts.effectPreview')},{value:'model',label:t('parts.modelInspection')}]" role="group" :aria-label="t('parts.viewTask')"/>
      </Teleport>
      <div v-if="modelSurface" class="model-layers" role="group" :aria-label="t('parts.modelInspection')">
        <SegmentedControl v-if="comparisonAvailable" v-model="comparisonLayout" :options="[{value:'swipe',label:t('parts.compareSwipeMode')},{value:'side-by-side',label:t('parts.compareSideBySide')}]" :aria-label="t('parts.compareModels')"/>
        <label><input type="checkbox" v-model="showSource"/>{{t('parts.showSource')}}</label>
        <label><input type="checkbox" v-model="showOriginal" :disabled="!canCompare||!showOptimized"/>{{t('parts.originalModel')}}</label>
        <label><input type="checkbox" v-model="optimizedVisible" :disabled="!canCompare||!showOriginal"/>{{t('parts.optimizedModel')}}</label>
        <label v-if="showSource" class="opacity-control">{{t('parts.modelOpacity')}}<input v-model.number="overlayOpacity" type="range" min="0" max="100" :aria-label="t('parts.modelOpacity')"/></label>
        <button type="button" @click="resetView">{{t('parts.resetReferenceView')}}</button>
      </div>
    </div>
    <div class="review-help" role="status">{{helpText}}</div>
  </div>
  <Teleport v-if="controlsTarget&&draft.modelComparison" :to="controlsTarget">
    <p v-if="draft.modelComparison.optimizationError" role="alert">{{draft.modelComparison.optimizationError}}</p>
  </Teleport>
  </div>
</template>
<style scoped>
.review-help{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);font-size:11px;padding:5px 8px;background:#252525ee;color:#bbb;pointer-events:none;white-space:nowrap;max-width:calc(100% - 24px);box-sizing:border-box;z-index:8}

.model-layers{display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;padding:8px 10px;background:#252525ee;border:1px solid #444;border-radius:5px;font-size:12px}.model-layers label{display:flex;align-items:center;gap:5px;white-space:nowrap}.model-layers input{accent-color:#8ab4f8}.model-layers button{font:inherit;color:inherit;background:#333;border:1px solid #555;border-radius:4px;padding:5px 8px;cursor:pointer}.model-layers button:hover{background:#3a3a3a;color:#eee}.model-layers button:focus-visible{outline:2px solid #8ab4f8;outline-offset:2px}.opacity-control input{width:80px}

.review-error{position:absolute;top:48px;left:12px;right:12px;z-index:9;background:#512b28;color:#ffd4c6;padding:8px;font-size:12px}
.review-layout{display:flex;flex:1;min-width:0;min-height:0;width:100%;height:100%}.model-review{position:relative;flex:1;min-width:0;min-height:0}.model-review>.lighting-viewport,.model-review>.model-comparison{position:absolute;inset:0}.comparison-tools{position:absolute;bottom:48px;left:12px;right:12px;z-index:8;display:flex;gap:12px;flex-wrap:wrap;justify-content:center;align-items:center;color:#ccc;width:fit-content;margin:auto;max-width:calc(100% - 40px)}.model-properties{width:200px;flex-shrink:0;padding:16px;box-sizing:border-box;background:#242b28;border-left:1px solid #444;color:#ccc;font-size:12px;overflow:auto;display:flex;flex-direction:column;gap:14px}.model-properties p{margin:0;line-height:1.6;overflow-wrap:anywhere}.model-properties button{padding:8px;color:inherit;background:#333;border:1px solid #555;border-radius:4px}.model-review :deep(.comparison-label){top:12px}
</style>
