<script setup lang="ts">
import ParameterReset from '../../ParameterReset.vue'
import { parameterValuesEqual } from '../../../utils/parameter-values'
import { useId } from 'vue'
const inputId = useId()
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  label: string
  defaultValue?: number
  modelValue: number
  min?: number
  max?: number
  step?: number
  suffix?: string
  disabled?: boolean
  precision?: number
}>(), {
  min: 0,
  max: 100,
  step: 1,
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [val: number]
  commit: [val: number]
}>()

const displayVal = computed(() =>
  (props.precision === undefined ? String(props.modelValue) : props.modelValue.toFixed(props.precision)) + (props.suffix ?? '')
)
</script>

<template>
  <div class="slider-row" :class="{ disabled, resettable: defaultValue !== undefined }">
    <label :for="inputId" class="slider-label">{{ label }}</label>
    <ParameterReset v-if="defaultValue !== undefined" :changed="!parameterValuesEqual(modelValue, defaultValue)" :default-value="precision === undefined ? defaultValue : Number(defaultValue.toFixed(precision))" :label="label" :disabled="disabled" @reset="emit('update:modelValue', defaultValue!); emit('commit', defaultValue!)" />
    <input :id="inputId"
      type="range"
      class="slider-input"
      :aria-label="label"
      :value="modelValue"
      :min="min"
      :max="max"
      :step="step"
      :disabled="disabled"
      @input="emit('update:modelValue', +($event.target as HTMLInputElement).value)"
      @change="emit('commit', +($event.target as HTMLInputElement).value)"
    />
    <span class="slider-value">{{ displayVal }}</span>
  </div>
</template>

<style scoped>
.slider-row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) 42px;
  align-items: center;
  gap: 8px;
}
.slider-label {
  font-size: 11px;
  color: #aaa;
  white-space: normal;
  line-height: 1.35;
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
.slider-input:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 5px; }
.slider-row { min-height: 28px; }
.slider-value { min-width: 42px; }
.slider-row.resettable { grid-template-columns: 72px 22px minmax(0, 1fr) 36px; gap: 5px; }
.slider-row.resettable .slider-value { min-width: 36px; }
</style>
