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
    <div class="slider-label">
      <span>{{ label }}</span>
      <span class="slider-value">{{ displayVal }}</span>
    </div>
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
  </div>
</template>

<style scoped>
.slider-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 6px;
}
.slider-label {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #aaa;
}
.slider-value {
  color: #8ab4f8;
  font-variant-numeric: tabular-nums;
}
.slider-input {
  width: 100%;
  height: 4px;
  appearance: none;
  background: #3a3a3a;
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}
.slider-input::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #8ab4f8;
  cursor: pointer;
}
.slider-row.disabled { opacity: 0.4; pointer-events: none; }
</style>
