<script setup lang="ts">
const props = withDefaults(defineProps<{
  cols: number
  rows: number
  minCols?: number
  maxCols?: number
  minRows?: number
  maxRows?: number
}>(), {
  minCols: 1,
  maxCols: 100,
  minRows: 1,
  maxRows: 100,
})

const emit = defineEmits<{
  'update:cols': [value: number]
  'update:rows': [value: number]
}>()

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(v)))
}

function onColsInput(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(v)) return
  emit('update:cols', clamp(v, props.minCols, props.maxCols))
}

function onRowsInput(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(v)) return
  emit('update:rows', clamp(v, props.minRows, props.maxRows))
}
</script>

<template>
  <div class="grid-size-input">
    <input
      type="number"
      class="gsi-field"
      :value="cols"
      :min="minCols"
      :max="maxCols"
      @change="onColsInput"
    />
    <span class="gsi-sep">×</span>
    <input
      type="number"
      class="gsi-field"
      :value="rows"
      :min="minRows"
      :max="maxRows"
      @change="onRowsInput"
    />
  </div>
</template>

<style scoped>
.grid-size-input {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.gsi-field {
  width: 56px;
  background: #1e1e1e;
  border: 1px solid #555;
  border-radius: 5px;
  padding: 5px 6px;
  color: #eee;
  font-size: 12px;
  text-align: center;
  outline: none;
  transition: border-color 0.15s;
  -moz-appearance: textfield;
}
.gsi-field::-webkit-inner-spin-button,
.gsi-field::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.gsi-field:focus {
  border-color: #5b9cf6;
}
.gsi-sep {
  color: #888;
  font-size: 12px;
  user-select: none;
}
</style>
