<script setup lang="ts">
import { useI18n } from '../../../shared/i18n'
defineProps<{ changed: boolean; label: string; defaultValue: string | number }>()
const emit = defineEmits<{ reset: [] }>()
const { t } = useI18n()
</script>

<template>
  <button type="button" class="parameter-reset" :class="{ unchanged: !changed }" :disabled="!changed"
    :aria-label="t('normal.resetParameter', { name: label })"
    :title="t('normal.resetParameterTip', { name: label, value: defaultValue })" @click.stop="emit('reset')">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10a8 8 0 1 1 2 9M4 4v6h6" /></svg>
  </button>
</template>

<style scoped>
.parameter-reset { display: grid; place-items: center; width: 22px; height: 24px; padding: 0; color: #a9b8cc; background: transparent; border: 1px solid transparent; border-radius: 4px; cursor: pointer; }
.parameter-reset:hover { color: #dbeaff; background: #40526a; border-color: #60758f; }
.parameter-reset:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 1px; }
.unchanged { visibility: hidden; pointer-events: none; }
</style>
