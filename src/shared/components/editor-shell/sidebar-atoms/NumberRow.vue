<script setup lang="ts">
const props = withDefaults(defineProps<{
  label: string
  modelValue: number
  min?: number
  max?: number
  step?: number
  suffix?: string
}>(), {
  step: 1,
})

const emit = defineEmits<{
  'update:modelValue': [val: number]
}>()

function onInput(e: Event) {
  const raw = +(e.target as HTMLInputElement).value
  let v = raw
  if (props.min !== undefined) v = Math.max(props.min, v)
  if (props.max !== undefined) v = Math.min(props.max, v)
  emit('update:modelValue', v)
}
</script>

<template>
  <div class="number-row">
    <label class="number-label">{{ label }}</label>
    <div class="number-input-wrap">
      <input
        type="number"
        class="number-input"
        :value="modelValue"
        :min="min"
        :max="max"
        :step="step"
        @change="onInput"
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
</style>
