<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useI18n } from '../i18n'
import type { PartAsset } from '../parts/schema'
import { clonePart } from '../parts/schema'
import { portablePart, partImageUrl } from '../parts/images'
import GenerationQueue from './GenerationQueue.vue'
import { snapshotGenerationConnection } from './request-snapshot'
import { generationParametersFor, modelParametersFor } from './parameters'
import GenerationTaskDetails from './GenerationTaskDetails.vue'
import { createGenerationJob, regenerateModel, registerExistingModel, modelReplacing, findGenerationJob, loadGenerationJobs, generationJobs, removeJob, type LocalJob } from './jobs'
import { latestPartJob } from './job-state'
import { sha256 } from './client'
import { canGenerateModels } from './connection'
import { generationReadinessMessage } from './readiness'
import { openGenerationSettings } from '../settings-dialog'
import GenerationActions, { type GenerationAction } from './GenerationActions.vue'
import InfoHint from '../components/InfoHint.vue'
import GenerationSettings from './GenerationSettings.vue'
const ModelViewer = defineAsyncComponent(() => import('./ModelViewer.vue'))
const props = withDefaults(defineProps<{
  part: PartAsset; jobId?: string; sidebarTarget?: string; embedded?: boolean; origin?: 'scene' | 'slicer'
}>(), { embedded: false })
const emit = defineEmits<{ apply: [part: PartAsset]; close: []; jobCreated: [id: string, sourceId: string] }>()
const { t } = useI18n()
const mounted = ref(false), busy = ref(false), error = ref(''), selectedId = ref(props.jobId || '')
const partJobs = computed(() => generationJobs.filter(j => j.source?.assetId === props.part.id))
const job = computed(() => findGenerationJob(selectedId.value)
  ?? (props.origin ? latestPartJob(partJobs.value, props.part.id) : undefined))
const parameters = computed(() => job.value ? modelParametersFor(job.value) : generationParametersFor(props.part.id))
const sourceImage = computed(() => job.value?.image || partImageUrl(props.part))
const failure = computed(() => error.value)
watch(() => props.jobId, id => { selectedId.value = id || '' })
watch(() => job.value?.localId, () => { error.value = '' })
async function action(run: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { await run() } catch (e) { error.value = String(e) } finally { busy.value = false }
}
async function generate(mode: GenerationAction) {
  await action(async () => {
    if (!canGenerateModels.value) throw Error(generationReadinessMessage.value)
    const snapshot = clonePart(props.part), connection = snapshotGenerationConnection(parameters.value)
    const target=job.value
    const created=(created: LocalJob)=>{ if(mode!=='overwrite'){selectedId.value=created.localId;emit('jobCreated',created.localId,snapshot.id)} }
    if(mode!=='initial' && target?.geometry) {
      if(mode==='overwrite') selectedId.value=target.localId
      await regenerateModel(target, mode, connection, created, props.origin ? {assetId:snapshot.id,origin:props.origin} : undefined)
    }
    else {
      const input = await portablePart(snapshot)
      await createGenerationJob(snapshot.name,input.image.uri,connection,props.origin ? {assetId:snapshot.id,origin:props.origin}:undefined,created)
    }
  })
}
async function apply() {
  await action(async () => {
    const result = job.value
    if (!props.origin || !result?.geometry) return
    const snapshot = clonePart(props.part), input = await portablePart(snapshot)
    const hash = await sha256(await (await fetch(input.image.uri)).arrayBuffer())
    if (hash !== result.request.inputSha256 || JSON.stringify(snapshot) !== JSON.stringify(props.part)) throw Error(t('generation.stale'))
    // Only replace geometry; keep the caller's current name, alignment and normal settings.
    emit('apply', { ...snapshot, version: 2, geometry: clonePart(result.geometry) })
  })
}
async function discard(value: LocalJob) {
  await action(async () => { await removeJob(value); if (selectedId.value === value.localId) selectedId.value = '' })
}
onMounted(async () => {
  mounted.value = true
  try {
    await loadGenerationJobs()
    const unfinished = partJobs.value.find(task=>!task.geometry && (!task.remote || ['queued','running','cancel_requested'].includes(task.remote.status)))
    if (!props.jobId && unfinished) { selectedId.value=unfinished.localId; return }
    if (!props.jobId && props.part.geometry.mesh) {
      const input = await portablePart(props.part)
      const existing = await registerExistingModel(props.part.name, input.image.uri, props.part.geometry, snapshotGenerationConnection(),
        props.origin ? { assetId:props.part.id, origin:props.origin } : undefined)
      selectedId.value=existing.localId
    }
  } catch(e) { error.value=String(e) }
})
</script>
<template>
  <section class="gen-panel" :class="{ embedded }">
    <header v-if="!embedded"><strong>{{ t('generation.title') }}</strong><span>{{ part.name }}</span><button @click="emit('close')">{{ t('common.close') }}</button></header>
    <div class="gen-body">
      <Teleport :to="sidebarTarget || 'body'" :disabled="!sidebarTarget || !mounted">
        <aside class="generation-properties" :class="{ embedded }">
          <button v-if="!canGenerateModels" class="connect-action" @click="openGenerationSettings">{{ t('generation.connectionSettings') }}</button>
          <GenerationSettings section="defaults" :parameters="parameters" :disabled="busy" />
          <div class="gen-section"><GenerationActions :existing="!!job?.geometry" :busy="busy" :replacing="modelReplacing(job)" :disabled="!canGenerateModels" @generate="generate" /></div>
          <div v-if="failure" class="gen-error" role="alert"><span>{{ t('generation.actionFailed') }}</span><InfoHint :label="t('generation.details')" :text="failure" /></div>
        </aside>
      </Teleport>
      <main>
        <ModelViewer v-if="job?.geometry?.mesh" :uri="job.geometry.mesh.uri" :image="sourceImage" :name="part.name" />
        <div v-else class="source-preview"><img :src="sourceImage" :alt="part.name" /></div>
        <GenerationQueue v-if="origin" :jobs="partJobs" :selected-id="job?.localId" @select="selectedId = $event.localId" @remove="discard" />
      </main>
      <aside class="task-properties"><GenerationTaskDetails :job="job" /></aside>
    </div>
    <footer v-if="origin"><span>{{ part.name }}</span><button class="apply-model" :disabled="busy || !job?.geometry" @click="apply">{{ t('generation.useForPart') }}</button></footer>
  </section>
</template>
<style scoped>
.gen-panel { display:flex; flex-direction:column; width:100%; height:100%; min-height:0; color:#ccc; background:#252525; font-size:12px; }
.gen-panel header { display:flex; align-items:center; gap:12px; padding:12px 16px; background:#2a2a2a; border-bottom:1px solid #3a3a3a; }
.gen-panel header span { flex:1; color:#aaa; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.gen-panel button,.generation-properties button { font:inherit; color:#ddd; background:#303030; border:1px solid #555; border-radius:5px; padding:6px 10px; cursor:pointer; }
.gen-panel button:disabled,.generation-properties button:disabled { opacity:.45; cursor:default; }
.gen-body { display:flex; flex:1; min-height:0; }
.generation-properties { width:280px; flex-shrink:0; overflow:auto; border-right:1px solid #333; padding:0 12px; box-sizing:border-box; }
.generation-properties.embedded { width:100%; border:0; font-size:12px; color:#ccc; }
.connect-action { width:100%; margin-top:12px; }
.gen-section { padding:14px 0; border-bottom:1px solid #333; }
.task-properties { width:260px; flex-shrink:0; min-height:0; border-left:1px solid #333; }
.gen-error { display:flex; align-items:center; gap:6px; color:#efad99; padding:12px 0; }
.gen-body main { position:relative; flex:1; min-width:0; min-height:0; display:flex; overflow:hidden; }
.source-preview { display:flex; align-items:center; justify-content:center; width:100%; height:100%; min-height:0; padding:32px; box-sizing:border-box; background:#202327; }
.source-preview img { max-width:100%; max-height:100%; object-fit:contain; image-rendering:pixelated; }
.gen-panel footer { display:flex; align-items:center; justify-content:flex-end; gap:16px; padding:10px 16px; border-top:1px solid #3a3a3a; }.gen-panel footer span { color:#999; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.gen-panel .apply-model { background:#385b80; border-color:#638ab3; }
@media(max-width:650px) { .gen-body { flex-direction:column; }.generation-properties:not(.embedded) { width:100%; max-height:38%; border-right:0; border-bottom:1px solid #333; }.gen-body main { min-height:180px; }.task-properties { width:100%; max-height:28%; border-left:0; border-top:1px solid #333; overflow:auto; } }
</style>
