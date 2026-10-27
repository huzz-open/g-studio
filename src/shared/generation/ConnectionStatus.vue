<script setup lang="ts">
import { computed } from 'vue'
import { generationConnection as connection } from './connection'
import { useI18n } from '../i18n'
const { t } = useI18n()
const state = computed(() => connection.checking ? 'checking' : connection.error ? 'failed' : connection.connected ? 'connected' : 'idle')
const label = computed(() => t(state.value === 'checking' ? 'common.loading' : state.value === 'failed' ? 'generation.connectionFailed' : 'generation.connected'))
</script>
<template>
  <span class="connection-status" :class="state" role="status" :aria-label="state==='idle' ? undefined : label" :title="state==='idle' ? undefined : label">
    <svg v-if="state==='connected' || state==='failed'" viewBox="0 0 16 16" aria-hidden="true"><path :d="state==='connected' ? 'm4 8 3 3 5-6' : 'M5 5L11 11M11 5L5 11'" /></svg>
  </span>
</template>
<style scoped>
.connection-status { display:inline-grid; place-items:center; line-height:0; padding:0; vertical-align:middle; width:16px; height:16px; box-sizing:border-box; flex-shrink:0; border-radius:50%; }
.idle { visibility:hidden; }
.connected { background:#38865a; }
.failed { background:#b44f4f; }
.checking { border:2px solid #52606f; border-top-color:#9ac6ff; animation:spin .7s linear infinite; }
svg { display:block; width:12px; height:12px; flex:none; fill:none; stroke:white; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
@keyframes spin { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion:reduce) { .checking { animation:none; } }
</style>
