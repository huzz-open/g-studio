<script setup lang="ts">
import { computed } from 'vue'
import ActionButtons, { type ActionButton } from '../components/editor-shell/sidebar-atoms/ActionButtons.vue'
import { useI18n } from '../i18n'
export type GenerationAction = 'initial' | 'overwrite' | 'new'
const props = defineProps<{ existing: boolean; disabled?: boolean; busy?: boolean; replacing?: boolean }>()
const emit = defineEmits<{ generate: [mode: GenerationAction] }>()
const { t } = useI18n()
const buttons = computed<ActionButton[]>(() => props.existing ? [
  { id:'overwrite', label:t('generation.overwrite'), icon:'loop', disabled:props.disabled || props.busy || props.replacing },
  { id:'new', label:t('generation.generateNew'), icon:'plus', disabled:props.disabled || props.busy },
] : [{ id:'initial', label:t(props.busy ? 'common.loading' : 'generation.generate'), icon:'wand', variant:'primary', disabled:props.disabled || props.busy }])
</script>
<template><ActionButtons :buttons="buttons" @click="id=>emit('generate', id as GenerationAction)" /></template>
