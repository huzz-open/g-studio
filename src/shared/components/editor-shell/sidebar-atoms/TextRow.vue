<script setup lang="ts">
withDefaults(defineProps<{
  label: string
  modelValue: string
  placeholder?: string
  readonly?: boolean
}>(), {
  readonly: false,
})

const emit = defineEmits<{
  'update:modelValue': [val: string]
}>()
</script>

<template>
  <div class="text-row">
    <label class="text-label">{{ label }}</label>
    <input
      type="text"
      class="text-input"
      :value="modelValue"
      :placeholder="placeholder"
      :readonly="readonly"
      @change="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
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
</style>
