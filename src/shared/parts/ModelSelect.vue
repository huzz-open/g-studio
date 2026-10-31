<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import SvgIcon from '../icons/SvgIcon.vue'
import ScrollArea from '../components/ScrollArea.vue'
import { useI18n } from '../i18n'
import type { PartAsset, PartModel } from './schema'
import { createModelCardPreview } from './model-card-preview'

const props = defineProps<{
  modelValue: string
  options: { value: string; label: string; model: PartModel }[]
  part: PartAsset
  disabled?: boolean
  loading?: boolean
  optimizing?: boolean
  optimizationEnabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; preview: [value: string | null]; generate: []; optimize:[value:string,enabled:boolean] }>()
const { t } = useI18n()
const id = useId(), trigger = ref<HTMLButtonElement>(), menu = ref<HTMLElement>()
const scrollArea = ref<InstanceType<typeof ScrollArea>>()
const open = ref(false), position = ref({ left: '0px', top: '0px', width: '0px', maxHeight: '320px' })
const selected = computed(() => props.options.find(option => option.value === props.modelValue)?.label ?? t('generation.fromImage'))
const loadingVisible = ref(false)
let loadingTimer: ReturnType<typeof setTimeout> | undefined
watch(() => props.loading, loading => {
  clearTimeout(loadingTimer)
  loadingVisible.value = false
  if (loading) loadingTimer = setTimeout(() => { loadingVisible.value = true }, 180)
}, { immediate: true })
let anchor: DOMRect | undefined
let disposePreviews: (() => void) | undefined
// Parent status updates create new option arrays without changing the models.
// Keep their canvases and animation alive until preview content actually changes.
const previewKey = computed(() => props.options.map(option=>[option.value,option.model.mesh?.sha256,option.model.repair?.key,JSON.stringify(option.model.imageFit)].join(':')).join('|'))
watch([open, previewKey], () => {
  disposePreviews?.(); disposePreviews = undefined
  if (!open.value || !menu.value || !scrollArea.value?.viewport) return
  const canvases = [...menu.value.querySelectorAll<HTMLCanvasElement>('.model-thumbnail canvas')]
  disposePreviews = createModelCardPreview(props.part, props.options.flatMap((option, index) => {
    const canvas = canvases[index]
    return canvas ? [{ model: option.model, canvas }] : []
  }), scrollArea.value.viewport)
}, { flush: 'post' })

function focusItem(item?: HTMLButtonElement | null) {
  const viewport = scrollArea.value?.viewport
  if (!item || !viewport) return
  item.focus({ preventScroll: true })
  // Scroll only the popup; scrolling its ancestors would move the trigger.
  const rect = (item.closest('.model-card-entry')??item).getBoundingClientRect(), clip = viewport.getBoundingClientRect()
  if (rect.top < clip.top) viewport.scrollTop += rect.top - clip.top
  else if (rect.bottom > clip.bottom) viewport.scrollTop += rect.bottom - clip.bottom
}

function close(restoreFocus = true) {
  emit('preview', null)
  if (!open.value) return false
  menu.value?.hidePopover()
  open.value = false
  if (restoreFocus) trigger.value?.focus()
  return true
}
async function show(last = false) {
  if (props.disabled || !trigger.value || !menu.value) return
  const rect = trigger.value.getBoundingClientRect()
  anchor = rect
  const below = window.innerHeight - rect.bottom - 8, above = rect.top - 8
  const upwards = below < 200 && above > below
  const width = Math.min(Math.max(rect.width, 360), window.innerWidth - 16)
  position.value = {
    left: `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`,
    top: `${rect.bottom + 4}px`, width: `${width}px`,
    maxHeight: `${Math.min(460, Math.max(0, (upwards ? above : below) - 4))}px`,
  }
  open.value = true
  menu.value.showPopover()
  await nextTick()
  if (!open.value || !menu.value) return
  if (upwards) menu.value.style.top = `${rect.top - menu.value.getBoundingClientRect().height - 4}px`
  const items = menu.value.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')
  const target = last ? items[items.length - 1] : menu.value.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? items[0]
  focusItem(target)
}
// Selecting updates the draft, but keeps the menu available for comparison.
function choose(value: string) { emit('update:modelValue', value) }
function generate() { close(); emit('generate') }
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
  else if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    const items = [...menu.value?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? []]
    const index = items.findIndex(item => item === document.activeElement)
    const step = event.key === 'ArrowDown' ? 2 : event.key === 'ArrowUp' ? -2 : event.key === 'ArrowRight' ? 1 : -1
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, index + step))
    focusItem(items[next])
  }
}
function onToggle(event: Event) {
  open.value = (event as ToggleEvent).newState === 'open'
  if (!open.value) emit('preview', null)
}
function onBeforeToggle(event: Event) { if ((event as ToggleEvent).newState === 'closed') emit('preview', null) }
function onScroll(event: Event) {
  if (!open.value || !(event.target instanceof Node) || menu.value?.contains(event.target)) return
  const rect = trigger.value?.getBoundingClientRect()
  if (rect?.top !== anchor?.top || rect?.left !== anchor?.left) close(false)
}
function onFocus(event: FocusEvent) {
  if (open.value && event.target !== trigger.value && !menu.value?.contains(event.target as Node)) close(false)
}
function onResize() { close(false) }
watch(() => props.disabled, disabled => { if (disabled) close(false) })
onMounted(() => {
  document.addEventListener('scroll', onScroll, true)
  document.addEventListener('focusin', onFocus)
  window.addEventListener('resize', onResize)
})
onUnmounted(() => {
  clearTimeout(loadingTimer)
  emit('preview', null)
  disposePreviews?.()
  document.removeEventListener('scroll', onScroll, true)
  document.removeEventListener('focusin', onFocus)
  window.removeEventListener('resize', onResize)
})
defineExpose({ close })
</script>

<template>
  <div class="model-select" :aria-busy="!!loading">
    <button ref="trigger" type="button" class="model-trigger" :disabled="disabled"
      :aria-label="t('parts.modelType') + ': ' + selected" aria-haspopup="menu" :aria-expanded="open" :aria-controls="id"
      @click="open ? close() : show()" @keydown.down.prevent="show()" @keydown.up.prevent="show(true)">
      <span>{{ selected }}</span><span class="model-indicator"><span v-if="loadingVisible" class="model-loading" role="status" :aria-label="t('common.loading')"/><SvgIcon v-else name="chevron-down" :size="14" :class="{ expanded: open }" /></span>
    </button>
    <div :id="id" ref="menu" popover="auto" class="model-menu" role="menu" :aria-label="t('parts.modelType')"
      :style="position" @beforetoggle="onBeforeToggle" @toggle="onToggle" @keydown="onKey" @pointerleave="emit('preview', null)">
      <ScrollArea ref="scrollArea" class="model-options-scroll" :label="t('parts.modelType')" :style="{ maxHeight: `calc(${position.maxHeight} - 10px)` }">
        <div v-if="open" class="model-grid" role="group">
          <div v-for="option in options" :key="option.value" class="model-card-entry"><button type="button" class="model-option model-card"
            role="menuitemradio" :aria-label="option.label" :aria-checked="option.value === modelValue" tabindex="-1" @click="choose(option.value)"
>
            <span class="model-thumbnail" aria-hidden="true">
              <canvas data-preview-state="loading" />
              <span class="model-placeholder"><SvgIcon name="item" :size="36" /></span>
            </span>
            <span v-if="option.value === modelValue" class="model-check"><SvgIcon name="check" :size="14" /></span>
            <span class="model-card-label">{{ option.label }}</span>
          </button>
          <div class="model-optimization">
            <span v-if="option.value===modelValue&&optimizing" class="model-loading" role="status" :aria-label="t('parts.aligning')"/>
            <input v-else type="checkbox" :checked="option.value===modelValue?optimizationEnabled!==false:!!option.model.imageFit" :disabled="disabled" :aria-label="t('parts.useOptimized')" :title="t('parts.useOptimized')" @change="emit('optimize',option.value,($event.target as HTMLInputElement).checked)"/>
          </div></div>
          <button type="button" class="model-option model-create" role="menuitem" tabindex="-1" @click="generate" :aria-label="t('generation.fromImage')">
            <SvgIcon name="plus" :size="36"/><span>{{t('generation.fromImage')}}</span>
          </button>
        </div>
      </ScrollArea>
    </div>
  </div>
</template>

<style scoped>
.model-card-entry{position:relative;min-width:0}.model-optimization{position:absolute;right:9px;bottom:9px;width:18px;height:18px;display:grid;place-items:center}.model-optimization input{appearance:auto;width:17px;height:17px;margin:0;accent-color:#84ab8d;cursor:pointer}.model-optimization input:focus-visible{outline:2px solid #b4e4c2;outline-offset:2px}
.model-select { width: 100%; min-width: 0; }
.model-select .model-trigger { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 7px 9px; border: 1px solid #4c5850; border-radius: 4px; background: #2b3330; color: #e0e8e1; font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.model-trigger span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.model-indicator { display: inline-flex; width: 14px; height: 14px; flex: 0 0 14px; }
.model-loading { width: 14px; height: 14px; box-sizing: border-box; border: 2px solid #84ab8d55; border-top-color: #b4e4c2; border-radius: 50%; animation: model-loading .8s linear infinite; }
@keyframes model-loading { to { transform: rotate(360deg); } }
@media(prefers-reduced-motion:reduce) { .model-loading { animation: none; } }
.model-trigger svg { flex-shrink: 0; transition: transform .15s; }
.model-trigger .expanded { transform: rotate(180deg); }
.model-select .model-trigger:hover:not(:disabled), .model-select .model-trigger[aria-expanded="true"] { border-color: #84ab8d; }
.model-select .model-trigger:focus-visible { outline: 2px solid #84ab8d; outline-offset: 2px; }
.model-select .model-trigger:disabled { opacity: .45; cursor: default; }
.model-menu { position: fixed; inset: auto; margin: 0; box-sizing: border-box; padding: 4px; overflow: hidden; border: 1px solid #56675b; border-radius: 6px; background: #28312c; color: #d6ded9; box-shadow: 0 8px 24px #0006; }
.model-options-scroll :deep(.scroll-content){padding-right:0}
.model-options-scroll :deep(.scroll-viewport) { height: auto; max-height: inherit; }
.model-menu .model-option { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 32px; padding: 7px 8px; border: 0; border-radius: 3px; background: transparent; color: inherit; font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.model-option span:last-child { overflow-wrap: anywhere; }
.model-check { position: absolute; top: 7px; right: 7px; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: #466a52; color: #d8f7e0; }
.model-menu .model-create {align-self:stretch;min-height:148px;flex-direction:column;justify-content:center;gap:12px;color:#b4e4c2;background:#28382e;border:1px dashed #65806e;border-radius:6px;font-weight:600}
.model-create svg { flex-shrink: 0; }
.model-menu .model-option[aria-checked="true"] { background: #35443b; }
.model-menu .model-option:hover, .model-menu .model-option:focus-visible { background: #405749; outline: 1px solid #84ab8d; outline-offset: -1px; }
.model-separator { height: 1px; margin: 4px 0; background: #46534a; }
.model-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; padding: 3px; }
.model-menu .model-card { position: relative; display: flex; flex-direction: column; gap: 0; min-width: 0; padding: 0; overflow: hidden; border: 1px solid #47554c; border-radius: 6px; background: #222a26; }
.model-menu .model-card[aria-checked="true"] { border-color: #92b69e; background: #35483c; box-shadow: inset 0 0 0 1px #92b69e; }
.model-thumbnail { position: relative; display: block; width: 100%; height: 112px; background: radial-gradient(ellipse at 50% 60%, #3c4b43, #202824); }
.model-thumbnail canvas { display: block; width: 100%; height: 100%; }
.model-placeholder { position: absolute; inset: 0; display: grid; place-items: center; color: #8da697; }
canvas[data-preview-state="ready"] + .model-placeholder { display: none; }
.model-card-label { display: block; width: 100%; box-sizing: border-box; padding: 9px 34px 9px 10px; font-size: 11px; line-height: 1.4; border-top: 1px solid #52635866; }
</style>
