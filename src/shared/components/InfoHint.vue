<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import { useI18n } from '../i18n'
const props = defineProps<{ text: string; label: string }>()
const { t } = useI18n()
const id = useId(), anchor = ref<HTMLButtonElement>(), popup = ref<HTMLElement>()
const open = ref(false), left = ref(0), top = ref(0), width = ref(300)
const hovering = ref(false), focusing = ref(false)
function place() {
  if (!open.value || !anchor.value) return
  const rect = anchor.value.getBoundingClientRect()
  width.value = Math.min(300, window.innerWidth - 24)
  left.value = Math.max(12, Math.min(rect.left, window.innerWidth - width.value - 12))
  const height = popup.value?.getBoundingClientRect().height ?? 0
  top.value = rect.bottom + 8 + height <= window.innerHeight - 12 ? rect.bottom + 8 : Math.max(12, rect.top - height - 8)
}
function show() { open.value = true; void nextTick(place) }
function leave() { hovering.value = false; if (!focusing.value) open.value = false }
function blur() { focusing.value = false; if (!hovering.value) open.value = false }
watch(() => props.text, () => { if (open.value) void nextTick(place) })
onMounted(() => { window.addEventListener('resize', place); window.addEventListener('scroll', place, true) })
onUnmounted(() => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) })
</script>

<template>
  <span class="info-hint">
    <button ref="anchor" type="button" class="info-hint-button" :aria-label="t('common.helpFor', { name: label })" :aria-describedby="open ? id : undefined"
      @mouseenter="hovering = true; show()" @mouseleave="leave" @focus="focusing = true; show()" @blur="blur" @click.stop="show" @keydown.esc.stop.prevent="open = false">
      <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="10" cy="10" r="7.5" /><path d="M10 9v5" /><circle cx="10" cy="6" r=".6" fill="currentColor" stroke="none" /></svg>
    </button>
    <Teleport to="body"><div v-if="open" :id="id" ref="popup" role="tooltip" class="info-hint-popup" :style="{ left: `${left}px`, top: `${top}px`, width: `${width}px` }">{{ text }}</div></Teleport>
  </span>
</template>

<style scoped>
.info-hint { display: inline-flex; align-items: center; flex-shrink: 0; }
.info-hint-button { display: grid; place-items: center; width: 20px; height: 20px; padding: 0; border: 1px solid transparent; border-radius: 4px; background: transparent; color: #8996a8; cursor: help; }
.info-hint-button:hover { background: #38414c; color: #c8ddf6; }
.info-hint-button:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 1px; }
.info-hint-popup { position: fixed; z-index: 20000; box-sizing: border-box; padding: 9px 11px; border: 1px solid #536071; border-radius: 6px; background: #232a33; color: #dce4ee; box-shadow: 0 5px 18px #0006; font: 12px/1.65 system-ui, sans-serif; white-space: pre-line; pointer-events: none; }
</style>
