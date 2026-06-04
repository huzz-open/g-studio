<script setup lang="ts">
const props = withDefaults(defineProps<{
  label: string
  modelValue: boolean
  disabled?: boolean
}>(), {
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [val: boolean]
}>()
</script>

<template>
  <div class="checkbox-row">
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
  </div>
</template>

<style scoped>
.checkbox-row {
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
.checkbox-input:disabled { opacity: 0.4; cursor: default; }
.checkbox-input:disabled ~ .checkbox-text { opacity: 0.4; }
</style>
