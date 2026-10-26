<script setup lang="ts">
import GenerationPanel from '../generation/GenerationPanel.vue'
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from '../i18n'
import { NORMAL_RANGES } from '../types/normal-settings'
import { clonePart, validatePart, TEMPLATE_IDS, type PartAsset } from './schema'
import { partLibrary, savePart } from './library'
import { partImageUrl, normalImageUrl, portablePart } from './images'
import { closePartEditor, openPartEditor } from './editor-session'
import { openPartInSlicer } from './slicer-bridge'
import { createLatestTask } from '../utils/latest-task'
import { downloadBlob } from '../utils/download'
import { confirm } from '../components/confirm'
import { partParameterDefaults } from './parameter-defaults'
import { createPartPreview, fitPartPreview, changePartGeometry } from './preview-state'
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

const props=defineProps<{asset:PartAsset;origin:'slicer'|'scene'}>()
const {t}=useI18n(),router=useRouter(),draft=ref(clonePart(props.asset)),baseline=ref(clonePart(props.asset))
const saving=ref(false),error=ref(''),view=ref<'original'|'normal'|'preview'>('preview'),normalUrl=ref(''),normalBusy=ref(false)
const confirming=ref(false),showGeneration=ref(false)
function applyGenerated(part:PartAsset){draft.value=clonePart(part);showGeneration.value=false;framePreview()}
const panel=ref<HTMLElement>(),previewAutoFit=ref(true)
const dirty=computed(()=>JSON.stringify(draft.value)!==JSON.stringify(baseline.value))
const conflict=computed(()=>partLibrary[props.asset.id]?.revision!==baseline.value.revision)
const geometryChoice=computed(()=>draft.value.geometry.kind==='template'?'template:'+draft.value.geometry.template:draft.value.geometry.kind)
const previewDefaults=createPartPreview(props.asset)
const preview=reactive(clonePart(previewDefaults))
const parameterDefaults=computed(()=>partParameterDefaults(draft.value))
function framePreview(){
  previewAutoFit.value=true
  const canvas=panel.value?.querySelector('.part-preview canvas')
  const rect=canvas?.getBoundingClientRect()
  fitPartPreview(preview,draft.value,rect&&rect.height>0?rect.width/rect.height:1)
}
const normals=createLatestTask<PartAsset,string>({interval:160,acceptIntermediate:true,onBusy:v=>{normalBusy.value=v},onError:e=>{error.value=String(e)},run:part=>normalImageUrl(part),apply:(url,part)=>{if(JSON.stringify(part.image)===JSON.stringify(draft.value.image))normalUrl.value=url}})
watch(()=>[view.value,draft.value.image,draft.value.normal],()=>{if(view.value==='normal')normals.request(clonePart(draft.value))},{deep:true})
function chooseGeometry(event:Event){
  const value=(event.target as HTMLSelectElement).value
  changePartGeometry(draft.value,value)
}
async function save():Promise<PartAsset|undefined>{
  if(saving.value)return
  saving.value=true;error.value=''
  try{validatePart(draft.value);const result=dirty.value?await savePart(clonePart(draft.value),baseline.value.revision):partLibrary[draft.value.id]??draft.value;baseline.value=clonePart(result);draft.value=clonePart(result);return result}catch(e){error.value=String(e)}finally{saving.value=false}
}
async function leave(){if(saving.value||confirming.value)return;if(dirty.value){confirming.value=true;const discard=await confirm({title:t('parts.discardTitle'),message:t('parts.discardMessage'),confirmText:t('parts.discard')});confirming.value=false;if(!discard)return}closePartEditor()}
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
  if(showGeneration.value){if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();showGeneration.value=false}return}
  if(confirming.value)return
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();void leave()}
  else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopImmediatePropagation();void save()}
  else if(event.key==='Tab'&&panel.value){const elements=[...panel.value.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(el=>el.offsetParent!==null);const first=elements[0],last=elements.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}
}
const normalKeys=['normalStrength','shapeStrength','detailStrength','detailScale','shapeRadius','shapeSoftness','alphaThreshold'] as const
onMounted(()=>{framePreview();panel.value?.focus();document.addEventListener('keydown',captureKey,true)})
onUnmounted(()=>{normals.dispose();document.removeEventListener('keydown',captureKey,true)})
</script>
<template>
  <Teleport to="body"><div class="part-editor-overlay"><section ref="panel" tabindex="-1" class="part-editor" role="dialog" aria-modal="true" :aria-label="t('parts.editor')">
    <header><div><strong>{{t('parts.editor')}}</strong><InfoHint :label="t('parts.edit')" :text="t('parts.sharedHint')"/><span>{{draft.name}} · {{draft.image.width}} × {{draft.image.height}} {{dirty?'●':''}}</span></div><button :disabled="saving" :aria-label="t('common.close')" @click="leave">✕</button></header>
    <div v-if="error||conflict" class="editor-error" role="alert">{{error||t('parts.conflict')}}</div>
    <div class="editor-body"><aside class="part-sidebar" :aria-label="t('parts.partSettings')">
      <div class="preview-controls">
        <SegmentedControl v-model="view" :options="(['original','normal','preview'] as const).map(value=>({value,label:t('parts.view.'+value)}))" role="group" :aria-label="t('parts.previewMode')"/>
        <SceneViewControls v-if="view==='preview'" :state="preview"/>
      </div>
      <ScrollArea class="part-properties-scroll" :label="t('parts.properties')"><fieldset class="part-properties" :disabled="saving">
      <SidebarSection :title="t('parts.asset')" :collapsible="false"><label class="name-field">{{t('parts.name')}}<input v-model="draft.name" maxlength="120" :aria-label="t('parts.name')"/></label></SidebarSection>
      <SidebarSection v-if="view==='preview'" :title="t('parts.geometry')" :collapsible="false">
        <select :value="geometryChoice" :aria-label="t('parts.geometryType')" @change="chooseGeometry"><option value="silhouette">{{t('parts.silhouette')}}</option><option value="box">{{t('parts.box')}}</option><option value="cylinder">{{t('parts.cylinder')}}</option><option v-for="id in TEMPLATE_IDS" :key="id" :value="'template:'+id">{{t('sceneLight.'+id)}} · {{t('parts.template')}}</option><option v-if="draft.geometry.kind==='mesh'" value="mesh">{{t('generation.mesh')}}</option><option v-if="draft.geometry.kind==='compound'" value="compound">{{t('parts.compound')}}</option></select>
        <button class="wide" @click="showGeneration=true">{{t('generation.fromImage')}}</button>
        <InfoHint :label="t('parts.geometry')" :text="t(draft.geometry.kind==='silhouette'?'parts.silhouetteNote':'parts.geometryHint')"/>
        <SliderRow v-for="(label,i) in ['parts.width','parts.height','parts.depth']" :key="label" v-model="draft.geometry.size[i]" :default-value="parameterDefaults.geometry.size[i]" :label="t(label)" :min="0.02" :max="8" :step="0.01" :precision="2"/>
      </SidebarSection>
      <SidebarSection v-if="view==='preview'&&preview.mode==='sprites'" :title="t('parts.alignment')">
        <SliderRow v-model="draft.alignment.anchor[0]" :default-value="parameterDefaults.alignment.anchor[0]" :label="t('parts.anchorX')" :min="0" :max="1" :step="0.01" :precision="2"/><SliderRow v-model="draft.alignment.anchor[1]" :default-value="parameterDefaults.alignment.anchor[1]" :label="t('parts.anchorY')" :min="0" :max="1" :step="0.01" :precision="2"/>
        <SliderRow v-model="draft.alignment.offset[0]" :default-value="0" :label="t('parts.offsetX')" :min="-4" :max="4" :step="0.01" :precision="2"/><SliderRow v-model="draft.alignment.offset[1]" :default-value="0" :label="t('parts.offsetY')" :min="-4" :max="4" :step="0.01" :precision="2"/>
        <SliderRow v-model="draft.alignment.scale" :default-value="1" :label="t('parts.imageScale')" :min="0.25" :max="3" :step="0.01" :precision="2"/>
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
      <LightingViewport v-else :state="preview" :assets="[draft]" compact :editable="false" :controls="false" :fit-view="framePreview" :auto-fit="previewAutoFit" @zoom="previewAutoFit=false"/>
    </main></div>
    <footer><div class="button-row"><button :disabled="saving" @click="exportAsset">{{t('parts.exportAsset')}}</button><button :disabled="saving" @click="exportPackage">{{t('parts.exportPackage')}}</button><button v-if="origin==='scene'" :disabled="saving" @click="locate">{{t('parts.locateSlicer')}}</button></div><div class="button-row"><button :disabled="saving" @click="addToScene">{{t('parts.addOne')}}</button><button :disabled="saving" @click="leave">{{t(origin==='scene'?'parts.backScene':'parts.backSlicer')}}</button><button class="primary" :disabled="saving||conflict" @click="saveAndClose">{{t(saving?'common.loading':'parts.saveReturn')}}</button></div></footer>
  </section></div><div v-if="showGeneration" class="generation-overlay"><GenerationPanel :part="draft" @apply="applyGenerated" @close="showGeneration=false"/></div></Teleport>
</template>
<style scoped>
.generation-overlay{position:fixed;inset:4vh 3vw;z-index:1800;border:1px solid #555;border-radius:9px;overflow:hidden;box-shadow:0 0 0 100vmax #0009}
.part-editor-overlay{position:fixed;inset:0;z-index:1700;background:#000b;display:flex;align-items:center;justify-content:center}.part-editor{width:min(1300px,96vw);height:92vh;display:flex;flex-direction:column;background:#202526;border:1px solid #56625b;border-radius:9px;overflow:hidden;color:#d6ded9;outline:none;box-shadow:0 15px 70px #0008}.part-editor header{display:flex;align-items:center;justify-content:space-between;padding:12px 15px;background:#2a3230}.part-editor header>div{display:flex;gap:16px;align-items:center}.part-editor header span{font-size:12px;color:#a8b5ad}.part-editor button{font:inherit;font-size:11px;color:inherit;cursor:pointer;border:1px solid #536058;border-radius:4px;background:#303c35;padding:7px 10px}.part-editor button:disabled{opacity:.45;cursor:default}.part-editor button.primary{background:#426b53;border-color:#84ab8d}.editor-body{display:flex;flex:1;min-height:0}.part-sidebar{display:flex;flex-direction:column;flex:0 0 285px;width:285px;min-width:0;min-height:0;border-right:1px solid #333}.part-properties-scroll{flex:1;min-height:0}.preview-controls{padding:12px 10px;display:flex;flex-direction:column;gap:10px;border-bottom:1px solid #39443c;background:#252e29}.preview-controls :deep(.seg-control){flex-wrap:wrap}.preview-controls :deep(.seg-label){flex-basis:100%}.view-hint{font-size:11px;line-height:1.6;color:#9eafa4;margin:0}.part-properties{width:100%;min-width:0;padding:0;margin:0;border:0;box-sizing:border-box}.name-field{display:flex;flex-direction:column;font-size:11px;gap:7px}.name-field input,select{box-sizing:border-box;width:100%;border:1px solid #4c5850;border-radius:4px;padding:7px;background:#2b3330;color:#e0e8e1;font-size:12px}.note{font-size:10px;color:#a0b0a5;line-height:1.6;margin:8px 0}.approximation{color:#d5bd8b}.button-row{display:flex;gap:6px;flex-wrap:wrap}.wide{width:100%;margin-top:7px}.part-preview{display:flex;flex-direction:column;min-width:0;flex:1}.flat-preview{position:relative;flex:1;min-height:0;display:flex;overflow:hidden}.preview-status{position:absolute;top:12px;left:12px;padding:6px;background:#222b;font-size:11px;pointer-events:none}.part-caption{font-size:10px;padding:8px 12px;color:#9dab9f;background:#202923}.part-editor footer{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:10px 13px;border-top:1px solid #46534a;background:#28322c}.editor-error{font-size:11px;padding:8px 14px;background:#512b28;color:#ffd4c6;overflow-wrap:anywhere}@media(max-width:800px){.part-sidebar{flex-basis:250px;width:250px}.part-editor header>div{gap:7px;flex-wrap:wrap}.part-editor footer{padding:7px}.part-editor button{padding:6px;font-size:10px}}@media(max-width:560px){.editor-body{flex-direction:column;overflow:auto}.part-sidebar{width:100%;flex-basis:260px;height:260px;flex-shrink:0}.part-preview{min-height:380px}.part-editor{height:96vh}}
</style>
