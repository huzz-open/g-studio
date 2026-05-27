<script setup lang="ts">
defineProps<{
  label: string
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [val: boolean]
}>()
</script>

<template>
  <div class="checkbox-row">
    <label class="checkbox-label">
      <input
        type="checkbox"
        class="checkbox-input"
        :checked="modelValue"
        @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
      />
      <span class="checkbox-text">{{ label }}</span>
    </label>
  </div>
</template>

<style scoped>
.checkbox-row {
  margin-bottom: 6px;
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
.checkbox-input {
  width: 14px;
  height: 14px;
  accent-color: #5577aa;
  cursor: pointer;
}
.checkbox-text {
  user-select: none;
}
</style>
