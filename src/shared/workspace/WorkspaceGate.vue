<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from '../i18n'
import SvgIcon from '../icons/SvgIcon.vue'
import { useWorkspace } from './workspace-manager'

const { t } = useI18n()
const { openWorkspace } = useWorkspace()

const error = ref('')

const dirStructure = [
  { dir: 'spritesheets', key: 'workspace.dir.spritesheets', icon: 'image' },
  { dir: 'icons', key: 'workspace.dir.icons', icon: 'grid' },
  { dir: 'animations', key: 'workspace.dir.animations', icon: 'play' },
  { dir: 'tiles', key: 'workspace.dir.tiles', icon: 'grid' },
  { dir: 'items', key: 'workspace.dir.items', icon: 'layers' },
  { dir: 'maps', key: 'workspace.dir.maps', icon: 'map' },
]

async function handleOpen() {
  error.value = ''
  try {
    await openWorkspace()
  } catch (e) {
    if (e instanceof Error && e.name !== 'AbortError') {
      error.value = e.message
    }
  }
}
</script>

<template>
  <div class="workspace-panel">
    <div class="panel-card">
      <div class="panel-logo">
        <SvgIcon name="layers" :size="40" />
      </div>
      <h2>{{ t('workspace.title') }}</h2>
      <p class="panel-subtitle">{{ t('workspace.subtitle') }}</p>

      <button class="open-btn" @click="handleOpen">
        <SvgIcon name="folder-open" :size="18" />
        <span>{{ t('workspace.open') }}</span>
      </button>

      <p v-if="error" class="panel-error">{{ error }}</p>

      <div class="structure-preview">
        <p class="structure-label">{{ t('workspace.structure') }}</p>
        <div class="tree">
          <div class="tree-root">
            <SvgIcon name="folder-open" :size="14" />
            <span class="tree-root-name">your-project/</span>
          </div>
          <div v-for="item in dirStructure" :key="item.dir" class="tree-item">
            <span class="tree-branch">├── </span>
            <SvgIcon :name="item.icon" :size="12" />
            <span class="tree-dir">{{ item.dir }}/</span>
            <span class="tree-desc">{{ t(item.key) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.workspace-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 24px;
}
.panel-card { text-align: center; max-width: 440px; width: 100%; }
.panel-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  background: linear-gradient(135deg, #4a8a6a, #3a7a5a);
  border-radius: 18px;
  color: #fff;
  margin-bottom: 16px;
}
.panel-card h2 { font-size: 22px; color: #eee; margin: 0 0 6px; font-weight: 600; }
.panel-subtitle { font-size: 13px; color: #888; margin: 0 0 24px; line-height: 1.5; }
.open-btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 12px 28px;
  border: none;
  border-radius: 10px;
  background: linear-gradient(135deg, #4a8a6a, #3a7a5a);
  color: #fff;
  font-size: 15px;
  cursor: pointer;
  transition: all 0.2s;
}
.open-btn:hover {
  background: linear-gradient(135deg, #5a9a7a, #4a8a6a);
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(74, 138, 106, 0.3);
}
.panel-error { color: #e66; font-size: 13px; margin: 12px 0 0; }
.structure-preview {
  margin-top: 32px;
  text-align: left;
  background: #222;
  border: 1px solid #333;
  border-radius: 10px;
  padding: 14px 18px;
}
.structure-label { font-size: 11px; color: #777; margin: 0 0 10px; }
.tree { font-family: 'Cascadia Code', 'Fira Code', monospace; font-size: 12px; line-height: 1.8; }
.tree-root { display: flex; align-items: center; gap: 6px; color: #e0c080; margin-bottom: 2px; }
.tree-root-name { font-weight: 600; }
.tree-item { display: flex; align-items: center; gap: 4px; padding-left: 8px; }
.tree-branch { color: #555; user-select: none; }
.tree-dir { color: #8ab4f8; }
.tree-desc { color: #666; font-size: 10px; margin-left: 8px; font-family: -apple-system, sans-serif; }
</style>
