<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import SvgIcon from '../icons/SvgIcon.vue'
import type { ToastAction } from './toast'

export interface ToastItem {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
  leaving: boolean
  action?: ToastAction
}

const toasts = ref<ToastItem[]>([])
let nextId = 0
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function show(message: string, type: ToastItem['type'] = 'info', duration = 3000, action?: ToastAction) {
  const id = ++nextId
  toasts.value.push({ id, message, type, leaving: false, action })

  const timer = setTimeout(() => dismiss(id), action ? Math.max(duration, 6000) : duration)
  timers.set(id, timer)
}

function dismiss(id: number) {
  const item = toasts.value.find(t => t.id === id)
  if (!item || item.leaving) return
  item.leaving = true
  const existing = timers.get(id)
  if (existing) { clearTimeout(existing); timers.delete(id) }
  setTimeout(() => {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }, 300)
}

function handleAction(item: ToastItem) {
  item.action?.onClick()
  dismiss(item.id)
}

onUnmounted(() => {
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
})

defineExpose({ show })
</script>

<template>
  <Teleport to="body">
    <div class="toast-container">
      <TransitionGroup name="toast">
        <div
          v-for="item in toasts"
          :key="item.id"
          class="toast-item"
          :class="[item.type, { leaving: item.leaving }]"
          @click.self="dismiss(item.id)"
        >
          <SvgIcon
            :name="item.type === 'success' ? 'check' : item.type === 'error' ? 'close' : 'eye'"
            :size="14"
          />
          <span>{{ item.message }}</span>
          <button
            v-if="item.action"
            class="toast-action"
            @click.stop="handleAction(item)"
          >{{ item.action.label }}</button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-container {
  position: fixed;
  top: 52px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10000;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}
.toast-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 18px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  pointer-events: auto;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  white-space: nowrap;
}
.toast-item.success {
  background: #2a4a38;
  border: 1px solid #3a6a50;
  color: #b0e8c8;
}
.toast-item.error {
  background: #4a2a2a;
  border: 1px solid #6a3a3a;
  color: #e8b0b0;
}
.toast-item.info {
  background: #2a3a4a;
  border: 1px solid #3a5a6a;
  color: #b0d0e8;
}
.toast-action {
  margin-left: 8px;
  padding: 2px 10px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  color: inherit;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s;
}
.toast-action:hover {
  background: rgba(255, 255, 255, 0.2);
}

.toast-enter-active {
  transition: all 0.3s ease-out;
}
.toast-leave-active {
  transition: all 0.3s ease-in;
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(-12px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
