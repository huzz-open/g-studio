<script setup lang="ts">
import GenerationPanel from '../generation/GenerationPanel.vue'
import { generatedModels, resolvePartModels } from '../generation/models'
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from '../i18n'
import { NORMAL_RANGES } from '../types/normal-settings'
import { initializeComparison, originalVersion, optimizedVersion, comparisonCurrent, candidateApplied, storeCandidate, chooseModelVersion, fitModelComparison } from './model-comparison'
import ModelComparisonViewport from './ModelComparisonViewport.vue'
import { clonePart, validatePart, type PartAsset, type PartGeometry } from './schema'
import { partLibrary, savePart } from './library'
import { partImageUrl, normalImageUrl, portablePart, partPixels } from './images'
import { closePartEditor, openPartEditor } from './editor-session'
import { openPartInSlicer } from './slicer-bridge'
import { createLatestTask } from '../utils/latest-task'
import { downloadBlob } from '../utils/download'
import { confirm } from '../components/confirm'
import { partParameterDefaults } from './parameter-defaults'
import { alignedBounds, alignPartGeometry, buildPartGeometry } from '../../modules/scene-lighting/part-geometry'
import { orientationReference, ORIENTATION_METHOD } from './orientation-reference'
import { repairSpec, repairKey } from '../../modules/scene-lighting/geometry-repair'
import { computeGeometryRepair } from '../../modules/scene-lighting/geometry-repair-client'
import { searchOrientation } from '../../modules/scene-lighting/orientation-client'
import { createPartPreview, fitPartPreview } from './preview-state'
import { geometryKey, matchingModelJobs, partGeometryOptions, selectPartGeometry } from './geometry-options'
import { generationJobs, loadGenerationJobs } from '../generation/jobs'
import { sha256 } from '../generation/client'
import ImageCanvas from '../components/ImageCanvas.vue'
import SegmentedControl from '../components/SegmentedControl.vue'
import SceneViewControls from '../../modules/scene-lighting/SceneViewControls.vue'
import { addPartsToScene } from '../../modules/scene-lighting/store'
import LightingViewport from '../../modules/scene-lighting/LightingViewport.vue'
import LightSettings from '../../modules/scene-lighting/LightSettings.vue'
import SidebarSection from '../components/editor-shell/SidebarSection.vue'
import { SliderRow } from '../components/editor-shell/sidebar-atoms'
import InlineSwitch from '../components/InlineSwitch.vue'
import ScrollArea from '../components/ScrollArea.vue'
import InfoHint from '../components/InfoHint.vue'
import GeometrySelect from './GeometrySelect.vue'

const props=defineProps<{asset:PartAsset;origin:'slicer'|'scene'}>()
const initial=initializeComparison(clonePart(props.asset))
const {t}=useI18n(),router=useRouter(),draft=ref(initial),baseline=ref(clonePart(initial))
const candidate=computed(()=>optimizedVersion(draft.value)),original=computed(()=>originalVersion(draft.value))
const candidateCurrent=computed(()=>comparisonCurrent(draft.value)),appliedCandidate=computed(()=>candidateApplied(draft.value))
const editPart=computed(()=>candidate.value??draft.value),showComparison=ref(true),candidateNotice=ref('')
function useVersion(version:'original'|'optimized'){try{chooseModelVersion(draft.value,version)}catch(e){error.value=String(e)}}
watch(() => [...generatedModels.values()], () => {
  draft.value = resolvePartModels(draft.value)
  baseline.value = resolvePartModels(baseline.value)
}, { flush:'sync' })
const saving=ref(false),error=ref(''),view=ref<'original'|'normal'|'preview'>('preview'),normalUrl=ref(''),normalBusy=ref(false)
const confirming=ref(false),showGeneration=ref(false),aligning=ref(false)
const alignmentProgress=ref(0),repairing=ref(false),selectingModel=ref(false)
let alignmentController:AbortController|undefined,disposed=false
watch(candidateCurrent,current=>{if(!current)alignmentController?.abort()})
const geometrySelect=ref<InstanceType<typeof GeometrySelect>>()
async function applyGenerated(part:PartAsset){geometryChosen.value=true;if(await selectModelGeometry(part.geometry)){showGeneration.value=false;framePreview()}}
async function selectModelGeometry(geometry:PartGeometry){
  if(aligning.value||saving.value)return false
  if(geometryKey(draft.value.geometry)===geometryKey(geometry)&&draft.value.geometry.mesh?.sha256===geometry.mesh?.sha256)return true
  aligning.value=true;selectingModel.value=true;error.value=''
  const controller=new AbortController();alignmentController=controller
  const before=JSON.stringify(draft.value),copy=clonePart(draft.value)
  try{
    const {pixels}=await partPixels(copy)
    const height=copy.alignment.height??alignedBounds(copy,buildPartGeometry(copy,pixels)).height/copy.alignment.scale
    selectPartGeometry(copy,geometry);delete copy.modelComparison
    copy.alignment.height=height
    const selected=initializeComparison(copy,true);validatePart(selected)
    if(disposed||controller.signal.aborted||before!==JSON.stringify(draft.value))return false
    draft.value=selected;candidateNotice.value='';return true
  }catch(e){if(!controller.signal.aborted)error.value=String(e);return false}finally{aligning.value=false;selectingModel.value=false;alignmentController=undefined}
}
async function selectAlignedGeometry(){
  if(aligning.value||saving.value||!candidateCurrent.value)return false
  aligning.value=true;error.value='';candidateNotice.value='';alignmentProgress.value=0
  const controller=new AbortController();alignmentController=controller
  const before=JSON.stringify(draft.value),copy=clonePart(candidate.value??original.value)
  try{
    delete copy.geometry.original;delete copy.geometry.repair
    const {pixels}=await partPixels(copy),referenceRotation=orientationReference(copy.geometry)
    alignPartGeometry(copy,pixels)
    const fit=copy.geometry.imageFit!,source=buildPartGeometry({...copy,geometry:{...copy.geometry,imageFit:undefined}},pixels)
    const result=await searchOrientation(source,pixels,referenceRotation,controller.signal,value=>{alignmentProgress.value=value})
    fit.rotation=[...result.rotation];fit.projection=[...result.projection]
    fit.orientation={...result,rotation:[...result.rotation],projection:[...result.projection],meshSha256:copy.geometry.mesh!.sha256,method:ORIENTATION_METHOD,referenceRotation,alignmentKey:JSON.stringify(copy.alignment)}
    if(controller.signal.aborted||disposed||before!==JSON.stringify(draft.value)||!comparisonCurrent(draft.value))return false
    const next=clonePart(draft.value);storeCandidate(next,copy);validatePart(next);draft.value=next;showComparison.value=true;return true
  }catch(e){if(!controller.signal.aborted)error.value=String(e);return false}finally{aligning.value=false;alignmentController=undefined}
}
async function repairCurrentGeometry(){
  if(aligning.value||saving.value||!candidate.value||!candidateCurrent.value)return
  aligning.value=true;repairing.value=true;error.value=''
  const controller=new AbortController();alignmentController=controller
  const before=JSON.stringify(draft.value),copy=clonePart(candidate.value)
  try{
    delete copy.geometry.repair
    const {pixels}=await partPixels(copy),mesh=buildPartGeometry(copy,pixels),bounds=alignedBounds(copy,mesh)
    const spec=repairSpec(copy,pixels,[bounds.left,bounds.bottom,bounds.width,bounds.height])
    const result=await computeGeometryRepair(mesh,spec,controller.signal)
    spec.status=result.stats.status
    if(!disposed&&!controller.signal.aborted&&before===JSON.stringify(draft.value)&&comparisonCurrent(draft.value)){
      if(result.stats.status!=='repaired'){candidateNotice.value=t('parts.repairUnsupported');return}
      copy.geometry.repair=spec;const next=clonePart(draft.value);storeCandidate(next,copy);validatePart(next);draft.value=next;showComparison.value=true;candidateNotice.value=''
    }
  }catch(e){if(!controller.signal.aborted)error.value=String(e)}finally{aligning.value=false;repairing.value=false;alignmentController=undefined}
}
const repairCurrent=computed(()=>editPart.value.geometry.repair?.version===2&&editPart.value.geometry.repair.key===repairKey(editPart.value))
const orientationScore=computed(()=>{
  const g=editPart.value.geometry,fit=g.imageFit,result=fit?.orientation
  return result&&result.alignmentKey===JSON.stringify(editPart.value.alignment)&&result.meshSha256===g.mesh?.sha256&&JSON.stringify(result.rotation)===JSON.stringify(fit?.rotation)&&JSON.stringify(g.size)===JSON.stringify(fit?.size)&&JSON.stringify(result.projection)===JSON.stringify(fit?.projection)?result:undefined
})
const panel=ref<HTMLElement>(),previewAutoFit=ref(true)
const dirty=computed(()=>JSON.stringify(draft.value)!==JSON.stringify(baseline.value))
const conflict=computed(()=>partLibrary[props.asset.id]?.revision!==baseline.value.revision)
const geometryChosen=ref(false),inputHash=ref('')
const modelJobs=computed(()=>matchingModelJobs(generationJobs,inputHash.value))
const geometryOptions=computed(()=>partGeometryOptions(draft.value,modelJobs.value))
const geometryChoice=computed(()=>geometryKey(draft.value.geometry))
const hoveredGeometry=ref<string|null>(null)
// Viewport-only data: hover never changes draft, alternatives, dirty state or saved assets.
const previewPart=computed<PartAsset>(()=>{
  const geometry=geometryOptions.value.find(option=>geometryKey(option)===hoveredGeometry.value)
  if(!geometry||(geometryKey(geometry)===geometryChoice.value&&geometry.mesh?.sha256===draft.value.geometry.mesh?.sha256))return draft.value
  return {...draft.value,version:geometry.kind==='mesh'?2:draft.value.version,geometry:clonePart(geometry)}
})
function geometryLabel(geometry:PartGeometry){
  if(geometry.kind==='template')return t('sceneLight.'+geometry.template)+' · '+t('parts.template')
  if(geometry.kind==='mesh'){
    const models=geometryOptions.value.filter(option=>option.kind==='mesh')
    return t('generation.mesh')+(models.length>1?' '+(models.findIndex(option=>geometryKey(option)===geometryKey(geometry))+1):'')
  }
  return t('parts.'+geometry.kind)
}
const previewDefaults=createPartPreview(props.asset)
const preview=reactive(clonePart(previewDefaults))
const parameterDefaults=computed(()=>partParameterDefaults(editPart.value))
function framePreview(){
  previewAutoFit.value=true
  const canvas=panel.value?.querySelector('.part-preview canvas')
  const rect=canvas?.getBoundingClientRect()
  const aspect=rect&&rect.height>0?rect.width/rect.height:1
  if(candidate.value&&candidateCurrent.value&&showComparison.value)fitModelComparison(preview,original.value,candidate.value,aspect)
  else fitPartPreview(preview,previewPart.value,aspect)
}
const normals=createLatestTask<PartAsset,string>({interval:160,acceptIntermediate:true,onBusy:v=>{normalBusy.value=v},onError:e=>{error.value=String(e)},run:part=>normalImageUrl(part),apply:(url,part)=>{if(JSON.stringify(part.image)===JSON.stringify(draft.value.image))normalUrl.value=url}})
watch(()=>[view.value,draft.value.image,draft.value.normal],()=>{if(view.value==='normal')normals.request(clonePart(draft.value))},{deep:true})
function chooseGeometry(value:string){
  const geometry=geometryOptions.value.find(option=>geometryKey(option)===value)
  if(geometry){geometryChosen.value=true;void selectModelGeometry(geometry)}
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
  if(saving.value||aligning.value)return
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
  if(event.key==='Escape'&&geometrySelect.value?.close()){event.preventDefault();event.stopImmediatePropagation();return}
  if(showGeneration.value){if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();showGeneration.value=false}return}
  if(confirming.value)return
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();void leave()}
  else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopImmediatePropagation();void save()}
  else if(event.key==='Tab'&&panel.value){const elements=[...panel.value.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(el=>el.offsetParent!==null);const first=elements[0],last=elements.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}
}
const normalKeys=['normalStrength','shapeStrength','detailStrength','detailScale','shapeRadius','shapeSoftness','alphaThreshold'] as const
onMounted(()=>{framePreview();panel.value?.focus();document.addEventListener('keydown',captureKey,true);void loadGenerationJobs().catch(e=>{error.value=String(e)})})
onUnmounted(()=>{disposed=true;alignmentController?.abort();normals.dispose();document.removeEventListener('keydown',captureKey,true)})
</script>
<template>
  <Teleport to="body"><div class="part-editor-overlay"><section ref="panel" tabindex="-1" class="part-editor" role="dialog" aria-modal="true" :aria-label="t('parts.editor')">
    <header><div><strong>{{t('parts.editor')}}</strong><InfoHint :label="t('parts.edit')" :text="t('parts.sharedHint')"/><span>{{draft.name}} · {{draft.image.width}} × {{draft.image.height}} {{dirty?'●':''}}</span></div><button :disabled="saving||aligning" :aria-label="t('common.close')" @click="leave">✕</button></header>
    <div v-if="error||conflict" class="editor-error" role="alert">{{error||t('parts.conflict')}}</div>
    <div class="editor-body"><aside class="part-sidebar" :aria-label="t('parts.partSettings')">
      <div class="preview-controls">
        <SegmentedControl v-model="view" :options="(['original','normal','preview'] as const).map(value=>({value,label:t('parts.view.'+value)}))" role="group" :aria-label="t('parts.previewMode')"/>
        <SceneViewControls v-if="view==='preview'" :state="preview"/>
      </div>
      <div v-if="aligning" class="alignment-progress" role="status">{{t(selectingModel?'common.loading':repairing?'parts.repairing':'parts.aligning')}} <span v-if="!repairing&&!selectingModel">{{alignmentProgress}}%</span> <button @click="alignmentController?.abort()">{{t('common.cancel')}}</button></div>
      <ScrollArea class="part-properties-scroll" :label="t('parts.properties')"><fieldset class="part-properties" :disabled="saving||aligning">
      <SidebarSection :title="t('parts.asset')" :collapsible="false"><label class="name-field">{{t('parts.name')}}<input v-model="draft.name" maxlength="120" :aria-label="t('parts.name')"/></label></SidebarSection>
      <SidebarSection v-if="view==='preview'" :title="t('parts.geometry')" :collapsible="false">
        <GeometrySelect ref="geometrySelect" :part="draft" :model-value="geometryChoice" :options="geometryOptions.map(geometry=>({value:geometryKey(geometry),label:geometryLabel(geometry),geometry}))" :disabled="saving||aligning" @update:model-value="chooseGeometry" @preview="hoveredGeometry=$event" @generate="showGeneration=true"/>
        <button v-if="draft.geometry.kind==='mesh'" class="wide" :disabled="aligning||!candidateCurrent" @click="selectAlignedGeometry()">{{aligning?t('parts.aligning')+' '+alignmentProgress+'%':t('parts.autoAlign')}}</button>
        <template v-if="draft.modelComparison">
          <div class="version-choices" role="group" :aria-label="t('parts.modelVersion')">
            <button :aria-pressed="draft.modelComparison.selected==='original'" @click="useVersion('original')">{{t('parts.useOriginal')}}</button>
            <button :disabled="!candidate||!candidateCurrent" :aria-pressed="appliedCandidate" @click="useVersion('optimized')">{{t('parts.useOptimized')}}</button>
          </div>
          <InlineSwitch v-if="candidate&&candidateCurrent" v-model="showComparison" :label="t('parts.compareModels')" block/>
          <p class="note" role="status">{{t(!candidateCurrent?'parts.candidateStale':!candidate?'parts.noCandidate':appliedCandidate?'parts.usingCandidate':draft.modelComparison.selected==='optimized'?'parts.previousCandidateActive':'parts.candidateNotApplied')}}</p>
          <p v-if="candidateNotice" class="note" role="status">{{candidateNotice}}</p>
        </template>
        <p v-if="draft.geometry.kind==='mesh'" class="note">{{t('parts.autoAlignHint')}}</p>
        <p v-if="orientationScore" class="note">{{t('parts.contourMatch')}} {{(orientationScore.initialScore*100).toFixed(1)}}% → {{(orientationScore.score*100).toFixed(1)}}%</p>
        <p v-if="orientationScore?.reviewRequired" class="note" role="status">{{t('parts.orientationReview')}}</p>
        <template v-if="candidate&&candidateCurrent&&editPart.geometry.imageFit">
          <button class="wide" @click="repairCurrentGeometry">{{t('parts.repairGeometry')}}</button>
          <p class="note">{{t('parts.repairHint')}}</p>
          <p v-if="repairCurrent&&editPart.geometry.repair?.status&&editPart.geometry.repair.status!=='repaired'" class="note" role="status">{{t('parts.repairUnsupported')}}</p>
          <InlineSwitch v-if="editPart.geometry.repair&&repairCurrent" v-model="editPart.geometry.repair.enabled" :label="t('parts.repairEnabled')" block/>
          <p v-if="editPart.geometry.repair&&!repairCurrent" class="note">{{t('parts.repairStale')}}</p>
        </template>
        <template v-if="candidateCurrent&&editPart.geometry.imageFit?.rotation">
          <SliderRow v-for="(label,i) in ['parts.modelPitch','parts.modelYaw','parts.modelRoll']" :key="label" v-model="editPart.geometry.imageFit.rotation[i]" :default-value="editPart.geometry.imageFit.orientation?.rotation[i]??0" :label="t(label)" :min="-180" :max="180" :step="0.1" :precision="1" suffix="°"/>
        </template>
        <SliderRow :disabled="draft.geometry.kind==='mesh'&&(!candidate||!candidateCurrent)" v-for="(label,i) in ['parts.width','parts.height','parts.depth']" :key="label" v-model="editPart.geometry.size[i]" :default-value="parameterDefaults.geometry.size[i]" :label="t(label)" :min="0.02" :max="8" :step="0.01" :precision="2"/>
      </SidebarSection>
      <SidebarSection v-if="view==='preview'&&preview.mode==='sprites'&&(draft.geometry.kind!=='mesh'||(candidate&&candidateCurrent))" :title="t('parts.alignment')">
        <SliderRow v-model="editPart.alignment.anchor[0]" :default-value="parameterDefaults.alignment.anchor[0]" :label="t('parts.anchorX')" :min="0" :max="1" :step="0.01" :precision="2"/><SliderRow v-model="editPart.alignment.anchor[1]" :default-value="parameterDefaults.alignment.anchor[1]" :label="t('parts.anchorY')" :min="0" :max="1" :step="0.01" :precision="2"/>
        <SliderRow v-model="editPart.alignment.offset[0]" :default-value="0" :label="t('parts.offsetX')" :min="-4" :max="4" :step="0.01" :precision="2"/><SliderRow v-model="editPart.alignment.offset[1]" :default-value="0" :label="t('parts.offsetY')" :min="-4" :max="4" :step="0.01" :precision="2"/>
        <SliderRow v-model="editPart.alignment.scale" :default-value="1" :label="t('parts.imageScale')" :min="0.25" :max="3" :step="0.01" :precision="2"/>
      </SidebarSection>
      <SidebarSection v-if="view==='normal'||(view==='preview'&&preview.mode==='sprites')" :title="t('normal.generation')">
        <SliderRow v-for="key in normalKeys" :key="key" v-model="draft.normal[key]" :default-value="parameterDefaults.normal[key]" :label="t('normal.'+key)" :min="NORMAL_RANGES[key][0]" :max="NORMAL_RANGES[key][1]" :step="key==='alphaThreshold'?0.01:0.05" :precision="2"/>
        <SegmentedControl v-model="draft.normal.normalFormat" :label="t('normal.format')" :options="[{value:'opengl',label:'OpenGL'},{value:'directx',label:'DirectX'}]" role="group" :aria-label="t('normal.format')"/><InlineSwitch v-model="draft.normal.invertX" :label="t('normal.invertX')" block/><InlineSwitch v-model="draft.normal.invertY" :label="t('normal.invertY')" block/>
      </SidebarSection>
      <SidebarSection v-if="view==='preview'" :title="t('parts.previewOnly')" :collapsible="false">
        <SegmentedControl v-model="preview.scene" :label="t('sceneLight.environment')" :options="[{value:'open',label:t('sceneLight.open')},{value:'corner',label:t('sceneLight.corner')}]" role="group" :aria-label="t('sceneLight.environment')"/>
        <LightSettings :state="preview" :defaults="previewDefaults"/>
        <p class="view-hint">{{t('parts.previewScope')}}</p>
      </SidebarSection>
    </fieldset></ScrollArea></aside><main class="part-preview" :aria-label="t('parts.view.'+view)">
      <div v-if="view!=='preview'" class="flat-preview" :aria-busy="view==='normal'&&normalBusy">
        <ImageCanvas :src="view==='original'?partImageUrl(draft):normalUrl" :fullscreen-toggle="false" keep-view-on-src-change controls-position="bottom-left"/>
        <span v-if="view==='normal'&&normalBusy" class="preview-status" role="status">{{t('normal.generating')}}</span>
      </div>
      <ModelComparisonViewport v-else-if="candidate&&candidateCurrent&&showComparison&&!hoveredGeometry" :original="original" :candidate="candidate" :state="preview" :fit-view="framePreview" :auto-fit="previewAutoFit" @interact="previewAutoFit=false"/>
      <LightingViewport v-else :state="preview" :assets="[previewPart]" compact :editable="false" :controls="false" :fit-view="framePreview" :auto-fit="previewAutoFit" @zoom="previewAutoFit=false" @pan="previewAutoFit=false"/>
    </main></div>
    <footer><div class="button-row"><button :disabled="saving||aligning" @click="exportAsset">{{t('parts.exportAsset')}}</button><button :disabled="saving||aligning" @click="exportPackage">{{t('parts.exportPackage')}}</button><button v-if="origin==='scene'" :disabled="saving||aligning" @click="locate">{{t('parts.locateSlicer')}}</button></div><div class="button-row"><button :disabled="saving||aligning" @click="addToScene">{{t('parts.addOne')}}</button><button :disabled="saving||aligning" @click="leave">{{t(origin==='scene'?'parts.backScene':'parts.backSlicer')}}</button><button class="primary" :disabled="saving||aligning||conflict" @click="saveAndClose">{{t(saving?'common.loading':'parts.saveReturn')}}</button></div></footer>
  </section></div><div v-if="showGeneration" class="generation-overlay"><GenerationPanel :part="draft" :origin="origin" @apply="applyGenerated" @close="showGeneration=false"/></div></Teleport>
</template>
<style scoped>
.version-choices{display:flex;gap:6px;margin-top:8px}.version-choices button{flex:1}.version-choices button[aria-pressed="true"]{background:#426b53;border-color:#84ab8d}
.alignment-progress{padding:8px 10px;font-size:11px;color:#b8d3c1;display:flex;align-items:center;justify-content:space-between}
.generation-overlay{position:fixed;inset:4vh 3vw;z-index:1800;border:1px solid #555;border-radius:9px;overflow:hidden;box-shadow:0 0 0 100vmax #0009}
.part-editor-overlay{position:fixed;inset:0;z-index:1700;background:#000b;display:flex;align-items:center;justify-content:center}.part-editor{width:min(1300px,96vw);height:92vh;display:flex;flex-direction:column;background:#202526;border:1px solid #56625b;border-radius:9px;overflow:hidden;color:#d6ded9;outline:none;box-shadow:0 15px 70px #0008}.part-editor header{display:flex;align-items:center;justify-content:space-between;padding:12px 15px;background:#2a3230}.part-editor header>div{display:flex;gap:16px;align-items:center}.part-editor header span{font-size:12px;color:#a8b5ad}.part-editor button{font:inherit;font-size:11px;color:inherit;cursor:pointer;border:1px solid #536058;border-radius:4px;background:#303c35;padding:7px 10px}.part-editor button:disabled{opacity:.45;cursor:default}.part-editor button.primary{background:#426b53;border-color:#84ab8d}.editor-body{display:flex;flex:1;min-height:0}.part-sidebar{display:flex;flex-direction:column;flex:0 0 285px;width:285px;min-width:0;min-height:0;border-right:1px solid #333}.part-properties-scroll{flex:1;min-height:0}.preview-controls{padding:12px 10px;display:flex;flex-direction:column;gap:10px;border-bottom:1px solid #39443c;background:#252e29}.preview-controls :deep(.seg-control){flex-wrap:wrap}.preview-controls :deep(.seg-label){flex-basis:100%}.view-hint{font-size:11px;line-height:1.6;color:#9eafa4;margin:0}.part-properties{width:100%;min-width:0;padding:0;margin:0;border:0;box-sizing:border-box}.name-field{display:flex;flex-direction:column;font-size:11px;gap:7px}.name-field input,select{box-sizing:border-box;width:100%;border:1px solid #4c5850;border-radius:4px;padding:7px;background:#2b3330;color:#e0e8e1;font-size:12px}.note{font-size:10px;color:#a0b0a5;line-height:1.6;margin:8px 0}.approximation{color:#d5bd8b}.button-row{display:flex;gap:6px;flex-wrap:wrap}.wide{width:100%;margin-top:7px}.part-preview{display:flex;flex-direction:column;min-width:0;flex:1}.flat-preview{position:relative;flex:1;min-height:0;display:flex;overflow:hidden}.preview-status{position:absolute;top:12px;left:12px;padding:6px;background:#222b;font-size:11px;pointer-events:none}.part-caption{font-size:10px;padding:8px 12px;color:#9dab9f;background:#202923}.part-editor footer{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:10px 13px;border-top:1px solid #46534a;background:#28322c}.editor-error{font-size:11px;padding:8px 14px;background:#512b28;color:#ffd4c6;overflow-wrap:anywhere}@media(max-width:800px){.part-sidebar{flex-basis:250px;width:250px}.part-editor header>div{gap:7px;flex-wrap:wrap}.part-editor footer{padding:7px}.part-editor button{padding:6px;font-size:10px}}@media(max-width:560px){.editor-body{flex-direction:column;overflow:auto}.part-sidebar{width:100%;flex-basis:260px;height:260px;flex-shrink:0}.part-preview{min-height:380px}.part-editor{height:96vh}}
</style>
