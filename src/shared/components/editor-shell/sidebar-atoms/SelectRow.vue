<script setup lang="ts">
import ParameterReset from '../../ParameterReset.vue'
import { useId } from 'vue'
const inputId = useId()
export interface SelectOption {
  value: string
  label: string
}

defineProps<{
  label: string
  defaultValue?: string
  modelValue: string
  options: SelectOption[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [val: string]
}>()
</script>

<template>
  <div class="select-row">
    <div class="parameter-label"><label :for="inputId" class="select-label">{{ label }}</label><ParameterReset v-if="defaultValue !== undefined" :model-value="modelValue" :default-value="defaultValue" :label="label" :disabled="disabled" @reset="emit('update:modelValue', defaultValue!)" /></div>
    <select :id="inputId"
      class="select-input"
      :value="modelValue"
      :aria-label="label"
      :disabled="disabled"
      @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="opt in options" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </option>
    </select>
  </div>
</template>

<style scoped>
.select-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.select-label {
  font-size: 11px;
  color: #aaa;
  white-space: nowrap;
}
.select-input {
  flex: 1;
  max-width: 120px;
  padding: 3px 6px;
  font-size: 11px;
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 4px;
  color: #ddd;
  cursor: pointer;
}
.select-input:focus {
  outline: none;
  border-color: #5577aa;
}
.select-input { min-height: 28px; min-width: 0; }
.select-input:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 1px; }
.select-input:disabled { opacity: .4; }
.parameter-label { display: flex; align-items: center; justify-content: space-between; gap: 5px; min-height: 24px; }
</style>
