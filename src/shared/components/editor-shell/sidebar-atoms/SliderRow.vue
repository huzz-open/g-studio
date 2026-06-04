<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  label: string
  modelValue: number
  min?: number
  max?: number
  step?: number
  suffix?: string
  disabled?: boolean
}>(), {
  min: 0,
  max: 100,
  step: 1,
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [val: number]
}>()

const displayVal = computed(() =>
  props.suffix ? `${props.modelValue}${props.suffix}` : String(props.modelValue)
)
</script>

<template>
  <div class="slider-row" :class="{ disabled }">
    <span class="slider-label">{{ label }}</span>
    <input
      type="range"
      class="slider-input"
      :value="modelValue"
      :min="min"
      :max="max"
      :step="step"
      :disabled="disabled"
      @input="emit('update:modelValue', +($event.target as HTMLInputElement).value)"
    />
    <span class="slider-value">{{ displayVal }}</span>
  </div>
</template>

<style scoped>
.slider-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.slider-label {
  font-size: 11px;
  color: #aaa;
  white-space: nowrap;
  min-width: 48px;
}
.slider-input {
  flex: 1;
  height: 4px;
  appearance: none;
  background: #3a3a3a;
  border-radius: 2px;
  outline: none;
  cursor: pointer;
  min-width: 0;
}
.slider-input::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #8ab4f8;
  cursor: pointer;
}
.slider-value {
  font-size: 11px;
  color: #8ab4f8;
  font-variant-numeric: tabular-nums;
  min-width: 28px;
  text-align: right;
}
.slider-row.disabled { opacity: 0.4; pointer-events: none; }
</style>
