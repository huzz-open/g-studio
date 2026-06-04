<script setup lang="ts">
defineProps<{
  label: string
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [val: string]
}>()
</script>

<template>
  <div class="color-row">
    <label class="color-label">{{ label }}</label>
    <div class="color-input-wrap">
      <input
        type="color"
        class="color-input"
        :value="modelValue"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
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
  min-width: 48px;
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
</style>
