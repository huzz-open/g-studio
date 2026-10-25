<script setup lang="ts">
import ParameterReset from '../../ParameterReset.vue'
import { useId } from 'vue'
const inputId = useId()
withDefaults(defineProps<{
  label: string
  defaultValue?: string
  modelValue: string
  placeholder?: string
  readonly?: boolean
  disabled?: boolean
  stacked?: boolean
  live?: boolean
}>(), {
  readonly: false,
})

const emit = defineEmits<{
  'update:modelValue': [val: string]
}>()
</script>

<template>
  <div class="text-row" :class="{ disabled, stacked }">
    <div class="parameter-label"><label :for="inputId" class="text-label">{{ label }}</label><ParameterReset v-if="defaultValue !== undefined" :model-value="modelValue" :default-value="defaultValue" :label="label" :disabled="disabled" @reset="emit('update:modelValue', defaultValue!)" /></div>
    <input :id="inputId"
      type="text"
      class="text-input"
      :value="modelValue"
      :aria-label="label"
      :disabled="disabled"
      :placeholder="placeholder"
      :readonly="readonly"
      @change="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @input="live && emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
  </div>
</template>

<style scoped>
.text-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.text-label {
  font-size: 11px;
  color: #aaa;
  white-space: nowrap;
}
.text-input {
  flex: 1;
  max-width: 150px;
  padding: 3px 6px;
  font-size: 11px;
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 4px;
  color: #ddd;
  outline: none;
}
.text-input:focus {
  border-color: #5577aa;
}
.text-input[readonly] {
  cursor: default;
  color: #888;
}
.text-input { min-width: 0; min-height: 28px; box-sizing: border-box; }
.text-input:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 1px; }
.text-row.disabled { opacity: .4; }
.text-row.stacked { flex-direction: column; align-items: stretch; gap: 4px; margin: 0; }
.stacked .text-input { width: 100%; max-width: none; }
.parameter-label { display: flex; align-items: center; justify-content: space-between; gap: 5px; min-height: 24px; }
</style>
