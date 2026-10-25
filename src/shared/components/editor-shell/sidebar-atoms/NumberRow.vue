<script setup lang="ts">
import ParameterReset from '../../ParameterReset.vue'
import { useId } from 'vue'
const inputId = useId()
const props = withDefaults(defineProps<{
  label: string
  defaultValue?: number
  modelValue: number
  min?: number
  max?: number
  step?: number
  suffix?: string
  disabled?: boolean
  stacked?: boolean
  live?: boolean
}>(), {
  step: 1,
})

const emit = defineEmits<{
  'update:modelValue': [val: number]
}>()

function onInput(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.value.trim() === '' || !Number.isFinite(input.valueAsNumber)) {
    if (e.type === 'change') input.value = String(props.modelValue)
    return
  }
  const raw = input.valueAsNumber
  let v = raw
  if (props.min !== undefined) v = Math.max(props.min, v)
  if (props.max !== undefined) v = Math.min(props.max, v)
  if (props.step === 1) v = Math.round(v)
  if (e.type === 'change') input.value = String(v)
  emit('update:modelValue', v)
}
</script>

<template>
  <div class="number-row" :class="{ disabled, stacked }">
    <label :for="inputId" class="number-label">{{ label }}</label>
    <div class="number-input-wrap">
      <ParameterReset v-if="defaultValue !== undefined" :model-value="modelValue" :default-value="defaultValue" :label="label" :disabled="disabled" @reset="emit('update:modelValue', defaultValue!)" />
      <input :id="inputId"
        type="number"
        class="number-input"
        :aria-label="label"
        :disabled="disabled"
        :value="modelValue"
        :min="min"
        :max="max"
        :step="step"
        @change="onInput"
        @input="live && onInput($event)"
      />
      <span v-if="suffix" class="number-suffix">{{ suffix }}</span>
    </div>
  </div>
</template>

<style scoped>
.number-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.number-label {
  font-size: 11px;
  color: #aaa;
  white-space: nowrap;
}
.number-input-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
}
.number-input {
  width: 60px;
  padding: 3px 6px;
  font-size: 11px;
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 4px;
  color: #ddd;
  text-align: right;
}
.number-input:focus {
  outline: none;
  border-color: #5577aa;
}
.number-suffix {
  font-size: 10px;
  color: #888;
}
.number-input { min-height: 28px; box-sizing: border-box; }
.number-input:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 1px; }
.number-row.disabled { opacity: .4; }
.number-row.stacked { display: flex; flex-direction: column; align-items: stretch; gap: 4px; margin: 0; min-width: 0; }
.stacked .number-input-wrap { min-width: 0; }
.stacked .number-input { width: 100%; min-width: 0; }
</style>
