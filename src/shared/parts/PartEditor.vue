<script setup lang="ts">
import GenerationPanel from '../generation/GenerationPanel.vue'
import { generatedModels, resolvePartModels } from '../generation/models'
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, useId, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from '../i18n'
import { initializeComparison, originalVersion, optimizedVersion, comparisonCurrent, fitModelComparison } from './model-comparison'
import ModelReviewViewport from './ModelReviewViewport.vue'
import { clonePart, validatePart, type PartAsset, type PartModel } from './schema'
import { partLibrary, savePart } from './library'
import { normalImageUrl, portablePart } from './images'
import { closePartEditor, openPartEditor } from './editor-session'
import { openPartInSlicer } from './slicer-bridge'
import { downloadBlob } from '../utils/download'
import { confirm } from '../components/confirm'
import { createPartPreview, fitPartPreview } from './preview-state'
import { modelKey, matchingModelJobs, partModelOptions, selectPartModel } from './model-options'
import { generationJobs, loadGenerationJobs } from '../generation/jobs'
import { sha256 } from '../generation/client'
import SegmentedControl from '../components/SegmentedControl.vue'
import { addPartsToScene } from '../../modules/scene-lighting/store'
import LightSettings from '../../modules/scene-lighting/LightSettings.vue'
import SidebarSection from '../components/editor-shell/SidebarSection.vue'
import ScrollArea from '../components/ScrollArea.vue'
import ModelSelect from './ModelSelect.vue'

const props=defineProps<{asset:PartAsset;origin:'slicer'|'scene'}>()
const viewControlsId='part-view-controls-'+useId()
const initial=initializeComparison(clonePart(props.asset))
const {t}=useI18n(),router=useRouter(),draft=ref(initial),baseline=ref(clonePart(initial))
const candidate=computed(()=>optimizedVersion(draft.value)),original=computed(()=>originalVersion(draft.value))
const candidateCurrent=computed(()=>comparisonCurrent(draft.value))
watch(() => [...generatedModels.values()], () => {
  draft.value = resolvePartModels(draft.value)
  baseline.value = resolvePartModels(baseline.value)
}, { flush:'sync' })
const saving=ref(false),error=ref('')
const confirming=ref(false),showGeneration=ref(false),aligning=ref(false)
const selectingModel=ref(false)
let alignmentController:AbortController|undefined,disposed=false
watch(candidateCurrent,current=>{if(!current)alignmentController?.abort()})
const modelSelect=ref<InstanceType<typeof ModelSelect>>()
async function applyGenerated(part:PartAsset){modelChosen.value=true;if(part.modelComparison){validatePart(part);draft.value=clonePart(part);showGeneration.value=false;framePreview()}else if(await selectModel(part.model)){showGeneration.value=false;framePreview()}}
async function selectModel(model:PartModel){
  if(saving.value)return false
  alignmentController?.abort()
  alignmentController=undefined;selectingModel.value=false
  if(modelKey(draft.value.model)===modelKey(model)&&draft.value.model.mesh?.sha256===model.mesh?.sha256)return true
  selectingModel.value=true;error.value=''
  const controller=new AbortController();alignmentController=controller
  const before=draft.value,copy=clonePart(draft.value)
  try{
    selectPartModel(copy,model);delete copy.modelComparison
    const selected=initializeComparison(copy);validatePart(selected)
    if(disposed||controller.signal.aborted||before!==draft.value)return false
    draft.value=selected;return true
  }catch(e){if(!controller.signal.aborted)error.value=String(e);return false}finally{
    if(alignmentController===controller){selectingModel.value=false;alignmentController=undefined}
  }
}
const panel=ref<HTMLElement>(),previewAutoFit=ref(true)
const dirty=computed(()=>JSON.stringify(draft.value)!==JSON.stringify(baseline.value))
const conflict=computed(()=>partLibrary[props.asset.id]?.revision!==baseline.value.revision)
const modelChosen=ref(false),inputHash=ref('')
const modelJobs=computed(()=>matchingModelJobs(generationJobs,inputHash.value))
const modelOptions=computed(()=>partModelOptions(draft.value,modelJobs.value))
const modelChoice=computed(()=>modelKey(draft.value.model))
const hoveredModel=ref<string|null>(null)
// Viewport-only data: hover never changes draft, alternatives, dirty state or saved assets.
const previewPart=computed<PartAsset>(()=>{
  const model=modelOptions.value.find(option=>modelKey(option)===hoveredModel.value)
  if(!model||(modelKey(model)===modelChoice.value&&model.mesh?.sha256===draft.value.model.mesh?.sha256))return draft.value
  return {...draft.value,version:model.kind==='mesh'?2:draft.value.version,model:clonePart(model)}
})
function modelLabel(model:PartModel){

  if(model.kind==='mesh'){
    const models=modelOptions.value.filter(option=>option.kind==='mesh')
    return t('generation.mesh')+(models.length>1?' '+(models.findIndex(option=>modelKey(option)===modelKey(model))+1):'')
  }
  return t('parts.'+model.kind)
}
const previewDefaults=createPartPreview(props.asset)
const preview=reactive(clonePart(previewDefaults))
const review=ref<InstanceType<typeof ModelReviewViewport>>()
async function optimizeModel(value:string,enabled:boolean){const model=modelOptions.value.find(option=>modelKey(option)===value);if(!model||!await selectModel(model))return;await nextTick();review.value?.toggleOptimization(enabled)}
function framePreview(){
  previewAutoFit.value=true
  const canvas=panel.value?.querySelector('.part-preview canvas')
  const rect=canvas?.getBoundingClientRect()
  const aspect=rect&&rect.height>0?rect.width/rect.height:1
  if(candidate.value&&candidateCurrent.value)fitModelComparison(preview,original.value,candidate.value,aspect)
  else fitPartPreview(preview,draft.value,aspect)
}
function chooseModel(value:string){
  const model=modelOptions.value.find(option=>modelKey(option)===value)
  if(model){modelChosen.value=true;void selectModel(model)}
}
watch(()=>draft.value.image,async(image,_,onCleanup)=>{
  let current=true;onCleanup(()=>{current=false});inputHash.value=''
  try{
    const input=await portablePart({...draft.value,image})
    const hash=await sha256(await(await fetch(input.image.uri)).arrayBuffer())
    if(current)inputHash.value=hash
  }catch(e){if(current)error.value=String(e)}
},{immediate:true})
async function save():Promise<PartAsset|undefined>{
  if(saving.value||aligning.value||selectingModel.value)return
  saving.value=true;error.value=''
  try{validatePart(draft.value);const result=(dirty.value||!!draft.value.modelComparison&&!props.asset.modelComparison)?await savePart(clonePart(draft.value),baseline.value.revision):partLibrary[draft.value.id]??draft.value;baseline.value=clonePart(result);draft.value=clonePart(result);return result}catch(e){error.value=String(e)}finally{saving.value=false}
}
async function leave(){if(saving.value||confirming.value)return;alignmentController?.abort();if(dirty.value){confirming.value=true;const discard=await confirm({title:t('parts.discardTitle'),message:t('parts.discardMessage'),confirmText:t('parts.discard')});confirming.value=false;if(!discard)return}closePartEditor()}
async function saveAndClose(){if(await save())closePartEditor()}
async function addToScene(){const part=await save();if(!part)return;try{await addPartsToScene([part]);closePartEditor();await router.push('/scene-lighting')}catch(e){error.value=String(e)}}
async function locate(){
  const part=await save();if(!part)return
  saving.value=true
  try{const source=await openPartInSlicer(part);closePartEditor();await router.push('/sprite-slicer');openPartEditor({assetId:part.id,origin:'slicer',sourceTabId:source.tabId,spriteId:source.spriteId})}catch(e){error.value=String(e)}finally{saving.value=false}
}
async function exportAsset(){
  const part=await save();if(!part)return
  saving.value=true
  try{const portable=await portablePart(part);downloadBlob(new Blob([JSON.stringify(portable,null,2)],{type:'application/json'}),part.name.replace(/[<>:"/\\|?*]/g,'_')+'.gpart.json')}catch(e){error.value=String(e)}finally{saving.value=false}
}
async function exportPackage(){
  const part=await save();if(!part)return
  saving.value=true
  try{
    const JSZip=(await import('jszip')).default,zip=new JSZip(),portable=await portablePart(part)
    zip.file('part.json',JSON.stringify(portable,null,2));zip.file('color.png',await (await fetch(portable.image.uri)).arrayBuffer());zip.file('normal.png',await (await fetch(await normalImageUrl(part))).arrayBuffer())
    downloadBlob(await zip.generateAsync({type:'blob'}),part.name.replace(/[<>:"/\\|?*]/g,'_')+'.gpart.zip')
  }catch(e){error.value=String(e)}finally{saving.value=false}
}
function captureKey(event:KeyboardEvent){
  if(event.key==='Escape'&&modelSelect.value?.close()){event.preventDefault();event.stopImmediatePropagation();return}
  if(showGeneration.value){if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();showGeneration.value=false}return}
  if(confirming.value)return
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();void leave()}
  else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopImmediatePropagation();void save()}
  else if(event.key==='Tab'&&panel.value){const elements=[...panel.value.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(el=>el.offsetParent!==null);const first=elements[0],last=elements.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}
}

onMounted(()=>{framePreview();panel.value?.focus();document.addEventListener('keydown',captureKey,true);void loadGenerationJobs().catch(e=>{error.value=String(e)})})
onUnmounted(()=>{disposed=true;alignmentController?.abort();document.removeEventListener('keydown',captureKey,true)})
</script>
<template>
  <Teleport to="body"><div class="part-editor-overlay"><section ref="panel" tabindex="-1" class="part-editor" role="dialog" aria-modal="true" :aria-label="t('parts.editor')">
    <header><div><strong>{{t('parts.editor')}}</strong><span>{{draft.name}} · {{draft.image.width}} × {{draft.image.height}} {{dirty?'*':''}}</span></div><button :disabled="saving||aligning" :aria-label="t('common.close')" @click="leave">✕</button></header>
    <div v-if="error||conflict" class="editor-error" role="alert">{{error||t('parts.conflict')}}</div>
    <div class="editor-body"><aside class="part-sidebar" :aria-label="t('parts.partSettings')">
      <ScrollArea class="part-properties-scroll" :label="t('parts.properties')"><fieldset class="part-properties" :disabled="saving">
      <SidebarSection :title="t('parts.asset')" :collapsible="false"><label class="name-field">{{t('parts.name')}}<input v-model="draft.name" maxlength="120" :aria-label="t('parts.name')"/></label></SidebarSection>
      <SidebarSection :title="t('parts.viewTask')" :collapsible="false"><div :id="viewControlsId"/></SidebarSection>
      <SidebarSection :title="t('parts.previewLighting')">
        <SegmentedControl v-model="preview.scene" :label="t('sceneLight.environment')" :options="[{value:'open',label:t('sceneLight.open')},{value:'corner',label:t('sceneLight.corner')}]" role="group" :aria-label="t('sceneLight.environment')"/>
        <LightSettings :state="preview" :defaults="previewDefaults" />
      </SidebarSection>
      <SidebarSection :title="t('parts.model')">
        <ModelSelect ref="modelSelect" :part="draft" :model-value="modelChoice" :options="modelOptions.map(model=>({value:modelKey(model),label:modelLabel(model),model}))" :disabled="saving" :loading="selectingModel||aligning" :optimizing="aligning" :optimization-enabled="draft.modelComparison?.autoOptimize??true" @optimize="optimizeModel" @update:model-value="chooseModel" @preview="hoveredModel=$event" @generate="alignmentController?.abort();showGeneration=true"/>
        <p v-if="draft.modelComparison?.optimizationError" role="alert">{{draft.modelComparison.optimizationError}}</p>

      </SidebarSection>
    </fieldset></ScrollArea></aside><main class="part-preview" :aria-label="t('parts.effectPreview')">
      <ModelReviewViewport ref="review" v-model="draft" :view-controls-target="'#'+viewControlsId" :state="preview" :fit-view="framePreview" :auto-fit="previewAutoFit" :preview-part="previewPart" :hovering="!!hoveredModel" :disabled="saving||selectingModel" @busy="aligning=$event" @interact="previewAutoFit=false"/>
    </main></div>
    <footer><div class="button-row"><button :disabled="saving||aligning||selectingModel" @click="exportAsset">{{t('parts.exportAsset')}}</button><button :disabled="saving||aligning||selectingModel" @click="exportPackage">{{t('parts.exportPackage')}}</button><button v-if="origin==='scene'" :disabled="saving||aligning||selectingModel" @click="locate">{{t('parts.locateSlicer')}}</button></div><div class="button-row"><button :disabled="saving||aligning||selectingModel" @click="addToScene">{{t('parts.addOne')}}</button><button :disabled="saving||aligning||selectingModel" @click="leave">{{t(origin==='scene'?'parts.backScene':'parts.backSlicer')}}</button><button class="primary" :disabled="saving||aligning||selectingModel||conflict" @click="saveAndClose">{{t(saving?'common.loading':'parts.saveReturn')}}</button></div></footer>
  </section></div><div v-if="showGeneration" class="generation-overlay"><GenerationPanel :part="draft" :origin="origin" @apply="applyGenerated" @close="showGeneration=false"/></div></Teleport>
</template>
<style scoped>
.generation-overlay{position:fixed;inset:4vh 3vw;z-index:1800;border:1px solid #555;border-radius:9px;overflow:hidden;box-shadow:0 0 0 100vmax #0009}
.part-editor-overlay{position:fixed;inset:0;z-index:1700;background:#000b;display:flex;align-items:center;justify-content:center}.part-editor{width:100vw;height:100dvh;display:flex;flex-direction:column;background:#202526;border:0;border-radius:0;overflow:hidden;color:#d6ded9;outline:none;box-shadow:0 15px 70px #0008}.part-editor header{display:flex;align-items:center;justify-content:space-between;padding:12px 15px;background:#2a3230}.part-editor header>div{display:flex;gap:16px;align-items:center}.part-editor header span{font-size:12px;color:#a8b5ad}.part-editor button{font:inherit;font-size:11px;color:inherit;cursor:pointer;border:1px solid #536058;border-radius:4px;background:#333;padding:7px 10px}.part-editor button:disabled{opacity:.45;cursor:default}.part-editor button.primary{background:#3a3a3a;border-color:#777}.editor-body{display:flex;flex:1;min-height:0}.part-sidebar{display:flex;flex-direction:column;flex:0 0 285px;width:285px;min-width:0;min-height:0;border-right:1px solid #333}.part-properties-scroll{flex:1;min-height:0}.view-hint{font-size:11px;line-height:1.6;color:#9eafa4;margin:0}.part-properties{width:100%;min-width:0;padding:0;margin:0;border:0;box-sizing:border-box}.name-field{display:flex;flex-direction:column;font-size:11px;gap:7px}.name-field input,select{box-sizing:border-box;width:100%;border:1px solid #4c5850;border-radius:4px;padding:7px;background:#2b3330;color:#e0e8e1;font-size:12px}.note{font-size:10px;color:#a0b0a5;line-height:1.6;margin:8px 0}.approximation{color:#d5bd8b}.button-row{display:flex;gap:6px;flex-wrap:wrap}.wide{width:100%;margin-top:7px}.part-preview{display:flex;flex-direction:column;min-width:0;flex:1}.part-editor footer{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:10px 13px;border-top:1px solid #46534a;background:#28322c}.editor-error{font-size:11px;padding:8px 14px;background:#512b28;color:#ffd4c6;overflow-wrap:anywhere}@media(max-width:800px){.part-sidebar{flex-basis:250px;width:250px}.part-editor header>div{gap:7px;flex-wrap:wrap}.part-editor footer{padding:7px}.part-editor button{padding:6px;font-size:10px}}@media(max-width:560px){.editor-body{flex-direction:column;overflow:auto}.part-sidebar{width:100%;flex-basis:260px;height:260px;flex-shrink:0}.part-preview{min-height:380px}.part-editor{height:100dvh}}
</style>
