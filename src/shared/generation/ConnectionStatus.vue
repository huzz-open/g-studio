<script setup lang="ts">
import { generationServiceStatus as status } from './readiness'
</script>
<template>
  <span v-if="status.state !== 'idle'" class="connection-summary" :title="status.detail">
  <span class="connection-status" :class="status.state" aria-hidden="true">
    <svg v-if="status.state==='connected' || status.state==='failed'" viewBox="0 0 16 16" aria-hidden="true"><path :d="status.state==='connected' ? 'm4 8 3 3 5-6' : 'M5 5L11 11M11 5L5 11'" /></svg>
  </span>
  <span role="status">{{ status.label }}</span>
  </span>
</template>
<style scoped>
.connection-summary { display:inline-flex; align-items:center; gap:5px; font-size:11px; }
.connection-status { display:inline-grid; place-items:center; line-height:0; padding:0; vertical-align:middle; width:16px; height:16px; box-sizing:border-box; flex-shrink:0; border-radius:50%; }
.idle { visibility:hidden; }
.connected { background:#38865a; }
.failed { background:#b44f4f; }
.preparing { border:2px solid #c49b5740; border-top-color:#d6a548; animation:spin .85s linear infinite; }
.disabled { background:#666; }
.checking { border:2px solid #52606f; border-top-color:#9ac6ff; animation:spin .7s linear infinite; }
svg { display:block; width:12px; height:12px; flex:none; fill:none; stroke:white; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
@keyframes spin { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion:reduce) { .checking, .preparing { animation:none; } }
</style>
