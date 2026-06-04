<script setup lang="ts">
export interface RadioOption {
  value: string
  label: string
  title?: string
}

const props = withDefaults(defineProps<{
  label?: string
  modelValue: string
  options: RadioOption[]
  direction?: 'row' | 'column'
  disabled?: boolean
}>(), {
  direction: 'row',
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [val: string]
}>()
</script>

<template>
  <div class="radio-group" :class="{ disabled }">
    <span v-if="label" class="radio-group-label">{{ label }}</span>
    <div class="radio-options" :class="direction">
      <label
        v-for="opt in options"
        :key="opt.value"
        class="radio-option"
        :title="opt.title"
      >
        <input
          type="radio"
          class="radio-input"
          :checked="modelValue === opt.value"
          :disabled="disabled"
          @change="emit('update:modelValue', opt.value)"
        />
        <span class="radio-text">{{ opt.label }}</span>
      </label>
    </div>
  </div>
</template>

<style scoped>
.radio-group {
}
.radio-group-label {
  display: block;
  font-size: 11px;
  color: #aaa;
  margin-bottom: 4px;
}
.radio-options {
  display: flex;
  gap: 4px;
}
.radio-options.row {
  flex-direction: row;
  gap: 12px;
}
.radio-options.column {
  flex-direction: column;
}
.radio-option {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #aaa;
  cursor: pointer;
}
.radio-option:hover {
  color: #ddd;
}
.radio-input {
  width: 14px;
  height: 14px;
  accent-color: #5577aa;
  cursor: pointer;
}
.radio-group.disabled {
  opacity: 0.4;
  pointer-events: none;
}
</style>
