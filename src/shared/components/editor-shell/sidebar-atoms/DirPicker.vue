<script setup lang="ts">
import SvgIcon from '../../../icons/SvgIcon.vue'

defineProps<{
  label: string
  modelValue: string
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [val: string]
  browse: []
}>()
</script>

<template>
  <div class="dir-picker">
    <label class="dir-label">{{ label }}</label>
    <div class="dir-input-row">
      <input
        type="text"
        class="dir-input"
        :value="modelValue"
        :placeholder="placeholder"
        readonly
        @click="emit('browse')"
      />
      <button class="dir-btn" @click="emit('browse')">
        <SvgIcon name="folder" :size="12" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.dir-picker {
  margin-bottom: 6px;
}
.dir-label {
  display: block;
  font-size: 11px;
  color: #aaa;
  margin-bottom: 4px;
}
.dir-input-row {
  display: flex;
  gap: 4px;
}
.dir-input {
  flex: 1;
  padding: 4px 8px;
  font-size: 11px;
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 4px;
  color: #ccc;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dir-input:focus { outline: none; border-color: #5577aa; }
.dir-btn {
  padding: 4px 8px;
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 4px;
  color: #aaa;
  cursor: pointer;
  display: flex;
  align-items: center;
}
.dir-btn:hover { background: #363636; color: #ddd; }
</style>
