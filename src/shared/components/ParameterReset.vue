<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../i18n'
import { parameterValuesEqual } from '../utils/parameter-values'
const props = withDefaults(defineProps<{ changed?: boolean; modelValue?: string | number | boolean; label: string; defaultValue: string | number | boolean; disabled?: boolean }>(), { changed: undefined })
const isChanged = computed(() => props.changed ?? !parameterValuesEqual(props.modelValue, props.defaultValue))
const defaultLabel = computed(() => typeof props.defaultValue === 'boolean' ? t(props.defaultValue ? 'common.on' : 'common.off') : props.defaultValue)
const emit = defineEmits<{ reset: [] }>()
const { t } = useI18n()
</script>

<template>
  <button type="button" class="parameter-reset" :class="{ unchanged: !isChanged }" :disabled="disabled || !isChanged"
    :aria-label="t('common.resetParameter', { name: label })"
    :title="t('common.resetParameterTip', { name: label, value: defaultLabel })" @click.stop="emit('reset')">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10a8 8 0 1 1 2 9M4 4v6h6" /></svg>
  </button>
</template>

<style scoped>
.parameter-reset { display: grid; place-items: center; width: 22px; height: 24px; flex-shrink: 0; padding: 0; color: #a9b8cc; background: transparent; border: 1px solid transparent; border-radius: 4px; cursor: pointer; }
.parameter-reset:hover { color: #dbeaff; background: #40526a; border-color: #60758f; }
.parameter-reset:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 1px; }
.unchanged { visibility: hidden; pointer-events: none; }
</style>
