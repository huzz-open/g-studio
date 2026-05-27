<script setup lang="ts">
import { ref } from 'vue'
import SvgIcon from '../../../icons/SvgIcon.vue'

defineProps<{
  label: string
  modelValue: string[]
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [val: string[]]
}>()

const inputVal = ref('')

function addTag() {
  const tag = inputVal.value.trim()
  if (!tag) return
  emit('update:modelValue', [...new Set([...arguments[0], tag])])
  inputVal.value = ''
}

function removeTag(tag: string, tags: string[]) {
  emit('update:modelValue', tags.filter(t => t !== tag))
}

function onKeyDown(e: KeyboardEvent, tags: string[]) {
  if (e.key === 'Enter') {
    e.preventDefault()
    const tag = inputVal.value.trim()
    if (!tag) return
    emit('update:modelValue', [...new Set([...tags, tag])])
    inputVal.value = ''
  }
}
</script>

<template>
  <div class="tag-input">
    <label class="tag-label">{{ label }}</label>
    <div class="tag-list">
      <span v-for="tag in modelValue" :key="tag" class="tag-chip">
        {{ tag }}
        <button class="tag-remove" @click="removeTag(tag, modelValue)">
          <SvgIcon name="close" :size="8" />
        </button>
      </span>
    </div>
    <input
      v-model="inputVal"
      class="tag-input-field"
      :placeholder="placeholder"
      @keydown="onKeyDown($event, modelValue)"
    />
  </div>
</template>

<style scoped>
.tag-input {
  margin-bottom: 6px;
}
.tag-label {
  display: block;
  font-size: 11px;
  color: #aaa;
  margin-bottom: 4px;
}
.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 4px;
}
.tag-chip {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  font-size: 10px;
  background: #3a3a3a;
  border-radius: 3px;
  color: #ccc;
}
.tag-remove {
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
}
.tag-remove:hover { color: #ff8888; }
.tag-input-field {
  width: 100%;
  padding: 4px 8px;
  font-size: 11px;
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 4px;
  color: #ddd;
}
.tag-input-field:focus { outline: none; border-color: #5577aa; }
</style>
