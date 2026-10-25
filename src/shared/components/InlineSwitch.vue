<script setup lang="ts">
import ParameterReset from './ParameterReset.vue'
withDefaults(defineProps<{
  modelValue: boolean
  label: string
  tooltip?: string
  disabled?: boolean
  description?: string
  block?: boolean
  defaultValue?: boolean
}>(), { defaultValue: undefined })

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()
</script>

<template>
  <div class="il-switch-container" :class="{ block }">
  <label class="il-switch" :class="{ disabled, block }" :title="tooltip">
    <span v-if="label" class="il-switch-label">{{ label }}<small v-if="description">{{ description }}</small></span>
    <input type="checkbox" role="switch" :aria-label="label || tooltip" :checked="modelValue" :disabled="disabled" @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)" />
  </label>
    <ParameterReset v-if="defaultValue !== undefined" :model-value="modelValue" :default-value="defaultValue" :label="label" :disabled="disabled" @reset="emit('update:modelValue', defaultValue)" />
  </div>
</template>

<style scoped>
.il-switch-container { display: inline-flex; align-items: center; gap: 5px; }
.il-switch-container.block { display: flex; width: 100%; }
.il-switch-container .il-switch { flex: 1; }
.il-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 12px;
  color: #bbb;
  user-select: none;
}
.il-switch.disabled {
  opacity: 0.4;
  cursor: default;
}
.il-switch-label {
  white-space: nowrap;
}
.il-switch.block { display: flex; justify-content: space-between; width: 100%; min-height: 28px; }
.il-switch-label small { display: block; white-space: normal; font-size: 10px; color: #999; margin-top: 3px; line-height: 1.5; }
.il-switch input { appearance: none; width: 32px; height: 18px; margin: 0; border: 1px solid #555; border-radius: 10px; background: #444; flex-shrink: 0; cursor: pointer; position: relative; transition: background .15s; }
.il-switch input::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #aaa; transition: transform .15s; }
.il-switch input:checked { background: #3a6a5a; border-color: #568875; }
.il-switch input:checked::after { transform: translateX(14px); background: #d0f0e0; }
.il-switch input:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 2px; }
.il-switch input:disabled { cursor: default; }
</style>
