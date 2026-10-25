<script setup lang="ts">
import ParameterReset from '../../ParameterReset.vue'
const props = withDefaults(defineProps<{
  label: string
  modelValue: boolean
  disabled?: boolean
  defaultValue?: boolean
}>(), {
  disabled: false,
  defaultValue: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [val: boolean]
}>()
</script>

<template>
  <div class="checkbox-row" :class="{ disabled }">
    <label class="checkbox-label">
      <span class="checkbox-text">{{ label }}</span>
      <input
        type="checkbox"
        class="checkbox-input"
        :checked="modelValue"
        :disabled="disabled"
        @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
      />
    </label>
    <ParameterReset v-if="defaultValue !== undefined" :model-value="modelValue" :default-value="defaultValue" :label="label" :disabled="disabled" @reset="emit('update:modelValue', defaultValue)" />
  </div>
</template>

<style scoped>
.checkbox-row {
  display: flex;
  align-items: center;
  gap: 5px;
}
.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 11px;
  color: #aaa;
}
.checkbox-label:hover { color: #ddd; }
.checkbox-text {
  user-select: none;
  min-width: 48px;
}
.checkbox-input {
  width: 14px;
  height: 14px;
  accent-color: #5577aa;
  cursor: pointer;
}
.checkbox-input:disabled { cursor: default; }
.checkbox-row.disabled { opacity: .4; }
.checkbox-row.disabled .checkbox-label { cursor: default; }
.checkbox-input:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 2px; }
</style>
