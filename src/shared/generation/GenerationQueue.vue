<script setup lang="ts">
import { useId } from 'vue'
import SvgIcon from '../icons/SvgIcon.vue'
import ScrollArea from '../components/ScrollArea.vue'
import { useI18n } from '../i18n'
import type { LocalJob } from './jobs'
import { jobStatus, jobRunning } from './job-state'
const props = defineProps<{ jobs: LocalJob[]; selectedId?: string }>()
const emit = defineEmits<{ select: [job: LocalJob]; remove: [job: LocalJob] }>()
const { t } = useI18n(), listId = useId()
const expanded = defineModel<boolean>('expanded', { default: false })
</script>
<template>
  <section v-if="props.jobs.length" class="generation-queue" :class="{ expanded }" :aria-label="t('generation.taskHistory')">
    <button class="queue-toggle" :aria-expanded="expanded" :aria-controls="listId" :aria-label="t(expanded ? 'generation.collapseQueue' : 'generation.expandQueue')" @click="expanded = !expanded"><span>{{ t('generation.taskHistory') }}</span><span class="queue-count">{{ jobs.length }}</span><span class="queue-toggle-label">{{ t(expanded ? 'generation.collapse' : 'generation.expand') }}</span><SvgIcon :name="expanded ? 'chevron-left' : 'chevron-right'" :size="12" /></button>
    <ScrollArea v-show="expanded" :id="listId" class="queue-list" :label="t('generation.taskHistory')">
      <div v-for="job in jobs" :key="job.localId" class="queue-row" :class="{ selected: job.localId === selectedId }">
        <button class="queue-select" :aria-pressed="job.localId === selectedId" @click="emit('select', job)">
          <img :src="job.image" alt="" /><span class="queue-copy"><strong :title="job.name">{{ job.name }}</strong><small :class="jobStatus(job)"><i v-if="jobRunning(job)" class="running-dot" />{{ t('generation.status.' + jobStatus(job)) }}</small></span>
        </button>
        <button v-if="!jobRunning(job) && !['undefined', 'receiving'].includes(jobStatus(job))" class="queue-remove" :aria-label="t('generation.removeNamedTask', { name: job.name })" @click="emit('remove', job)">×</button>
      </div>
    </ScrollArea>
  </section>
</template>
<style scoped>
.generation-queue { position:absolute; left:12px; top:12px; z-index:5; max-width:calc(100% - 24px); border:1px solid #4b5058; border-radius:8px; background:#262a30f2; box-shadow:0 5px 20px #0004; overflow:hidden; color:#d5dbe4; font-size:12px; }
.generation-queue.expanded { width:228px; }
button { font:inherit; border:0; color:inherit; background:transparent; cursor:pointer; }
.queue-toggle { display:flex; width:100%; align-items:center; gap:8px; padding:10px 12px; }
.queue-toggle:hover { background:#343a43; }.queue-toggle:focus-visible { outline:2px solid #8ab4f8; outline-offset:-2px; }
.queue-toggle-label { color:#aab3bf; font-size:11px; }
.queue-count { margin-left:auto; border-radius:4px; padding:1px 5px; color:#a8c6eb; background:#394654; }
.queue-list { border-top:1px solid #41454b; padding:4px; }
.queue-list :deep(.scroll-viewport) { max-height:min(360px,45vh); }
.queue-row { display:flex; align-items:center; border-radius:5px; }
.queue-row:hover { background:#343a43; }.queue-row.selected { background:#36485d; }
.queue-select { display:flex; align-items:center; gap:10px; padding:8px; flex:1; min-width:0; text-align:left; }
.queue-select img { width:32px; height:40px; object-fit:contain; background:#1f2329; border-radius:3px; }
.queue-copy { min-width:0; }.queue-copy strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500; }
.queue-copy small { display:flex; align-items:center; gap:5px; font-size:11px; color:#aab3bf; margin-top:5px; }.queue-copy .succeeded { color:#9cc7a9; }.queue-copy .failed { color:#efad99; }
.queue-remove { align-self:stretch; padding:8px; color:#adb5c1; }
.running-dot { width:6px; height:6px; border-radius:50%; background:#91b8ed; }
</style>
