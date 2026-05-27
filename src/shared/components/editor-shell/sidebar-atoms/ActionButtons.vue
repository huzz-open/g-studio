<script setup lang="ts">
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
  padding: 5px 10px;
  font-size: 11px;
  border-radius: 4px;
  border: 1px solid #444;
  cursor: pointer;
  transition: all 0.15s;
}
.action-btn.default {
  background: #2a2a2a;
  color: #ccc;
}
.action-btn.default:hover:not(:disabled) {
  background: #363636;
  border-color: #555;
}
.action-btn.primary {
  background: #3a5a7a;
  color: #ddeeff;
  border-color: #5577aa;
}
.action-btn.primary:hover:not(:disabled) {
  background: #4a6a8a;
}
.action-btn.danger {
  background: #5a2a2a;
  color: #ffcccc;
  border-color: #883333;
}
.action-btn.danger:hover:not(:disabled) {
  background: #6a3a3a;
}
.action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
