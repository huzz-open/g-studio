<script setup lang="ts">
import ParameterReset from '../../ParameterReset.vue'
import { useId } from 'vue'
const inputId = useId()
defineProps<{
  label: string
  defaultValue?: string
  modelValue: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [val: string]
  commit: [val: string]
}>()
</script>

<template>
  <div class="color-row" :class="{ disabled }">
    <label :for="inputId" class="color-label">{{ label }}</label>
    <div class="color-input-wrap">
      <ParameterReset v-if="defaultValue !== undefined" :model-value="modelValue" :default-value="defaultValue" :label="label" :disabled="disabled" @reset="emit('update:modelValue', defaultValue!); emit('commit', defaultValue!)" />
      <input :id="inputId"
        type="color"
        class="color-input"
        :value="modelValue"
        :aria-label="label"
        :disabled="disabled"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        @change="emit('commit', ($event.target as HTMLInputElement).value)"
      />
      <span class="color-hex">{{ modelValue }}</span>
    </div>
  </div>
</template>

<style scoped>
.color-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.color-label {
  font-size: 11px;
  color: #aaa;
  white-space: nowrap;
  min-width: 72px;
}
.color-input-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}
.color-input {
  width: 24px;
  height: 24px;
  border: 1px solid #555;
  border-radius: 4px;
  padding: 0;
  cursor: pointer;
  background: none;
}
.color-input::-webkit-color-swatch-wrapper { padding: 2px; }
.color-input::-webkit-color-swatch { border: none; border-radius: 2px; }
.color-hex {
  font-size: 10px;
  color: #888;
  font-family: monospace;
}
.color-row { min-height: 28px; }
.color-row.disabled { opacity: .4; }
.color-input:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 2px; }
</style>
