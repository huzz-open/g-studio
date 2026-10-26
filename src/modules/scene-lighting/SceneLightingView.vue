<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import SidebarSection from '../../shared/components/editor-shell/SidebarSection.vue'
import { SliderRow } from '../../shared/components/editor-shell/sidebar-atoms'
import SegmentedControl from '../../shared/components/SegmentedControl.vue'
import InlineSwitch from '../../shared/components/InlineSwitch.vue'
import { useI18n } from '../../shared/i18n'
import { downloadBlob } from '../../shared/utils/download'
import { prompt } from '../../shared/components/prompt'
import { EditorShell, definePanelConfig } from '../../shared/components/editor-shell'
import ScrollArea from '../../shared/components/ScrollArea.vue'
import SvgIcon from '../../shared/icons/SvgIcon.vue'
import PartPalette from './PartPalette.vue'
import SceneViewControls from './SceneViewControls.vue'
import { clonePart, validatePart, type PartAsset } from '../../shared/parts/schema'
import { importPart, partLibrary, libraryError } from '../../shared/parts/library'
import { partImageUrl, portablePart } from '../../shared/parts/images'
import { openPartEditor } from '../../shared/parts/editor-session'
import { useSceneTabs, initializeScene, newSceneTab, closeSceneTab, reopenSceneTab, renameSceneTab, closedScenes, emptyScene, addPartsToScene, removeSceneItem, sceneHistory, parseScene, sceneStorageError } from './store'
import { partMovementLimits } from './part-geometry'
import { roomBounds, DEFAULT_ROOM, DEFAULT_SCENE_ID } from './model'
import LightingViewport from './LightingViewport.vue'
import LightSettings from './LightSettings.vue'

const { t } = useI18n(), error = ref(''), busy = ref(false), importInput = ref<HTMLInputElement>()
const search = ref(''), leftCollapsed = ref(false)
const showShadowPoints = ref(false)
const manager = useSceneTabs(), fallback = emptyScene()
const history = computed(()=>manager.activeInstance.value ? sceneHistory(manager.activeInstance.value) : null)
const state = computed(() => manager.activeInstance.value?.state ?? fallback)
const tabs = computed(() => manager.instances.value.map(doc => ({id: doc.id, label: doc.id === DEFAULT_SCENE_ID ? t('parts.defaultScene') : doc.name, closable: doc.id !== DEFAULT_SCENE_ID})))
const leftPanel = definePanelConfig('scene-lighting-sidebar-width', 300)
const rightPanel = definePanelConfig('scene-lighting-properties-width', 260)
const viewport = ref<InstanceType<typeof LightingViewport>>()
function dropPart(part:PartAsset,x:number,y:number){const point=viewport.value?.dropPoint(x,y);if(point)void add([part],point)}
const selected = computed(() => state.value.items.find(i => i.id === state.value.selected))
const asset = computed(() => selected.value ? partLibrary[selected.value.assetId] : undefined)
const limits = computed(() => partMovementLimits(asset.value, selected.value?.scale,state.value.room))
const assets = computed(() => [...new Set(state.value.items.map(i=>i.assetId))].map(id=>partLibrary[id]).filter((a): a is PartAsset => !!a))
const library = computed(() => Object.values(partLibrary).filter(p => p.name.toLowerCase().includes(search.value.toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name)))
const bounds=computed(()=>roomBounds(state.value.room))
const objectX=computed({get:()=>(selected.value?.x??bounds.value.minX)-bounds.value.minX,set:v=>{if(selected.value)selected.value.x=v+bounds.value.minX}})
const objectZ=computed({get:()=>(selected.value?.z??bounds.value.minZ)-bounds.value.minZ,set:v=>{if(selected.value)selected.value.z=v+bounds.value.minZ}})
const missing = computed(() => state.value.items.filter(i=>!partLibrary[i.assetId]))
function edit(id?: string) { if(id && partLibrary[id]) openPartEditor({assetId:id,origin:'scene'}) }
function revealItems(){history.value?.batch(()=>state.value.items.forEach(item=>{item.visible=true}))}
function changeScene(value:string){if(value==='open'||value==='corner')state.value.scene=value}
async function add(parts: PartAsset[], point?: {x:number;z:number}) { error.value='';try { await addPartsToScene(parts,manager.activeTabId.value??undefined,point) } catch(e){error.value=String(e)} }
async function newTab() { await newSceneTab() }
async function renameTab(id: string) {
  if (id === DEFAULT_SCENE_ID) return
  const doc=manager.instances.value.find(d=>d.id===id);if(!doc)return
  const name=await prompt({title:t('parts.renameScene'),defaultValue:doc.name})
  if(name)renameSceneTab(id,name)
}
async function exportScene() {
  busy.value=true;error.value=''
  try { const snapshot=clonePart(state.value),name=manager.activeInstance.value?.name??'scene',parts=await Promise.all(assets.value.map(portablePart));downloadBlob(new Blob([JSON.stringify({format:'g-studio/scene',version:2,name,scene:snapshot,assets:parts},null,2)],{type:'application/json'}),name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')+'.scene.json') }
  catch(e){error.value=String(e)}finally{busy.value=false}
}
function importFile(event: Event) { const input=event.target as HTMLInputElement,file=input.files?.[0];input.value='';if(file)void importAssetFile(file,false) }
async function importAssetFile(file: File, newTab: boolean) {
  const target=manager.activeInstance.value
  busy.value=true;error.value=''
  try {
    if(file.size>100000000)throw new Error(t('parts.fileTooLarge'))
    const json=JSON.parse(await file.text())
    if(json.format==='g-studio/scene'){
      if(json.version!==2||!Array.isArray(json.assets)||json.assets.length>24)throw new Error(t('parts.invalidFile'))
      const next=parseScene(json.scene);json.assets.forEach(validatePart)
      if(new Set(json.assets.map((p:PartAsset)=>p.id)).size!==json.assets.length)throw new Error(t('parts.invalidFile'))
      if(next.items.some(i=>!json.assets.some((p:PartAsset)=>p.id===i.assetId)&&!partLibrary[i.assetId]))throw new Error(t('parts.missing'))
      const map=new Map<string,string>()
      for(const part of json.assets){const saved=await importPart(part);map.set(part.id,saved.id)}
      next.items.forEach(i=>{i.assetId=map.get(i.assetId)??i.assetId})
      if(newTab||!target)await newSceneTab(typeof json.name==='string'?json.name:file.name.replace(/\.json$/i,''),next)
      else {sceneHistory(target).batch(()=>{target.state=next})}
    }else { const saved=await importPart(json);if(newTab){const doc=await newSceneTab(saved.name);await addPartsToScene([saved],doc.id)} }
  }catch(e){error.value=String(e)}finally{busy.value=false}
}
onMounted(async()=>{try{await initializeScene()}catch(e){error.value=String(e)}})
</script>
<template>
  <EditorShell :history="history" :tabs="tabs" :active-tab-id="manager.activeTabId.value" tab-add-mode="empty" :tab-add-label="t('parts.newScene')" tab-accept=".json,application/json" :left-panel="leftPanel" :right-panel="rightPanel" :left-collapsed="leftCollapsed"
    @tab-switch="manager.switchTab" @tab-close="closeSceneTab" @tab-rename="renameTab" @tab-add-empty="newTab" @tab-add-file="importAssetFile($event,true)" @tab-load-file="importAssetFile($event,false)" @update:left-collapsed="leftCollapsed=$event">
    <template #tab-actions><button v-if="closedScenes.length" class="reopen-tab" :title="t('parts.reopenScene')" :aria-label="t('parts.reopenScene')" @click="reopenSceneTab"><SvgIcon name="undo" :size="13"/></button></template>
    <template #left><ScrollArea class="lighting-sidebar" :label="t('parts.sceneSettings')">
      <div v-if="error||libraryError||sceneStorageError" class="error" role="alert">{{error||libraryError||sceneStorageError}}</div>
      <SidebarSection title="" :collapsible="false">
        <SegmentedControl :label="t('sceneLight.environment')" :model-value="state.scene" :options="[{value:'open',label:t('sceneLight.open')},{value:'corner',label:t('sceneLight.corner')}]" role="group" :aria-label="t('sceneLight.environment')" @update:model-value="changeScene" />

        <SliderRow v-model="state.room.width" :default-value="DEFAULT_ROOM.width" :label="t('sceneLight.roomWidth')" :min="2" :max="24" :step="0.1" :precision="1"/>
        <SliderRow v-model="state.room.depth" :default-value="DEFAULT_ROOM.depth" :label="t('sceneLight.roomDepth')" :min="2" :max="24" :step="0.1" :precision="1"/>
        <SliderRow v-if="state.scene==='corner'" v-model="state.room.height" :default-value="DEFAULT_ROOM.height" :label="t('sceneLight.wallHeight')" :min="0.5" :max="12" :step="0.1" :precision="1"/>

      </SidebarSection>
      <SidebarSection title="" :collapsible="false">
        <div class="view-controls"><SceneViewControls :state="state"/><InlineSwitch v-model="state.showNames" :label="t('sceneLight.showNames')" block/></div>
        <button v-if="state.items.some(item=>!item.visible)" class="wide" @click="revealItems">{{t('parts.revealItems')}}</button>
      </SidebarSection>
      <SidebarSection :title="t('parts.library')" :collapsible="false">
        <input class="search" v-model="search" :placeholder="t('parts.search')" :aria-label="t('parts.search')"/>
        <ScrollArea class="library-scroll" :label="t('parts.library')"><PartPalette :parts="library" :disabled="busy" @edit="edit" @add="add([$event])" @drop="dropPart" @import="importInput?.click()"/></ScrollArea>
        <p v-if="!library.length" class="note">{{t('parts.noMatches')}}</p>
        <input ref="importInput" hidden type="file" accept=".json,application/json" @change="importFile"/>
      </SidebarSection>
      <SidebarSection :title="t('sceneLight.lighting')" :collapsible="false">
        <LightSettings :state="state"/>
        <InlineSwitch v-model="showShadowPoints" :label="t('sceneLight.showShadowPoints')" :info="t('sceneLight.shadowPointsLegend')+'\n'+t('sceneLight.shadowPointsHelp')+(state.shadows?'':'\n'+t('sceneLight.shadowPointsDisabled'))" block/>
      </SidebarSection>
      <div class="lighting-info"><button class="wide" :disabled="busy" @click="exportScene">{{t('parts.exportScene')}}</button></div>
    </ScrollArea></template>
    <template #right><ScrollArea class="lighting-sidebar properties-sidebar" :label="t('parts.properties')">
      <p v-if="!selected" class="property-empty">{{t('parts.selectInScene')}}</p>
      <SidebarSection v-if="selected" :key="selected.id" :title="asset?.name??t('parts.missing')" :collapsible="false">
        <img v-if="asset" class="property-image" :src="partImageUrl(asset)" alt=""/><div class="row"><button class="primary" :disabled="!asset" @click="edit(selected.assetId)">{{t('parts.edit')}}</button><button @click="removeSceneItem(selected.id)">{{t('parts.removeInstance')}}</button></div>

        <SliderRow v-model="objectX" :default-value="state.room.width/2" :label="t('sceneLight.positionX')" :min="limits.minX-bounds.minX" :max="limits.maxX-bounds.minX" :step="0.01" :precision="2" />
        <SliderRow v-model="objectZ" :default-value="state.room.depth/2" :label="t('sceneLight.positionZ')" :min="limits.minZ-bounds.minZ" :max="limits.maxZ-bounds.minZ" :step="0.01" :precision="2" />
        <SliderRow v-model="selected.scale" :default-value="1" :label="t('parts.instanceScale')" :min="0.2" :max="3" :step="0.05" :precision="2" />
        <InlineSwitch v-model="selected.visible" :label="t('sceneLight.visible')" block/><InlineSwitch v-model="selected.casts" :label="t('sceneLight.casts')" block/><InlineSwitch v-model="selected.receives" :label="t('sceneLight.receives')" block/>
      </SidebarSection>
      <p v-if="missing.length" class="error">{{t('parts.missingHelp')}}</p>
    </ScrollArea></template>
    <template #viewport><LightingViewport ref="viewport" :state="state" :assets="assets" :controls="false" :show-shadow-points="showShadowPoints" @edit="edit"/></template>
  </EditorShell>
</template>
<style scoped>
.lighting-sidebar{background:#202020;color:#ccc}.row{display:flex;gap:6px;margin:8px 0}.row>*{flex:1}button{font:inherit;color:inherit;cursor:pointer;background:#2c3430;border:1px solid #48514e;border-radius:5px;padding:7px;font-size:11px}button:disabled{opacity:.4;cursor:default}.primary{background:#355344;border-color:#688b75}.wide{width:100%;margin-top:8px}.library-scroll{flex:none;height:auto;max-height:300px;margin-top:6px}.library-scroll :deep(.scroll-viewport){height:auto;max-height:300px}.library-scroll :deep(.scroll-content){min-height:0}.view-controls{display:flex;flex-direction:column;gap:10px}.property-empty{padding:20px 12px;color:#888;font-size:12px;text-align:center}.property-image{display:block;width:100%;height:104px;object-fit:contain;image-rendering:pixelated;margin:10px 0}.search{width:100%;box-sizing:border-box;background:#292929;border:1px solid #444;color:#ddd;border-radius:4px;padding:7px;margin-top:8px}.lighting-info{padding:10px;border-top:1px solid #333}.note{font-size:11px;color:#888;margin:4px 0}.error{color:#eab2a5;font-size:11px;padding:9px;overflow-wrap:anywhere}.reopen-tab{width:28px;border:0;border-radius:0;background:none;color:#888;display:grid;place-items:center;padding:0}.reopen-tab:hover{background:#2d2d2d;color:#ddd}.viewport-undo{display:grid;place-items:center;padding:5px;background:none;border-color:transparent;color:#aaa}
</style>
