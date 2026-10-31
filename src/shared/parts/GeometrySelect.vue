<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import SvgIcon from '../icons/SvgIcon.vue'
import ScrollArea from '../components/ScrollArea.vue'
import { useI18n } from '../i18n'
import type { PartAsset, PartGeometry } from './schema'
import { createGeometryCardPreview } from './geometry-card-preview'

const props = defineProps<{
  modelValue: string
  options: { value: string; label: string; geometry: PartGeometry }[]
  part: PartAsset
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; preview: [value: string | null]; generate: [] }>()
const { t } = useI18n()
const id = useId(), trigger = ref<HTMLButtonElement>(), menu = ref<HTMLElement>()
const scrollArea = ref<InstanceType<typeof ScrollArea>>()
const open = ref(false), position = ref({ left: '0px', top: '0px', width: '0px', maxHeight: '320px' })
const selected = computed(() => props.options.find(option => option.value === props.modelValue)?.label ?? '')
let anchor: DOMRect | undefined
let disposePreviews: (() => void) | undefined
watch([open, () => props.options], () => {
  disposePreviews?.(); disposePreviews = undefined
  if (!open.value || !menu.value || !scrollArea.value?.viewport) return
  const canvases = [...menu.value.querySelectorAll<HTMLCanvasElement>('.geometry-thumbnail canvas')]
  disposePreviews = createGeometryCardPreview(props.part, props.options.flatMap((option, index) => {
    const canvas = canvases[index]
    return canvas ? [{ geometry: option.geometry, canvas }] : []
  }), scrollArea.value.viewport)
}, { flush: 'post' })

function focusItem(item?: HTMLButtonElement | null) {
  const viewport = scrollArea.value?.viewport
  if (!item || !viewport) return
  item.focus({ preventScroll: true })
  // Scroll only the popup; scrolling its ancestors would move the trigger.
  const rect = item.getBoundingClientRect(), clip = viewport.getBoundingClientRect()
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
  else if (event.key === 'Tab') close()
  else if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    const items = [...menu.value?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? []]
    const index = items.findIndex(item => item === document.activeElement)
    const step = event.key === 'ArrowDown' ? (index === 0 ? 1 : 2) : event.key === 'ArrowUp' ? (index <= 2 ? -index : -2) : event.key === 'ArrowRight' ? 1 : -1
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
  emit('preview', null)
  disposePreviews?.()
  document.removeEventListener('scroll', onScroll, true)
  document.removeEventListener('focusin', onFocus)
  window.removeEventListener('resize', onResize)
})
defineExpose({ close })
</script>

<template>
  <div class="geometry-select">
    <button ref="trigger" type="button" class="geometry-trigger" :disabled="disabled"
      :aria-label="t('parts.geometryType') + ': ' + selected" aria-haspopup="menu" :aria-expanded="open" :aria-controls="id"
      @click="open ? close() : show()" @keydown.down.prevent="show()" @keydown.up.prevent="show(true)">
      <span>{{ selected }}</span><SvgIcon name="chevron-down" :size="14" :class="{ expanded: open }" />
    </button>
    <div :id="id" ref="menu" popover="auto" class="geometry-menu" role="menu" :aria-label="t('parts.geometryType')"
      :style="position" @beforetoggle="onBeforeToggle" @toggle="onToggle" @keydown="onKey" @pointerleave="emit('preview', null)">
      <ScrollArea ref="scrollArea" class="geometry-options-scroll" :label="t('parts.geometryType')" :style="{ maxHeight: `calc(${position.maxHeight} - 10px)` }">
        <button type="button" class="geometry-option geometry-create" role="menuitem" tabindex="-1" @click="generate" @focus="emit('preview', null)">
          <SvgIcon name="plus" :size="16" /><span>{{ t('generation.fromImage') }}</span>
        </button>
        <div class="geometry-separator" role="separator" />
        <div v-if="open" class="geometry-grid" role="group">
          <button v-for="option in options" :key="option.value" type="button" class="geometry-option geometry-card"
            role="menuitemradio" :aria-label="option.label" :aria-checked="option.value === modelValue" tabindex="-1" @click="choose(option.value)"
            @pointerenter="emit('preview', option.value)" @pointerleave="emit('preview', null)"
            @focus="emit('preview', option.value)" @blur="emit('preview', null)">
            <span class="geometry-thumbnail" aria-hidden="true">
              <canvas data-preview-state="loading" />
              <span class="geometry-placeholder"><SvgIcon :name="option.geometry.kind === 'silhouette' ? 'silhouette' : 'item'" :size="36" /></span>
            </span>
            <span v-if="option.value === modelValue" class="geometry-check"><SvgIcon name="check" :size="14" /></span>
            <span class="geometry-card-label">{{ option.label }}</span>
          </button>
        </div>
      </ScrollArea>
    </div>
  </div>
</template>

<style scoped>
.geometry-select { width: 100%; min-width: 0; }
.geometry-select .geometry-trigger { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 7px 9px; border: 1px solid #4c5850; border-radius: 4px; background: #2b3330; color: #e0e8e1; font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.geometry-trigger span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.geometry-trigger svg { flex-shrink: 0; transition: transform .15s; }
.geometry-trigger .expanded { transform: rotate(180deg); }
.geometry-select .geometry-trigger:hover:not(:disabled), .geometry-select .geometry-trigger[aria-expanded="true"] { border-color: #84ab8d; }
.geometry-select .geometry-trigger:focus-visible { outline: 2px solid #84ab8d; outline-offset: 2px; }
.geometry-select .geometry-trigger:disabled { opacity: .45; cursor: default; }
.geometry-menu { position: fixed; inset: auto; margin: 0; box-sizing: border-box; padding: 4px; overflow: hidden; border: 1px solid #56675b; border-radius: 6px; background: #28312c; color: #d6ded9; box-shadow: 0 8px 24px #0006; }
.geometry-options-scroll :deep(.scroll-viewport) { height: auto; max-height: inherit; }
.geometry-menu .geometry-option { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 32px; padding: 7px 8px; border: 0; border-radius: 3px; background: transparent; color: inherit; font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.geometry-option span:last-child { overflow-wrap: anywhere; }
.geometry-check { position: absolute; top: 7px; right: 7px; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: #466a52; color: #d8f7e0; }
.geometry-menu .geometry-create { color: #b4e4c2; background: #344b3d; font-weight: 600; }
.geometry-create svg { flex-shrink: 0; }
.geometry-menu .geometry-option[aria-checked="true"] { background: #35443b; }
.geometry-menu .geometry-option:hover, .geometry-menu .geometry-option:focus-visible { background: #405749; outline: 1px solid #84ab8d; outline-offset: -1px; }
.geometry-separator { height: 1px; margin: 4px 0; background: #46534a; }
.geometry-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; padding: 3px; }
.geometry-menu .geometry-card { position: relative; display: flex; flex-direction: column; gap: 0; min-width: 0; padding: 0; overflow: hidden; border: 1px solid #47554c; border-radius: 6px; background: #222a26; }
.geometry-menu .geometry-card[aria-checked="true"] { border-color: #92b69e; background: #35483c; box-shadow: inset 0 0 0 1px #92b69e; }
.geometry-thumbnail { position: relative; display: block; width: 100%; height: 112px; background: radial-gradient(ellipse at 50% 60%, #3c4b43, #202824); }
.geometry-thumbnail canvas { display: block; width: 100%; height: 100%; }
.geometry-placeholder { position: absolute; inset: 0; display: grid; place-items: center; color: #8da697; }
canvas[data-preview-state="ready"] + .geometry-placeholder { display: none; }
.geometry-card-label { display: block; width: 100%; box-sizing: border-box; padding: 9px 10px; font-size: 11px; line-height: 1.4; border-top: 1px solid #52635866; }
</style>
