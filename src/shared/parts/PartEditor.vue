<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from '../i18n'
import { normalSettings, NORMAL_RANGES, DEFAULT_NORMAL_SETTINGS } from '../types/normal-settings'
import { clonePart, validatePart, TEMPLATE_IDS, type PartAsset } from './schema'
import { partLibrary, savePart } from './library'
import { partImageUrl, normalImageUrl, portablePart } from './images'
import { closePartEditor, openPartEditor } from './editor-session'
import { openPartInSlicer } from './slicer-bridge'
import { createLatestTask } from '../utils/latest-task'
import { downloadBlob } from '../utils/download'
import { confirm } from '../components/confirm'
import { createPartPreview, fitPartPreview, changePartGeometry } from './preview-state'
import SvgIcon from '../icons/SvgIcon.vue'
import { addPartsToScene } from '../../modules/scene-lighting/store'
import LightingViewport from '../../modules/scene-lighting/LightingViewport.vue'
import SidebarSection from '../components/editor-shell/SidebarSection.vue'
import { SliderRow } from '../components/editor-shell/sidebar-atoms'
import InlineSwitch from '../components/InlineSwitch.vue'
import ScrollArea from '../components/ScrollArea.vue'
import InfoHint from '../components/InfoHint.vue'

const props=defineProps<{asset:PartAsset;origin:'slicer'|'scene'}>()
const {t}=useI18n(),router=useRouter(),draft=ref(clonePart(props.asset)),baseline=ref(clonePart(props.asset))
const saving=ref(false),error=ref(''),view=ref<'original'|'normal'|'preview'>('preview'),normalUrl=ref(''),normalBusy=ref(false)
const confirming=ref(false)
const geometryJson=ref(JSON.stringify(draft.value.geometry,null,2)),panel=ref<HTMLElement>()
const dirty=computed(()=>JSON.stringify(draft.value)!==JSON.stringify(baseline.value))
const conflict=computed(()=>partLibrary[props.asset.id]?.revision!==baseline.value.revision)
const geometryChoice=computed(()=>draft.value.geometry.kind==='template'?'template:'+draft.value.geometry.template:draft.value.geometry.kind)
const preview=reactive(createPartPreview(props.asset))
function framePreview(){
  const canvas=panel.value?.querySelector('.part-preview canvas')
  const rect=canvas?.getBoundingClientRect()
  fitPartPreview(preview,draft.value,rect&&rect.height>0?rect.width/rect.height:1)
}
const normals=createLatestTask<PartAsset,string>({interval:160,acceptIntermediate:true,onBusy:v=>{normalBusy.value=v},onError:e=>{error.value=String(e)},run:part=>normalImageUrl(part),apply:url=>{normalUrl.value=url}})
watch(()=>[view.value,draft.value.normal],()=>{if(view.value==='normal')normals.request(clonePart(draft.value))},{deep:true})
function chooseGeometry(event:Event){
  const value=(event.target as HTMLSelectElement).value
  changePartGeometry(draft.value,value)
  geometryJson.value=JSON.stringify(draft.value.geometry,null,2)
}
function applyGeometry(){
  try{const geometry=JSON.parse(geometryJson.value);const next={...clonePart(draft.value),geometry};validatePart(next);draft.value=next;error.value=''}catch(e){error.value=String(e)}
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
    <div class="editor-body"><ScrollArea class="part-properties-scroll" :label="t('parts.partSettings')"><fieldset class="part-properties" :disabled="saving">
      <SidebarSection :title="t('parts.asset')" :collapsible="false"><label class="name-field">{{t('parts.name')}}<input v-model="draft.name" maxlength="120" :aria-label="t('parts.name')"/></label></SidebarSection>
      <SidebarSection :title="t('parts.geometry')" :collapsible="false">
        <select :value="geometryChoice" :aria-label="t('parts.geometryType')" @change="chooseGeometry"><option value="silhouette">{{t('parts.silhouette')}}</option><option value="box">{{t('parts.box')}}</option><option value="cylinder">{{t('parts.cylinder')}}</option><option v-for="id in TEMPLATE_IDS" :key="id" :value="'template:'+id">{{t('sceneLight.'+id)}} · {{t('parts.template')}}</option><option v-if="draft.geometry.kind==='compound'" value="compound">{{t('parts.compound')}}</option></select>
        <InfoHint :label="t('parts.geometry')" :text="t(draft.geometry.kind==='silhouette'?'parts.silhouetteNote':'parts.geometryHint')"/>
        <SliderRow v-for="(label,i) in ['parts.width','parts.height','parts.depth']" :key="label" v-model="draft.geometry.size[i]" :label="t(label)" :min="0.02" :max="8" :step="0.01" :precision="2"/>
        <details><summary>{{t('parts.geometryJson')}}</summary><textarea v-model="geometryJson" spellcheck="false" :aria-label="t('parts.geometryJson')"/><div class="button-row"><button @click="geometryJson=JSON.stringify(draft.geometry,null,2)">{{t('parts.readConfig')}}</button><button @click="applyGeometry">{{t('parts.applyConfig')}}</button></div></details>
      </SidebarSection>
      <SidebarSection :title="t('parts.alignment')">
        <SliderRow v-model="draft.alignment.anchor[0]" :label="t('parts.anchorX')" :min="0" :max="1" :step="0.01" :precision="2"/><SliderRow v-model="draft.alignment.anchor[1]" :label="t('parts.anchorY')" :min="0" :max="1" :step="0.01" :precision="2"/>
        <SliderRow v-model="draft.alignment.offset[0]" :label="t('parts.offsetX')" :min="-4" :max="4" :step="0.01" :precision="2"/><SliderRow v-model="draft.alignment.offset[1]" :label="t('parts.offsetY')" :min="-4" :max="4" :step="0.01" :precision="2"/>
        <SliderRow v-model="draft.alignment.scale" :label="t('parts.imageScale')" :min="0.25" :max="3" :step="0.01" :precision="2"/>
      </SidebarSection>
      <SidebarSection :title="t('normal.currentSprite')">
        <SliderRow v-for="key in normalKeys" :key="key" v-model="draft.normal[key]" :label="t('normal.'+key)" :min="NORMAL_RANGES[key][0]" :max="NORMAL_RANGES[key][1]" :step="key==='alphaThreshold'?0.01:0.05" :precision="2"/>
        <label class="name-field">{{t('normal.format')}}<select v-model="draft.normal.normalFormat" :aria-label="t('normal.format')"><option value="opengl">OpenGL</option><option value="directx">DirectX</option></select></label><InlineSwitch v-model="draft.normal.invertX" :label="t('normal.invertX')" block/><InlineSwitch v-model="draft.normal.invertY" :label="t('normal.invertY')" block/>
        <button class="wide" @click="draft.normal=normalSettings(DEFAULT_NORMAL_SETTINGS)">{{t('normal.reset')}}</button>
      </SidebarSection>
      <SidebarSection :title="t('parts.previewOnly')" :collapsible="false">
        <select v-model="preview.scene" :aria-label="t('sceneLight.environment')"><option value="open">{{t('sceneLight.open')}}</option><option value="corner">{{t('sceneLight.corner')}}</option></select>
        <SliderRow v-model="preview.light[1]" :label="t('sceneLight.lightHeight')" :min="0.5" :max="8" :step="0.1" :precision="1"/><SliderRow v-model="preview.power" :label="t('sceneLight.power')" :min="0" :max="60" :step="1" :precision="0"/><SliderRow v-model="preview.ambient" :label="t('sceneLight.ambient')" :min="0" :max="1" :step="0.01" :precision="2"/><InlineSwitch v-model="preview.shadows" :label="t('sceneLight.shadows')" block/>
      </SidebarSection>
    </fieldset></ScrollArea><main class="part-preview"><nav :aria-label="t('parts.previewMode')"><button v-for="v in (['original','normal','preview'] as const)" :key="v" :aria-pressed="view===v" :class="{active:view===v}" @click="view=v">{{t('parts.view.'+v)}}</button></nav>
      <div v-if="view!=='preview'" class="flat-preview"><img v-if="view==='original'" :src="partImageUrl(draft)" :alt="draft.name"/><img v-else-if="normalUrl" :src="normalUrl" :alt="t('normal.map')"/><span v-if="view==='normal'&&normalBusy" role="status">{{t('normal.generating')}}</span></div>
      <LightingViewport v-else :state="preview" :assets="[draft]" compact :editable="false"><template #actions><button :title="t('common.fitView')" :aria-label="t('common.fitView')" @click="framePreview"><SvgIcon name="fit-view" :size="13"/></button></template></LightingViewport>
    </main></div>
    <footer><div class="button-row"><button :disabled="saving" @click="exportAsset">{{t('parts.exportAsset')}}</button><button :disabled="saving" @click="exportPackage">{{t('parts.exportPackage')}}</button><button v-if="origin==='scene'" :disabled="saving" @click="locate">{{t('parts.locateSlicer')}}</button></div><div class="button-row"><button :disabled="saving" @click="addToScene">{{t('parts.addOne')}}</button><button :disabled="saving" @click="leave">{{t(origin==='scene'?'parts.backScene':'parts.backSlicer')}}</button><button class="primary" :disabled="saving||conflict" @click="saveAndClose">{{t(saving?'common.loading':'parts.saveReturn')}}</button></div></footer>
  </section></div></Teleport>
</template>
<style scoped>
.part-editor-overlay{position:fixed;inset:0;z-index:1700;background:#000b;display:flex;align-items:center;justify-content:center}.part-editor{width:min(1300px,96vw);height:92vh;display:flex;flex-direction:column;background:#202526;border:1px solid #56625b;border-radius:9px;overflow:hidden;color:#d6ded9;outline:none;box-shadow:0 15px 70px #0008}.part-editor header{display:flex;align-items:center;justify-content:space-between;padding:12px 15px;background:#2a3230}.part-editor header>div{display:flex;gap:16px;align-items:center}.part-editor header span{font-size:12px;color:#a8b5ad}.part-editor button{font:inherit;font-size:11px;color:inherit;cursor:pointer;border:1px solid #536058;border-radius:4px;background:#303c35;padding:7px 10px}.part-editor button:disabled{opacity:.45;cursor:default}.part-editor button.primary{background:#426b53;border-color:#84ab8d}.editor-body{display:flex;flex:1;min-height:0}.part-properties-scroll{flex:0 0 285px;width:285px;min-width:0;border-right:1px solid #333}.part-properties{width:100%;min-width:0;padding:0;margin:0;border:0;box-sizing:border-box}.name-field{display:flex;flex-direction:column;font-size:11px;gap:7px}.name-field input,select,textarea{box-sizing:border-box;width:100%;border:1px solid #4c5850;border-radius:4px;padding:7px;background:#2b3330;color:#e0e8e1;font-size:12px}textarea{scrollbar-width:thin;scrollbar-color:#63736a #2b3330;height:150px;font:11px/1.5 monospace;margin-top:8px;resize:vertical}.note{font-size:10px;color:#a0b0a5;line-height:1.6;margin:8px 0}.approximation{color:#d5bd8b}.button-row{display:flex;gap:6px;flex-wrap:wrap}summary{font-size:11px;color:#b1c5b7;cursor:pointer;margin:10px 0}.wide{width:100%;margin-top:7px}.part-preview{display:flex;flex-direction:column;min-width:0;flex:1}.part-preview nav{display:flex;gap:5px;padding:8px 12px;background:#252e29;border-bottom:1px solid #39443c}.part-preview nav button.active{background:#47644e;border-color:#8db394}.flat-preview{position:relative;flex:1;min-height:0;display:flex;justify-content:center;align-items:center;padding:20px;background:repeating-conic-gradient(#303633 0 25%,#252b28 0 50%) 0/16px 16px}.flat-preview img{max-width:100%;max-height:100%;object-fit:contain;image-rendering:pixelated}.flat-preview span{position:absolute;top:12px;left:12px;padding:6px;background:#222b}.part-caption{font-size:10px;padding:8px 12px;color:#9dab9f;background:#202923}.part-editor footer{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:10px 13px;border-top:1px solid #46534a;background:#28322c}.editor-error{font-size:11px;padding:8px 14px;background:#512b28;color:#ffd4c6;overflow-wrap:anywhere}@media(max-width:800px){.part-properties-scroll{flex-basis:230px;width:230px}.part-editor header>div{gap:7px;flex-wrap:wrap}.part-editor footer{padding:7px}.part-editor button{padding:6px;font-size:10px}}@media(max-width:560px){.editor-body{flex-direction:column;overflow:auto}.part-properties-scroll{width:100%;flex-basis:220px;height:220px;flex-shrink:0}.part-preview{min-height:380px}.part-editor{height:96vh}}
</style>
