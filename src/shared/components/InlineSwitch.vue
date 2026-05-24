<script setup lang="ts">
defineProps<{
  modelValue: boolean
  label: string
  tooltip?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()
</script>

<template>
  <label class="il-switch" :class="{ disabled }" :title="tooltip">
    <span v-if="label" class="il-switch-label">{{ label }}</span>
    <span class="il-switch-track" :class="{ on: modelValue }" @click.prevent="!disabled && emit('update:modelValue', !modelValue)">
      <span class="il-switch-thumb" />
    </span>
  </label>
</template>

<style scoped>
.il-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 12px;
  color: #bbb;
  user-select: none;
}
.il-switch.disabled {
  opacity: 0.4;
  cursor: default;
}
.il-switch-label {
  white-space: nowrap;
}
.il-switch-track {
  position: relative;
  width: 28px;
  height: 16px;
  border-radius: 8px;
  background: #444;
  flex-shrink: 0;
  transition: background 0.2s;
}
.il-switch-track.on {
  background: #3a6a5a;
}
.il-switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #999;
  transition: transform 0.2s, background 0.2s;
}
.il-switch-track.on .il-switch-thumb {
  transform: translateX(12px);
  background: #d0f0e0;
}
</style>
