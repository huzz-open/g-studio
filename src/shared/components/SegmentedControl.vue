<script setup lang="ts">
import { useI18n } from '../i18n'

export interface SegmentOption {
  value: string
  label?: string
  labelKey?: string
}

withDefaults(defineProps<{
  modelValue: string
  options: SegmentOption[]
  disabled?: boolean
  indicator?: boolean
}>(), {
  indicator: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const { t } = useI18n()

function getLabel(opt: SegmentOption): string {
  if (opt.label) return opt.label
  if (opt.labelKey) return t(opt.labelKey)
  return opt.value
}
</script>

<template>
  <div class="seg-ctrl" :class="{ disabled, 'no-indicator': !indicator }">
    <button
      v-for="opt in options"
      :key="opt.value"
      class="seg-ctrl-item"
      :class="{ active: modelValue === opt.value }"
      :disabled="disabled"
      @click="emit('update:modelValue', opt.value)"
    >{{ getLabel(opt) }}</button>
  </div>
</template>

<style scoped>
.seg-ctrl {
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
</style>
