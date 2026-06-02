<script setup lang="ts">
import SvgIcon from '../../../icons/SvgIcon.vue'

export interface ActionButton {
  id: string
  label: string
  icon?: string
  variant?: 'default' | 'primary' | 'danger'
  disabled?: boolean
}

defineProps<{
  buttons: ActionButton[]
  direction?: 'row' | 'column'
}>()

const emit = defineEmits<{
  click: [id: string]
}>()
</script>

<template>
  <div class="action-buttons" :class="direction ?? 'row'">
    <button
      v-for="btn in buttons"
      :key="btn.id"
      class="action-btn"
      :class="btn.variant ?? 'default'"
      :disabled="btn.disabled"
      @click="emit('click', btn.id)"
    >
      <SvgIcon v-if="btn.icon" :name="btn.icon" :size="12" />
      {{ btn.label }}
    </button>
  </div>
</template>

<style scoped>
.action-buttons {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}
.action-buttons.column {
  flex-direction: column;
}
.action-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  font-family: inherit;
  border-radius: 5px;
  border: 1px solid #555;
  cursor: pointer;
  text-align: center;
  transition: all 0.15s;
}
.action-btn.default {
  background: #333;
  color: #ccc;
}
.action-btn.default:hover:not(:disabled) {
  border-color: #888;
  color: #eee;
}
.action-btn.default:disabled {
  background: #2c2c2c;
  color: #666;
  border-color: #444;
}
.action-btn.primary {
  background: #3a5a7a;
  color: #ddeeff;
  border-color: #5577aa;
}
.action-btn.primary:hover:not(:disabled) {
  background: #4a6a8a;
}
.action-btn.primary:disabled {
  background: #2a3a4a;
  color: #667788;
  border-color: #3a4a5a;
}
.action-btn.danger {
  background: #5a2a2a;
  color: #ffcccc;
  border-color: #883333;
}
.action-btn.danger:hover:not(:disabled) {
  background: #6a3a3a;
}
.action-btn.danger:disabled {
  background: #3a2020;
  color: #775555;
  border-color: #4a2a2a;
}
.action-btn:disabled {
  cursor: not-allowed;
}
</style>
