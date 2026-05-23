<script setup lang="ts">
import { ref } from 'vue'
import type { ConfirmOptions } from './confirm'

defineProps<{
  visible?: boolean
  title?: string
  message?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const imperativeVisible = ref(false)
const imperativeOpts = ref<ConfirmOptions>({ title: '', message: '' })
let imperativeResolve: ((value: boolean) => void) | null = null

function open(options: ConfirmOptions): Promise<boolean> {
  imperativeOpts.value = options
  imperativeVisible.value = true
  return new Promise<boolean>((resolve) => {
    imperativeResolve = resolve
  })
}

function handleConfirm() {
  if (imperativeVisible.value) {
    imperativeVisible.value = false
    imperativeResolve?.(true)
    imperativeResolve = null
  } else {
    emit('confirm')
  }
}

function handleCancel() {
  if (imperativeVisible.value) {
    imperativeVisible.value = false
    imperativeResolve?.(false)
    imperativeResolve = null
  } else {
    emit('cancel')
  }
}

defineExpose({ open })
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible || imperativeVisible"
      class="confirm-overlay"
      @click.self="handleCancel"
    >
      <div class="confirm-card">
        <h3 class="confirm-title">
          {{ imperativeVisible ? imperativeOpts.title : title }}
        </h3>
        <p class="confirm-msg">
          {{ imperativeVisible ? imperativeOpts.message : message }}
        </p>
        <div class="confirm-actions">
          <button class="confirm-btn cancel" @click="handleCancel">
            {{ (imperativeVisible ? imperativeOpts.cancelText : cancelText) || '取消' }}
          </button>
          <button
            class="confirm-btn"
            :class="(imperativeVisible ? imperativeOpts.danger : danger) ? 'danger' : 'primary'"
            @click="handleConfirm"
          >
            {{ (imperativeVisible ? imperativeOpts.confirmText : confirmText) || '确认' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}
.confirm-card {
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 12px;
  padding: 24px;
  max-width: 380px;
  width: 90%;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
}
.confirm-title {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 600;
  color: #eee;
}
.confirm-msg {
  margin: 0 0 20px;
  font-size: 13px;
  color: #999;
  line-height: 1.5;
  white-space: pre-line;
}
.confirm-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.confirm-btn {
  padding: 6px 16px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}
.confirm-btn.cancel {
  background: #383838;
  color: #aaa;
}
.confirm-btn.cancel:hover {
  background: #444;
  color: #ccc;
}
.confirm-btn.primary {
  background: #3a5070;
  color: #dde4f0;
}
.confirm-btn.primary:hover {
  background: #4a6888;
}
.confirm-btn.danger {
  background: #6a3030;
  color: #f0d0d0;
}
.confirm-btn.danger:hover {
  background: #8a4040;
}
</style>
