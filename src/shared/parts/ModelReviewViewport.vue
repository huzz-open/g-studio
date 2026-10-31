<script setup lang="ts">
import { computed, nextTick, ref, watch, onUnmounted } from 'vue'
import { clonePart, type PartAsset } from './schema'
import { originalVersion, optimizedVersion, comparisonCurrent, chooseModelVersion, fitModelComparison } from './model-comparison'
import { optimizeModel } from './optimize-model'
import type { SceneState } from '../../modules/scene-lighting/model'
import LightingViewport from '../../modules/scene-lighting/LightingViewport.vue'
import ModelComparisonViewport from './ModelComparisonViewport.vue'
import SegmentedControl from '../components/SegmentedControl.vue'
import type { PreviewDisplay } from '../../modules/scene-lighting/preview-display'
import { readReview, saveReview } from './optimization-storage'
import { useI18n } from '../i18n'
const props=defineProps<{modelValue:PartAsset;state:SceneState;fitView:()=>void;autoFit:boolean;previewPart?:PartAsset;hovering?:boolean;disabled?:boolean;swipe?:boolean;controlsTarget?:string}>()
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

const surface=ref<'effect'|'model'>('model'),presentation=ref<'overlay'|'difference'>('overlay'),overlayOpacity=ref(50)
const canCompare=computed(()=>!!candidate.value&&candidateCurrent.value)
const shownPart=computed(()=>props.hovering&&props.previewPart?props.previewPart:draft.value)
const display=computed<PreviewDisplay>(()=>({mode:surface.value==='model'?'alignment':'effect'}))
const referenceDisplay:PreviewDisplay={mode:'source'}
const comparisonAvailable=computed(()=>!props.hovering&&(props.swipe??true)&&canCompare.value)
const comparisonLeft=original,comparisonRight=computed(()=>candidate.value??draft.value)
const comparisonReady=ref(false)
const comparisonKey=computed(()=>[presentation.value,surface.value].join(':'))
watch([comparisonKey,comparisonAvailable],()=>{comparisonReady.value=false})
function fitComparison(){
  const rect=host.value?.getBoundingClientRect()
  if(rect?.height)fitModelComparison(props.state,comparisonLeft.value,comparisonRight.value,rect.width/rect.height)
}
watch(surface,()=>{props.state.mode='sprites'},{immediate:true})
const helpText=computed(()=>t(surface.value==='model'&&presentation.value==='difference'?'parts.alignmentLegend':comparisonAvailable.value?'parts.compareLightHelp':'parts.modelInspectHelp'))
const guides=computed(()=>surface.value==='effect'&&!comparisonAvailable.value)
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
    <ModelComparisonViewport :show-help="false" v-if="comparisonAvailable" :key="comparisonKey" :original="comparisonLeft" :candidate="comparisonRight" :state="state" :fit-view="fitComparison" :auto-fit="autoFit" :display="display" presentation="split" :guides="false" :reference-mode="surface==='model'?presentation:undefined" :opacity="overlayOpacity/100" :class="{'hidden-view':!comparisonReady}" @ready="comparisonReady=true" @interact="emit('interact')"/>
    <ModelComparisonViewport :show-help="false" v-else-if="surface==='model'&&presentation==='overlay'" :original="shownPart" :candidate="shownPart" :state="state" :fit-view="fitView" :auto-fit="autoFit" :display="display" :left-display="referenceDisplay" presentation="overlay" :opacity="overlayOpacity/100" :guides="false" :left-label="t('parts.view.original')" :right-label="t('parts.modelInspection')"/>
    <LightingViewport v-else :reference-legend="false" :state="state" :assets="[shownPart]" compact :editable="false" :controls="false" :fit-view="fitView" :auto-fit="autoFit" :display="display" :check-alignment="surface==='model'&&presentation==='difference'" :guides="guides" @zoom="emit('interact')" @pan="emit('interact')"/>
    <p v-if="error&&error!==draft.modelComparison?.optimizationError" class="review-error" role="alert">{{error}}</p>
    <div class="comparison-tools">
      <SegmentedControl v-model="surface" :options="[{value:'effect',label:t('parts.effectPreview')},{value:'model',label:t('parts.modelInspection')}]" role="group" :aria-label="t('parts.viewTask')"/>
      <div v-if="surface==='model'" class="reference-modes">
        <SegmentedControl v-model="presentation" :options="[{value:'overlay',label:t('parts.compareOverlay')},{value:'difference',label:t('parts.compareDifference')}]"/>
        <input v-if="presentation==='overlay'" class="overlay-opacity" v-model.number="overlayOpacity" type="range" min="0" max="100" :aria-label="t('parts.modelOpacity')"/>
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
.review-help{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);font-size:11px;padding:5px 8px;background:#16221ed9;color:#c5d6cb;pointer-events:none;white-space:nowrap;max-width:calc(100% - 24px);box-sizing:border-box;z-index:8}

.reference-modes{position:relative}.overlay-opacity{position:absolute;left:0;bottom:calc(100% + 8px);width:50%;height:16px;margin:0;box-sizing:border-box}

.review-error{position:absolute;top:48px;left:12px;right:12px;z-index:9;background:#512b28;color:#ffd4c6;padding:8px;font-size:12px}
.review-layout{display:flex;flex:1;min-width:0;min-height:0;width:100%;height:100%}.model-review{position:relative;flex:1;min-width:0;min-height:0}.model-review>.lighting-viewport,.model-review>.model-comparison{position:absolute;inset:0}.hidden-view{visibility:hidden;pointer-events:none}.comparison-tools{position:absolute;bottom:48px;left:12px;right:12px;z-index:8;display:flex;gap:12px;flex-wrap:wrap;justify-content:center;align-items:center;color:#d6ded9;width:fit-content;margin:auto;max-width:calc(100% - 40px)}.model-properties{width:200px;flex-shrink:0;padding:16px;box-sizing:border-box;background:#242b28;border-left:1px solid #46534a;color:#d6ded9;font-size:12px;overflow:auto;display:flex;flex-direction:column;gap:14px}.model-properties p{margin:0;line-height:1.6;overflow-wrap:anywhere}.model-properties button{padding:8px;color:inherit;background:#364b3e;border:1px solid #637e6c;border-radius:4px}.model-review :deep(.comparison-label){top:12px}
</style>
