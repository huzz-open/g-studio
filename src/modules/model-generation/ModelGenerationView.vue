<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, useId } from 'vue'
import { useI18n } from '../../shared/i18n'
import GenerationTaskDetails from '../../shared/generation/GenerationTaskDetails.vue'
import GenerationActions, { type GenerationAction } from '../../shared/generation/GenerationActions.vue'
import GenerationSettings from '../../shared/generation/GenerationSettings.vue'
import FileDropZone from '../../shared/components/FileDropZone.vue'
import SidebarSection from '../../shared/components/editor-shell/SidebarSection.vue'
import { createGenerationJob, regenerateModel, modelReplacing, findGenerationJob, generationJobs, loadGenerationJobs, removeJob, type LocalJob } from '../../shared/generation/jobs'
import { snapshotGenerationConnection } from '../../shared/generation/request-snapshot'
import { copyGenerationParameters, generationParametersFor, modelParametersFor } from '../../shared/generation/parameters'
import GenerationQueue from '../../shared/generation/GenerationQueue.vue'
import { canGenerateModels } from '../../shared/generation/connection'
import { openGenerationSettings } from '../../shared/settings-dialog'
import { clonePart, createPart } from '../../shared/parts/schema'
import { showToast } from '../../shared/components/toast'
import { prompt } from '../../shared/components/prompt'
import { EditorShell, definePanelConfig, type DropModifiers } from '../../shared/components/editor-shell'
import ScrollArea from '../../shared/components/ScrollArea.vue'
import { generationTabs, generationInput, generationQueueExpanded } from './store'
const ModelViewer = defineAsyncComponent(() => import('../../shared/generation/ModelViewer.vue'))
const reviewControlsId = 'generation-review-' + useId()
const { t } = useI18n()
const { instances, activeInstance, activeTabId, pinnedIds, createTab, switchTab, closeTab, setPinned } = generationTabs
const leftCollapsed = ref(false), rightCollapsed = ref(false), busy = ref(false), error = ref('')
const panel = definePanelConfig('model-generation-sidebar-width', 280)
const rightPanel = definePanelConfig('model-generation-properties-width', 260)
const visibleJobs = computed(() => generationJobs.filter(job => job.connection.providerId !== 'silhouette'))
const selectedJob = computed(() => findGenerationJob(activeInstance.value?.jobId))
// Source images follow the selected tab; editable parameters keep their own draft.
const sourcePart = computed(() => activeInstance.value?.part)
const emptyParameters = ref(copyGenerationParameters())
const parameters = computed(() => selectedJob.value ? modelParametersFor(selectedJob.value) : sourcePart.value ? generationParametersFor(sourcePart.value.id) : emptyParameters.value)
const tabs = computed(() => instances.value.map(entry => ({ id:entry.id, label:entry.part?.name || t('generation.newImage'), pinned:pinnedIds.value.has(entry.id) })))
async function renameTab(id: string) {
  const entry = instances.value.find(tab => tab.id === id)
  if (!entry?.part) return
  const name = await prompt({ title:t('parts.name'), defaultValue:entry.part.name })
  if (name?.trim()) entry.part.name = name.trim().slice(0,120)
}
async function loadFile(file: File, replace = false) {
  try {
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 10*1024*1024) throw Error(t('generation.inputLimit'))
    const bitmap = await createImageBitmap(file)
    if (bitmap.width > 2048 || bitmap.height > 2048 || bitmap.width*bitmap.height > 4000000) { bitmap.close(); throw Error(t('generation.inputLimit')) }
    const canvas = document.createElement('canvas')
    canvas.width=bitmap.width; canvas.height=bitmap.height
    canvas.getContext('2d')!.drawImage(bitmap,0,0); bitmap.close()
    const part = createPart(file.name.replace(/\.[^.]+$/, '').slice(0,120), { uri:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height })
    const entry = (replace || !activeInstance.value?.part) && activeInstance.value ? activeInstance.value : createTab()
    generationInput.value=part; entry.part=part; entry.jobId=''; error.value=''
  } catch(e) { error.value=String(e); showToast(error.value, 'error') }
}
async function dropFiles(files: File[], modifiers: DropModifiers) {
  for (const [index,file] of files.entries()) await loadFile(file, index===0 && modifiers.alt)
}
async function select(job: LocalJob) {
  rightCollapsed.value = false
  const existing=instances.value.find(tab=>tab.jobId===job.localId)
  if(existing) { switchTab(existing.id); return }
  try {
    const image=new Image(); image.src=job.image; await image.decode()
    const entry=!activeInstance.value?.part && activeInstance.value ? activeInstance.value : createTab()
    entry.part=createPart(job.name,{uri:job.image,width:image.naturalWidth,height:image.naturalHeight}); entry.jobId=job.localId
  } catch(e) { showToast(String(e),'error') }
}
async function generate(mode: GenerationAction) {
  if (busy.value || !sourcePart.value || !canGenerateModels.value) return
  busy.value = true
  try {
    const source = clonePart(sourcePart.value), connection = snapshotGenerationConnection(parameters.value)
    const target = selectedJob.value
    const created = (job: LocalJob) => {
      generationQueueExpanded.value = true; rightCollapsed.value = false
      if (mode === 'overwrite') return
      const entry = mode === 'initial' ? instances.value.find(tab=>tab.part?.id===source.id && !tab.jobId) ?? createTab() : createTab()
      entry.part = mode === 'new' ? createPart(source.name, {...source.image}) : source
      entry.jobId=job.localId; switchTab(entry.id)
    }
    if (mode === 'initial') await createGenerationJob(source.name, source.image.uri, connection, undefined, created)
    else if (target?.model) await regenerateModel(target, mode, connection, created)
  } catch(e) { showToast(String(e),'error') }
  finally { busy.value=false }
}
async function discard(job: LocalJob) {
  try {
    await removeJob(job)
    for(const entry of instances.value) if(entry.jobId===job.localId) entry.jobId=''
  } catch(e) { showToast(String(e),'error') }
}
onMounted(()=> { void loadGenerationJobs().catch(e=>showToast(String(e),'error')) })
</script>
<template>
  <EditorShell v-model:left-collapsed="leftCollapsed" v-model:right-collapsed="rightCollapsed" :tabs="tabs" :active-tab-id="activeTabId" :left-panel="panel" :right-panel="rightPanel"
    tab-accept="image/png,image/jpeg,image/webp" :show-empty="!activeInstance?.part" :managed-drop="false"
    @tab-switch="switchTab" @tab-close="closeTab" @tab-pin="setPinned" @tab-rename="renameTab"
    @tab-add-empty="createTab" @tab-add-file="loadFile" @tab-load-file="file=>loadFile(file,true)" @viewport-drop="dropFiles">
    <template #left>
      <ScrollArea class="generation-sidebar">
        <SidebarSection :title="t('slicer.source')" :collapsible="false">
          <FileDropZone compact accept="image/png,image/jpeg,image/webp" icon="image"
            :hint="sourcePart ? t('slicer.reselect') : t('generation.dropImage')"
            :file-name="sourcePart ? `${sourcePart.image.width} × ${sourcePart.image.height} px` : ''"
            @file="file=>loadFile(file,true)">
            <template v-if="sourcePart" #icon><img class="source-thumbnail" :src="sourcePart.image.uri" :alt="sourcePart.name" /></template>
          </FileDropZone>
        </SidebarSection>
        <div id="generation-properties" class="generation-properties" :class="{ 'empty-properties': !activeInstance?.part }">
          <button v-if="!canGenerateModels" class="connection-button" @click="openGenerationSettings">{{ t('generation.connectionSettings') }}</button>
          <GenerationSettings section="defaults" :parameters="parameters" :disabled="busy || !sourcePart" />
          <div class="empty-actions"><GenerationActions :existing="!!selectedJob?.model" :busy="busy" :replacing="modelReplacing(selectedJob)" :disabled="!sourcePart || !canGenerateModels" @generate="generate" /></div>
          <div :id="reviewControlsId" />
        </div>
      </ScrollArea>
    </template>
    <template #viewport>
      <ModelViewer v-if="selectedJob?.model?.mesh" :controls-target="leftCollapsed ? undefined : '#'+reviewControlsId" :uri="selectedJob.model.mesh.uri" :model="selectedJob.model" :comparison="selectedJob.comparison" :image="selectedJob.image" :name="selectedJob.name" />
      <div v-else-if="activeInstance?.part" class="source-preview"><img :src="selectedJob?.image || activeInstance.part.image.uri" :alt="activeInstance.part.name" /></div>
    </template>
    <template #viewport-overlay><GenerationQueue v-model:expanded="generationQueueExpanded" :jobs="visibleJobs" :selected-id="selectedJob?.localId" @select="select" @remove="discard" /></template>
    <template #right><GenerationTaskDetails :job="selectedJob" /></template>
  </EditorShell>
</template>
<style scoped>
.generation-sidebar { height:100%; background:#252525; }
.source-thumbnail { width:28px; height:32px; object-fit:contain; flex-shrink:0; image-rendering:pixelated; }
.generation-properties { margin:0; padding:0 12px; border:0; min-width:0; }
.source-preview { display:flex; align-items:center; justify-content:center; flex:1; min-height:0; padding:32px; background:#202327; overflow:hidden; }
.source-preview img { max-width:100%; max-height:100%; object-fit:contain; image-rendering:pixelated; }
.empty-actions { padding:14px 0; border-bottom:1px solid #333; }
.empty-actions button { font-size:12px; background:#303030; border:1px solid #555; border-radius:5px; padding:6px 10px; color:#ddd; cursor:default; }
.connection-button { margin-top:12px; width:100%; padding:7px; border:1px solid #555; border-radius:5px; background:#303030; color:#ddd; cursor:pointer; }
</style>
