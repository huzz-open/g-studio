<script setup lang="ts">
export interface SelectOption {
  value: string
  label: string
}

defineProps<{
  label: string
  modelValue: string
  options: SelectOption[]
}>()

const emit = defineEmits<{
  'update:modelValue': [val: string]
}>()
</script>

<template>
  <div class="select-row">
    <label class="select-label">{{ label }}</label>
    <select
      class="select-input"
      :value="modelValue"
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
</style>
