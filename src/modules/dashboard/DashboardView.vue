<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useI18n } from '../../shared/i18n'
import SvgIcon from '../../shared/icons/SvgIcon.vue'

const router = useRouter()
const { t } = useI18n()

const modules = [
  {
    route: '/resource-manager',
    icon: 'folder-open',
    titleKey: 'dashboard.resourceManager.title',
    descKey: 'dashboard.resourceManager.desc',
    color: '#4a8a6a',
  },
  {
    route: '/sprite-slicer',
    icon: 'scissors',
    titleKey: 'dashboard.spriteSlicer.title',
    descKey: 'dashboard.spriteSlicer.desc',
    color: '#5577aa',
  },
  {
    route: '/map-editor',
    icon: 'map',
    titleKey: 'dashboard.mapEditor.title',
    descKey: 'dashboard.mapEditor.desc',
    color: '#aa7744',
  },
  {
    route: '/tileset-maker',
    icon: 'grid',
    titleKey: 'dashboard.tilesetMaker.title',
    descKey: 'dashboard.tilesetMaker.desc',
    color: '#6a8a5a',
  },
  {
    route: '/scene-region-editor',
    icon: 'layers',
    titleKey: 'dashboard.sceneRegionEditor.title',
    descKey: 'dashboard.sceneRegionEditor.desc',
    color: '#5a7a9a',
  },
]
</script>

<template>
  <div class="dashboard">
    <div class="dashboard-header">
      <h1>{{ t('dashboard.title') }}</h1>
      <p class="subtitle">{{ t('dashboard.subtitle') }}</p>
    </div>
    <div class="module-grid">
      <button
        v-for="m in modules"
        :key="m.route"
        class="module-card"
        @click="router.push(m.route)"
      >
        <div class="card-icon" :style="{ background: m.color }">
          <SvgIcon :name="m.icon" :size="32" />
        </div>
        <div class="card-info">
          <h3>{{ t(m.titleKey) }}</h3>
          <p>{{ t(m.descKey) }}</p>
        </div>
      </button>
    </div>
  </div>
</template>

<style scoped>
.dashboard {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  overflow: auto;
}
.dashboard-header {
  text-align: center;
  margin-bottom: 48px;
}
.dashboard-header h1 {
  font-size: 28px;
  color: #eee;
  margin: 0 0 8px;
  font-weight: 600;
}
.subtitle {
  font-size: 14px;
  color: #888;
  margin: 0;
}
.module-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 20px;
  max-width: 960px;
  width: 100%;
}
.module-card {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 24px;
  background: #2a2a2a;
  border: 1px solid #3a3a3a;
  border-radius: 12px;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.2s, transform 0.15s, box-shadow 0.2s;
  color: inherit;
  font: inherit;
}
.module-card:hover {
  border-color: #555;
  transform: translateY(-2px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}
.card-icon {
  width: 64px;
  height: 64px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #fff;
}
.card-info h3 {
  margin: 0 0 6px;
  font-size: 16px;
  color: #eee;
}
.card-info p {
  margin: 0;
  font-size: 13px;
  color: #888;
  line-height: 1.4;
}
</style>
