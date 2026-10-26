<script setup lang="ts">
import { unref } from 'vue'
import SvgIcon from '../../icons/SvgIcon.vue'
import { useI18n } from '../../i18n'
import type { HistoryController } from '../../history/interaction'
defineProps<{history?:HistoryController|null}>()
const {t}=useI18n()
</script>
<template>
  <div class="history-controls" role="group" :aria-label="t('common.history')">
    <button :disabled="!history || !unref(history.canUndo)" :aria-label="t('common.undo')" :title="t('common.undo')+' (Ctrl+Z / ⌘Z)'" @click="history?.undo()"><SvgIcon name="undo" :size="14"/></button>
    <button :disabled="!history || !unref(history.canRedo)" :aria-label="t('common.redo')" :title="t('common.redo')+' (Ctrl+Shift+Z / Ctrl+Y / ⌘⇧Z)'" @click="history?.redo()"><SvgIcon name="redo" :size="14"/></button>
  </div>
</template>
<style scoped>
.history-controls{display:flex;align-items:center;gap:2px;padding:0 7px;border-left:1px solid #333;flex-shrink:0}.history-controls button{display:grid;place-items:center;width:27px;height:26px;padding:0;background:none;border:0;border-radius:4px;color:#c7c7c7;cursor:pointer}.history-controls button:hover:enabled{background:#373737}.history-controls button:disabled{opacity:.3;cursor:default}.history-controls button:focus-visible{outline:2px solid #8ab4f8;outline-offset:-2px}
</style>
