<script setup lang="ts">
import { useI18n } from '../i18n'
import SvgIcon from '../icons/SvgIcon.vue'

const { t } = useI18n()

defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'save-browser'): void
  (e: 'open-workspace'): void
  (e: 'cancel'): void
}>()
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="dialog-overlay" @click.self="emit('cancel')">
      <div class="dialog-card">
        <div class="dialog-header">
          <SvgIcon name="download" :size="20" />
          <h3>{{ t('savePrompt.title') }}</h3>
        </div>
        <p class="dialog-desc">{{ t('savePrompt.desc') }}</p>

        <div class="dialog-options">
          <button class="option-btn workspace" @click="emit('open-workspace')">
            <SvgIcon name="folder-open" :size="20" />
            <div class="option-text">
              <span class="option-title">{{ t('savePrompt.toWorkspace') }}</span>
              <span class="option-desc">{{ t('savePrompt.toWorkspaceDesc') }}</span>
            </div>
          </button>

          <button class="option-btn browser" @click="emit('save-browser')">
            <SvgIcon name="globe" :size="20" />
            <div class="option-text">
              <span class="option-title">{{ t('savePrompt.toBrowser') }}</span>
              <span class="option-desc">{{ t('savePrompt.toBrowserDesc') }}</span>
            </div>
          </button>
        </div>

        <button class="cancel-btn" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}
.dialog-card {
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 14px;
  padding: 28px;
  max-width: 420px;
  width: 90%;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
}
.dialog-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  color: #eee;
}
.dialog-header h3 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}
.dialog-desc {
  font-size: 13px;
  color: #999;
  margin: 0 0 20px;
  line-height: 1.5;
}
.dialog-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
}
.option-btn {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid #444;
  border-radius: 10px;
  background: #333;
  color: #ddd;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s;
}
.option-btn:hover {
  border-color: #666;
  transform: translateY(-1px);
}
.option-btn.workspace {
  border-color: #3a6a4a;
  background: #2a3a30;
}
.option-btn.workspace:hover {
  border-color: #5a9a6a;
  background: #2e4038;
}
.option-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.option-title {
  font-size: 14px;
  font-weight: 500;
}
.option-desc {
  font-size: 12px;
  color: #888;
  line-height: 1.4;
}
.cancel-btn {
  display: block;
  width: 100%;
  padding: 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #888;
  font-size: 13px;
  cursor: pointer;
  transition: color 0.15s;
}
.cancel-btn:hover { color: #bbb; }
</style>
