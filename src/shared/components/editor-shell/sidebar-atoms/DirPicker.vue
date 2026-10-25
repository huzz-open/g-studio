<script setup lang="ts">
import { useId } from 'vue'
const inputId = useId()
import SvgIcon from '../../../icons/SvgIcon.vue'

defineProps<{
  label: string
  modelValue: string
  placeholder?: string
  options?: string[]
  disabled?: boolean
  actionLabel?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [val: string]
  browse: []
}>()
</script>

<template>
  <div class="dir-picker" :class="{ disabled }">
    <label :for="inputId" class="dir-label">{{ label }}</label>
    <div class="dir-input-row">
      <select :id="inputId" v-if="options" class="dir-input" :aria-label="label" :value="modelValue" :disabled="disabled" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)">
        <option v-for="option in [...new Set([...options, modelValue])]" :key="option" :value="option">{{ option }}</option>
      </select>
      <input :id="inputId" v-else
        type="text"
        class="dir-input"
        :value="modelValue"
        :aria-label="label"
        :disabled="disabled"
        :placeholder="placeholder"
        readonly
        @click="emit('browse')"
        @keydown.enter.prevent="emit('browse')"
        @keydown.space.prevent="emit('browse')"
      />
      <button class="dir-btn" :disabled="disabled" :aria-label="actionLabel || label" :title="actionLabel || label" @click="emit('browse')">
        <SvgIcon :name="options ? 'plus' : 'folder'" :size="12" />
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
.dir-input { min-width: 0; min-height: 28px; box-sizing: border-box; }
.dir-btn { width: 28px; padding: 0; justify-content: center; }
.dir-input:focus-visible, .dir-btn:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 1px; }
.dir-picker.disabled { opacity: .4; }
.dir-btn:disabled { cursor: default; }
</style>
