<script setup lang="ts">
import ParameterReset from '../../ParameterReset.vue'
import InfoHint from '../../InfoHint.vue'
import { computed, useId } from 'vue'
import { useI18n } from '../../../i18n'
const inputId = useId()
const { t } = useI18n()
const props = withDefaults(defineProps<{
  label: string
  hint?: string
  defaultValue?: number
  modelValue: number
  min?: number
  max?: number
  step?: number
  suffix?: string
  disabled?: boolean
  stacked?: boolean
  compact?: boolean
  live?: boolean
  /** Show an inline random button for integer ranges (step = 1). */
  randomize?: boolean
}>(), {
  step: 1,
})

const emit = defineEmits<{
  'update:modelValue': [val: number]
  commit: [val: number]
}>()

const randomRange = computed(() => {
  const { min, max, step } = props
  if (min === undefined || max === undefined || step !== 1) return undefined
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max <= min || !Number.isSafeInteger(max - min + 1)) return undefined
  return { min, max }
})

function randomizeValue() {
  if (props.disabled || !randomRange.value) return
  const { min, max } = randomRange.value
  const currentInRange = Number.isInteger(props.modelValue) && props.modelValue >= min && props.modelValue <= max
  // Exclude the current value so every click produces a new number.
  const count = max - min + 1 - Number(currentInRange)
  let value = min + Math.floor(Math.random() * count)
  if (currentInRange && value >= props.modelValue) value++
  emit('update:modelValue', value)
  emit('commit', value)
}

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
  if (e.type === 'change') emit('commit', v)
}
</script>

<template>
  <div class="number-row" :class="{ disabled, stacked, compact }">
    <div class="number-heading"><label :for="inputId" class="number-label">{{ label }}</label><InfoHint v-if="hint" :text="hint" :label="label" /></div>
    <div class="number-input-wrap">
      <ParameterReset v-if="defaultValue !== undefined" :model-value="modelValue" :default-value="defaultValue" :label="label" :disabled="disabled" @reset="emit('update:modelValue', defaultValue!); emit('commit', defaultValue!)" />
      <span class="number-field" :class="{ 'with-random': randomize }">
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
        <button v-if="randomize" type="button" class="number-random" :disabled="disabled || !randomRange"
          :aria-label="t('common.randomizeParameter', { name: label })" :title="t('common.randomizeParameter', { name: label })" @click="randomizeValue">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="4" />
            <g fill="currentColor" stroke="none"><circle cx="8" cy="8" r="1.3" /><circle cx="16" cy="8" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="8" cy="16" r="1.3" /><circle cx="16" cy="16" r="1.3" /></g>
          </svg>
        </button>
      </span>
      <span v-if="suffix" class="number-suffix">{{ suffix }}</span>
    </div>
  </div>
</template>

<style scoped>
.number-heading { display:flex; align-items:center; gap:4px; }
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
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}
.number-input {
  width: 92px;
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
.number-row.compact { flex-direction: row; align-items: center; flex-wrap: nowrap; gap: 4px; margin: 0; min-width: 0; }
.compact .number-label { flex-shrink: 0; }
.compact .number-input-wrap { flex-shrink:1; flex: 1; min-width: 0; justify-content: flex-end; gap: 2px; }
.compact .number-input { width: 48px; min-width: 48px; padding: 3px 4px; }
.number-field { display:contents; }
.number-field.with-random { position:relative; display:inline-flex; min-width:0; }
.with-random .number-input { min-width:128px; padding-right:32px; appearance:textfield; }
.with-random .number-input::-webkit-inner-spin-button,
.with-random .number-input::-webkit-outer-spin-button { appearance:none; margin:0; }
.number-random { position:absolute; right:3px; top:50%; transform:translateY(-50%); display:grid; place-items:center; width:24px; height:22px; padding:0; border:0; border-radius:3px; background:transparent; color:#a9b8cc; cursor:pointer; }
.number-random:hover:not(:disabled) { background:#3b4655; color:#dbeaff; }
.number-random:focus-visible { outline:2px solid #8ab4f8; outline-offset:1px; }
.number-random:disabled { cursor:default; }
.stacked .number-field.with-random { flex:1; }
</style>
