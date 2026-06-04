<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from '../../i18n'

const props = withDefaults(defineProps<{
  accept?: string
}>(), {
  accept: '*/*',
})

const emit = defineEmits<{
  select: [file: File]
}>()

const { t } = useI18n()
const fileInput = ref<HTMLInputElement>()

function onClick() {
  fileInput.value?.click()
}

function onFileSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) emit('select', file)
  input.value = ''
}
</script>

<template>
  <div class="empty-drop-hint">
    <p class="hint-text">
      {{ t('common.emptyDropHint') }}<span class="hint-action" @click="onClick">{{ t('common.emptyClickAction') }}</span>
    </p>
    <input
      ref="fileInput"
      type="file"
      :accept="accept"
      style="display:none"
      @change="onFileSelected"
    />
  </div>
</template>

<style scoped>
.empty-drop-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.hint-text {
  font-size: 13px;
  color: #888;
  margin: 0;
}
.hint-action {
  color: #8ab4f8;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.hint-action:hover {
  color: #aecbfa;
}
</style>
