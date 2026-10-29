<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { LocalJob } from './jobs'
import { cancelJob, retryResult, submitJob } from './jobs'
import { jobRunning, jobStatus } from './job-state'
import { useI18n } from '../i18n'
import { decodeMesh } from '../parts/mesh'
import ScrollArea from '../components/ScrollArea.vue'
import SidebarSection from '../components/editor-shell/SidebarSection.vue'
import TextRow from '../components/editor-shell/sidebar-atoms/TextRow.vue'
import ActionButtons from '../components/editor-shell/sidebar-atoms/ActionButtons.vue'
import InfoHint from '../components/InfoHint.vue'

const props = defineProps<{ job?: LocalJob }>()
const { t, locale } = useI18n()
const busy = ref(false), error = ref('')
const status = computed(() => props.job ? jobStatus(props.job) : '')
const running = computed(() => !!props.job && jobRunning(props.job))
const failure = computed(() => error.value || props.job?.error || props.job?.remote?.error?.message)
const phase = computed(() => {
  const value = props.job?.remote?.phase
  if (!value || !running.value) return ''
  const key = 'generation.phase.' + value
  return t(key) === key ? value : t(key)
})
const parameters = computed(() => ({
  ...props.job?.geometry?.mesh?.generation?.parameters,
  ...props.job?.request.parameters,
  ...props.job?.remote?.result?.parameters?.parameters,
}))
const triangles = computed(() => {
  if (props.job?.remote?.result?.triangles !== undefined) return props.job.remote.result.triangles
  try { return props.job?.geometry?.mesh ? decodeMesh(props.job.geometry.mesh.uri).triangles.length : undefined } catch { return undefined }
})
const created = computed(() => props.job ? new Date(props.job.createdAt).toLocaleString(locale.value) : '')
const buttons = computed(() => {
  const job = props.job
  if (!job) return []
  if (job.geometry) return []
  if (running.value) return [{ id: 'cancel', label: t('generation.cancel'), disabled: busy.value || job.remote?.status === 'cancel_requested' }]
  if (!job.remote) return [{ id: 'retry', label: t('generation.retrySubmit'), disabled: busy.value }]
  if (job.resultRejected) return [{ id: 'result', label: t('generation.retryResult'), disabled: busy.value }]
  return []
})
watch(() => props.job?.localId, () => { error.value = '' })
async function action(id: string) {
  const job = props.job
  if (!job || busy.value) return
  busy.value = true; error.value = ''
  try {
    if (id === 'cancel') await cancelJob(job)
    else if (id === 'retry') await submitJob(job)
    else if (id === 'result') await retryResult(job)
  } catch (e) { if (props.job?.localId === job.localId) error.value = String(e) }
  finally { busy.value = false }
}
function value(number: number | undefined) { return number === undefined ? '—' : String(number) }
</script>
<template>
  <ScrollArea class="generation-task-details" :label="t('generation.taskDetails')">
    <p v-if="!job" class="property-empty">{{ t('generation.selectTask') }}</p>
    <template v-else>
      <SidebarSection :title="t('generation.taskDetails')" :collapsible="false">
        <img class="property-image" :src="job.image" :alt="job.name" />
        <TextRow :label="t('generation.taskName')" :model-value="job.name" readonly stacked />
        <div class="task-status">
          <div class="status-line" role="status"><span class="status-dot" :class="status" /><strong>{{ t('generation.status.' + status) }}</strong><span v-if="job.deviceType" class="device-tag">{{ job.deviceType.toUpperCase() }}</span></div>
          <small v-if="phase">{{ phase }}</small>
          <progress v-if="running || status === 'receiving'" :aria-label="phase || t('generation.status.' + status)" />
        </div>
        <TextRow :label="t('generation.createdAt')" :model-value="created" readonly stacked />
        <TextRow :label="t('generation.taskSource')" :model-value="t(job.source?.origin === 'scene' ? 'sceneLight.title' : job.source?.origin === 'slicer' ? 'nav.spriteSlicer' : 'generation.title')" readonly />
        <ActionButtons v-if="buttons.length" :buttons="buttons" @click="action" />
        <div v-if="failure" class="task-error" role="alert">{{ t('generation.actionFailed') }}<InfoHint :label="t('generation.details')" :text="failure" /></div>
      </SidebarSection>
      <SidebarSection :title="t('generation.taskParameters')">
        <TextRow :label="t('generation.targetFaces')" :model-value="value(job.request.targetFaces)" readonly />
        <TextRow :label="t('generation.seed')" :model-value="value(job.request.seed)" readonly />
        <TextRow v-for="(number,key) in parameters" :key="key" :label="t('generation.parameter.'+key) === 'generation.parameter.'+key ? key : t('generation.parameter.'+key)" :model-value="value(number)" readonly />
        <TextRow :label="t('generation.provider')" :model-value="job.providerName" :title="job.request.providerId" readonly stacked />
      </SidebarSection>
      <SidebarSection v-if="job.geometry" :title="t('generation.modelProperties')">
        <TextRow :label="t('generation.actualFaces')" :model-value="value(triangles)" readonly />
        <TextRow :label="t('generation.modelFormat')" model-value="GLB" readonly />
      </SidebarSection>
    </template>
  </ScrollArea>
</template>
<style scoped>
.generation-task-details { height:100%; background:#202020; color:#ccc; }
.property-empty { padding:20px 12px; color:#888; font-size:12px; text-align:center; }
.property-image { display:block; width:100%; height:104px; object-fit:contain; image-rendering:pixelated; margin:4px 0; }
.generation-task-details :deep(.text-row) { flex-wrap:wrap; margin-bottom:0; }
.generation-task-details :deep(.text-label) { white-space:normal; }
.generation-task-details :deep(.text-input) { margin-left:auto; min-width:80px; text-align:right; color:#ccc; }
.generation-task-details :deep(.stacked .text-input) { margin-left:0; text-align:left; }
.task-status { display:flex; flex-direction:column; gap:8px; padding:6px 0; font-size:12px; }
.status-line { display:flex; align-items:center; gap:7px; }.status-line strong { font-weight:500; }
.status-dot { width:7px; height:7px; border-radius:50%; background:#8e97a2; }.status-dot.running,.status-dot.receiving { background:#91b8ed; }.status-dot.succeeded { background:#86c59b; }.status-dot.failed { background:#efad99; }
.device-tag { margin-left:auto; font-size:10px; color:#b6c4d3; background:#343b44; padding:2px 5px; border-radius:4px; }
.task-status small { color:#9da9b9; }.task-status progress { width:100%; height:4px; accent-color:#85afe7; }
.task-error { display:flex; align-items:center; gap:6px; color:#efad99; font-size:11px; }
</style>
