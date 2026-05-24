<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import type { PromptOptions } from './prompt'

const visible = ref(false)
const opts = ref<PromptOptions>({ title: '' })
const inputValue = ref('')
const inputEl = ref<HTMLInputElement | null>(null)
const activeIdx = ref(-1)
let resolve: ((value: string | null) => void) | null = null

const filtered = computed(() => {
  const list = opts.value.suggestions
  if (!list || !list.length) return []
  const q = inputValue.value.trim().toLowerCase()
  if (!q) return []
  return list.filter(s => s.toLowerCase().includes(q) && s.toLowerCase() !== q)
})

const showSuggestions = computed(() => filtered.value.length > 0 && visible.value)

function open(options: PromptOptions): Promise<string | null> {
  opts.value = options
  inputValue.value = options.defaultValue ?? ''
  activeIdx.value = -1
  visible.value = true
  nextTick(() => {
    inputEl.value?.focus()
    inputEl.value?.select()
  })
  return new Promise<string | null>((r) => {
    resolve = r
  })
}

function pick(val: string) {
  inputValue.value = val
  activeIdx.value = -1
  inputEl.value?.focus()
}

function handleConfirm() {
  const v = inputValue.value.trim()
  visible.value = false
  resolve?.(v || null)
  resolve = null
}

function handleCancel() {
  visible.value = false
  resolve?.(null)
  resolve = null
}

function onKeydown(e: KeyboardEvent) {
  const list = filtered.value
  if (list.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      activeIdx.value = (activeIdx.value + 1) % list.length
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      activeIdx.value = activeIdx.value <= 0 ? list.length - 1 : activeIdx.value - 1
      return
    }
    if (e.key === 'Tab' && activeIdx.value >= 0) {
      e.preventDefault()
      pick(list[activeIdx.value])
      return
    }
    if (e.key === 'Enter' && activeIdx.value >= 0) {
      e.preventDefault()
      pick(list[activeIdx.value])
      return
    }
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    handleConfirm()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    handleCancel()
  }
}

function onInput() {
  activeIdx.value = -1
}

defineExpose({ open })
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="prompt-overlay" @click.self="handleCancel">
      <div class="prompt-card">
        <h3 class="prompt-title">{{ opts.title }}</h3>
        <p v-if="opts.message" class="prompt-msg">{{ opts.message }}</p>
        <div class="prompt-input-wrap">
          <input
            ref="inputEl"
            v-model="inputValue"
            class="prompt-input"
            :placeholder="opts.placeholder"
            @keydown="onKeydown"
            @input="onInput"
          />
          <ul v-if="showSuggestions" class="prompt-suggestions">
            <li
              v-for="(item, idx) in filtered"
              :key="item"
              class="prompt-suggestion-item"
              :class="{ active: idx === activeIdx }"
              @mousedown.prevent="pick(item)"
            >
              {{ item }}
            </li>
          </ul>
        </div>
        <div class="prompt-actions">
          <button class="prompt-btn cancel" @click="handleCancel">
            {{ opts.cancelText || '取消' }}
          </button>
          <button class="prompt-btn primary" @click="handleConfirm">
            {{ opts.confirmText || '确认' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.prompt-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100000;
}
.prompt-card {
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 12px;
  padding: 24px;
  max-width: 400px;
  width: 90%;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
}
.prompt-title {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 600;
  color: #eee;
}
.prompt-msg {
  margin: 0 0 12px;
  font-size: 13px;
  color: #999;
  line-height: 1.5;
  white-space: pre-line;
}
.prompt-input-wrap {
  position: relative;
  margin-bottom: 16px;
}
.prompt-input {
  width: 100%;
  padding: 8px 12px;
  background: #333;
  color: #eee;
  border: 1px solid #555;
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s;
}
.prompt-input:focus {
  border-color: #5577aa;
}
.prompt-suggestions {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin: 4px 0 0;
  padding: 4px 0;
  background: #333;
  border: 1px solid #555;
  border-radius: 6px;
  max-height: 180px;
  overflow-y: auto;
  list-style: none;
  z-index: 10;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
}
.prompt-suggestion-item {
  padding: 6px 12px;
  font-size: 12px;
  color: #ccc;
  cursor: pointer;
  transition: background 0.1s;
}
.prompt-suggestion-item:hover,
.prompt-suggestion-item.active {
  background: #3a5070;
  color: #eee;
}
.prompt-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.prompt-btn {
  padding: 6px 16px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}
.prompt-btn.cancel {
  background: #383838;
  color: #aaa;
}
.prompt-btn.cancel:hover {
  background: #444;
  color: #ccc;
}
.prompt-btn.primary {
  background: #3a5070;
  color: #dde4f0;
}
.prompt-btn.primary:hover {
  background: #4a6888;
}
</style>
