<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from '../i18n'
import ParameterReset from './ParameterReset.vue'

export interface SegmentOption {
  value: string
  label?: string
  labelKey?: string
}

const props = withDefaults(defineProps<{
  modelValue: string
  defaultValue?: string
  label?: string
  options: SegmentOption[]
  disabled?: boolean
  indicator?: boolean
  orientation?: 'horizontal' | 'vertical'
}>(), {
  indicator: false,
  orientation: 'horizontal',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const { t } = useI18n()
// Modifier keys used by the viewport must not reveal focus on a mouse-clicked tab.
const pointerFocus = ref<number | null>(null)

function getLabel(opt: SegmentOption): string {
  if (opt.label) return opt.label
  if (opt.labelKey) return t(opt.labelKey)
  return opt.value
}
function onKeydown(event: KeyboardEvent, index: number) {
  const previous = props.orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft'
  const forward = props.orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight'
  if (['Tab', 'Enter', ' ', previous, forward, 'Home', 'End'].includes(event.key)) pointerFocus.value = null
  if (props.disabled || ![previous, forward, 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const count = props.options.length
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : (index + (event.key === forward ? 1 : -1) + count) % count
  const buttons = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('button')
  buttons?.[next]?.focus()
  emit('update:modelValue', props.options[next].value)
}
</script>

<template>
  <div class="seg-control" :class="{ vertical: orientation === 'vertical' }">
    <span v-if="label" class="seg-label">{{ label }}</span>
  <div class="seg-ctrl" :class="{ disabled, 'no-indicator': !indicator }">
    <button
      v-for="(opt, index) in options"
      :key="opt.value"
      class="seg-ctrl-item"
      :class="{ active: modelValue === opt.value, 'pointer-focus': pointerFocus === index }"
      :disabled="disabled"
      type="button"
      :aria-pressed="modelValue === opt.value"
      :tabindex="modelValue === opt.value || (!options.some(o => o.value === modelValue) && index === 0) ? 0 : -1"
      @pointerdown="pointerFocus = index"
      @blur="pointerFocus === index && (pointerFocus = null)"
      @keydown="onKeydown($event, index)"
      @click="emit('update:modelValue', opt.value)"
    >{{ getLabel(opt) }}</button>
  </div>
    <ParameterReset v-if="defaultValue !== undefined" :model-value="modelValue" :default-value="defaultValue" :label="label || String($attrs['aria-label'] || t('common.parameter'))" :disabled="disabled" @reset="emit('update:modelValue', defaultValue)" />
  </div>
</template>

<style scoped>
.seg-label { flex: 0 0 auto; font-size: 11px; color: #aaa; margin-right: 5px; }
.seg-control { display: flex; align-items: center; gap: 5px; min-width: 0; }
.seg-control.vertical { flex-direction: column; align-items: stretch; }
.vertical .seg-ctrl { flex-direction: column; }
.vertical .seg-ctrl-item { flex: none; text-align: left; padding: 8px 10px; border-right: none; border-bottom: 1px solid #444; }
.vertical .seg-ctrl-item:last-child { border-bottom: none; }
.seg-ctrl {
  flex: 1;
  min-width: 0;
  display: flex;
  border: 1px solid #444;
  border-radius: 5px;
  overflow: hidden;
}
.seg-ctrl.disabled {
  opacity: 0.4;
}
.seg-ctrl-item {
  flex: 1;
  padding: 5px 6px;
  background: transparent;
  color: #888;
  border: none;
  font-size: 11px;
  cursor: pointer;
  text-align: center;
  transition: background 0.15s, color 0.15s;
  border-right: 1px solid #444;
  white-space: nowrap;
}
.seg-ctrl-item:last-child { border-right: none; }
.seg-ctrl-item:hover:not(:disabled):not(.active) { background: #333; color: #bbb; }
.seg-ctrl-item.active {
  background: #3a3a3a;
  color: #eee;
  box-shadow: inset 0 -2px 0 #7aa2d4;
}
.seg-ctrl.no-indicator .seg-ctrl-item.active {
  box-shadow: none;
}
.seg-ctrl.disabled .seg-ctrl-item.active {
  background: transparent;
  color: #888;
  box-shadow: inset 0 -2px 0 #555;
}
.seg-ctrl.disabled.no-indicator .seg-ctrl-item.active {
  box-shadow: none;
}
.seg-ctrl-item:disabled { cursor: default; }
.seg-ctrl-item:focus { outline: none; }
.seg-ctrl-item:focus-visible:not(.pointer-focus) { outline: 2px solid #8ab4f8; outline-offset: -2px; }
</style>
