<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../../shared/i18n'
import {
  SidebarSection,
  ColorRow,
  SliderRow,
  SelectRow,
  RadioGroup,
  CheckboxRow,
  ActionButtons,
} from '../../../shared/components/editor-shell'
import type { RadioOption, ActionButton } from '../../../shared/components/editor-shell'
import SvgIcon from '../../../shared/icons/SvgIcon.vue'
import { prompt } from '../../../shared/components/prompt'
import type { SceneRegionStore } from '../store'

const props = defineProps<{
  store: SceneRegionStore
}>()

const emit = defineEmits<{
  'export-tscn': []
  'export-json': []
  'import-json': []
}>()

const { t } = useI18n()

const isCreationMode = computed(() =>
  props.store.state.activeTool !== 'select'
)

const filterOptions = computed(() => [
  { value: 'all', label: t('sceneEditor.filter.all') },
  { value: 'occlude', label: t('sceneEditor.filter.occlude') },
  { value: 'collision', label: t('sceneEditor.filter.collision') },
])

const presetOpacity = computed(() => {
  const g = props.store.state.creationPreset.groups.find(g => g.startsWith('occlude_opacity_'))
  if (!g) return 0
  return parseInt(g.replace('occlude_opacity_', ''), 10)
})

function setPresetOpacity(val: number) {
  const groups = props.store.state.creationPreset.groups.filter(g => !g.startsWith('occlude_opacity_'))
  groups.push(`occlude_opacity_${val}`)
  props.store.state.creationPreset.groups = groups
}

const typeOptions = computed<RadioOption[]>(() => [
  { value: 'occlude', label: t('sceneEditor.type.occlude') },
  { value: 'collision', label: t('sceneEditor.type.collision') },
])

const depthOptions = computed<RadioOption[]>(() => [
  { value: 'top_layer', label: t('sceneEditor.group.topLayer'), title: t('sceneEditor.group.topLayer.tip') },
  { value: 'y_sort', label: t('sceneEditor.group.ySort'), title: t('sceneEditor.group.ySort.tip') },
])

const presetDepthMode = computed(() => {
  const groups = props.store.state.creationPreset.groups
  if (groups.includes('occlude_y_sort')) return 'y_sort'
  return 'top_layer'
})

function setPresetDepthMode(mode: string) {
  const groups = props.store.state.creationPreset.groups.filter(
    g => g !== 'occlude_top_layer' && g !== 'occlude_y_sort'
  )
  groups.push(mode === 'y_sort' ? 'occlude_y_sort' : 'occlude_top_layer')
  props.store.state.creationPreset.groups = groups
}

const isPresetScreenMask = computed(() =>
  props.store.state.creationPreset.groups.includes('occlude_screen_mask')
)

function togglePresetScreenMask(val: boolean) {
  const groups = props.store.state.creationPreset.groups
  const idx = groups.indexOf('occlude_screen_mask')
  if (val && idx < 0) groups.push('occlude_screen_mask')
  else if (!val && idx >= 0) groups.splice(idx, 1)
}

async function onSavePreset() {
  const name = await prompt({
    title: t('sceneEditor.preset.saveAs'),
    message: t('sceneEditor.preset.namePrompt'),
  })
  if (name) {
    props.store.savePreset(name)
  }
}

const hasRegions = computed(() => props.store.state.regions.length > 0)

const exportButtons = computed<ActionButton[]>(() => [
  { id: 'tscn', label: t('sceneEditor.export.tscn'), disabled: !hasRegions.value },
  { id: 'json', label: t('sceneEditor.export.json'), disabled: !hasRegions.value },
  { id: 'import', label: t('sceneEditor.import.json') },
])

function onExportAction(id: string) {
  if (id === 'tscn') emit('export-tscn')
  else if (id === 'json') emit('export-json')
  else if (id === 'import') emit('import-json')
}
</script>

<template>
  <!-- Toolbar: select / rect / polygon -->
  <div class="tool-bar">
    <button
      class="tool-btn"
      :class="{ active: store.state.activeTool === 'select' }"
      :title="t('sceneEditor.tool.select')"
      @click="store.state.activeTool = 'select'"
    >
      <SvgIcon name="cursor" :size="14" />
    </button>
    <div class="tool-group">
      <button
        class="tool-btn"
        :class="{ active: store.state.activeTool === 'rect' }"
        :title="t('sceneEditor.tool.rect')"
        @click="store.state.activeTool = 'rect'"
      >
        <SvgIcon name="rect-select" :size="14" />
      </button>
      <button
        class="tool-btn"
        :class="{ active: store.state.activeTool === 'polygon' }"
        :title="t('sceneEditor.tool.polygon')"
        @click="store.state.activeTool = 'polygon'"
      >
        <SvgIcon name="pentagon" :size="14" />
      </button>
    </div>
  </div>

  <!-- Creation Preset (only in creation mode) -->
  <SidebarSection
    v-if="isCreationMode"
    :title="t('sceneEditor.preset.title')"
    icon="settings"
  >
    <RadioGroup
      :label="t('sceneEditor.preset.type')"
      :model-value="store.state.creationPreset.type"
      :options="typeOptions"
      @update:model-value="store.state.creationPreset.type = $event as any"
    />

    <ColorRow
      :label="t('sceneEditor.preset.color')"
      :model-value="store.state.creationPreset.color"
      @update:model-value="store.setPresetColorManual($event)"
    />

    <template v-if="store.state.creationPreset.type === 'occlude'">
      <RadioGroup
        :label="t('sceneEditor.preset.depthMode')"
        :model-value="presetDepthMode"
        :options="depthOptions"
        direction="row"
        @update:model-value="setPresetDepthMode"
      />

      <CheckboxRow
        :label="t('sceneEditor.group.screenMask')"
        :model-value="isPresetScreenMask"
        :title="t('sceneEditor.group.screenMask.tip')"
        @update:model-value="togglePresetScreenMask"
      />

      <SliderRow
        :label="t('sceneEditor.property.opacity')"
        :model-value="presetOpacity"
        :min="0"
        :max="100"
        :step="1"
        suffix="%"
        @update:model-value="setPresetOpacity($event)"
      />
    </template>

    <ActionButtons
      :buttons="[{ id: 'save', label: t('sceneEditor.preset.saveAs') }]"
      @click="onSavePreset"
    />

    <!-- Saved presets -->
    <template v-if="store.state.savedPresets.length > 0">
      <div class="group-section-label">{{ t('sceneEditor.preset.saved') }}</div>
      <div
        v-for="p in store.state.savedPresets"
        :key="p.id"
        class="preset-item"
        @click="store.applyPreset(p)"
      >
        <span class="preset-color" :style="{ background: p.color }" />
        <span class="preset-name">{{ p.name }}</span>
        <button class="preset-delete" @click.stop="store.deletePreset(p.id)">
          <SvgIcon name="close" :size="10" />
        </button>
      </div>
    </template>
  </SidebarSection>

  <!-- Region List -->
  <SidebarSection :title="t('sceneEditor.regionList')" icon="layers">
    <template #header-extra>
      <span class="region-count">{{ store.state.regions.length }}</span>
    </template>

    <div class="list-controls">
      <SelectRow
        :label="t('common.filter')"
        :model-value="store.state.listFilter"
        :options="filterOptions"
        @update:model-value="store.state.listFilter = $event as any"
      />
      <div class="search-row">
        <SvgIcon name="search" :size="12" class="search-icon" />
        <input
          v-model="store.state.searchQuery"
          class="search-input"
          :placeholder="t('common.search')"
        />
      </div>
    </div>

    <div class="region-list">
      <div
        v-for="r in store.filteredRegions.value"
        :key="r.id"
        class="region-item"
        :class="{ selected: r.id === store.state.selectedRegionId }"
        @click="store.selectRegion(r.id)"
      >
        <button
          class="eye-btn"
          :title="r.visible ? 'Hide' : 'Show'"
          @click.stop="store.toggleRegionVisibility(r.id)"
        >
          <SvgIcon :name="r.visible ? 'eye' : 'eye-off'" :size="12" />
        </button>
        <span class="region-color-dot" :style="{ background: r.color }" />
        <span class="region-name">{{ r.name }}</span>
        <SvgIcon
          :name="r.createdAs === 'rect' && !r.verticesEdited ? 'rect-select' : 'pentagon'"
          :size="10"
          class="region-shape-icon"
        />
      </div>
      <div v-if="store.filteredRegions.value.length === 0" class="empty-list">
        —
      </div>
    </div>
  </SidebarSection>

  <!-- Export footer -->
  <div class="export-panel">
    <ActionButtons
      :buttons="exportButtons"
      direction="column"
      @click="onExportAction"
    />
  </div>
</template>

<style scoped>
.tool-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid #333;
}
.tool-group {
  display: flex;
  border: 1px solid #444;
  border-radius: 5px;
  overflow: hidden;
}
.tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 28px;
  background: transparent;
  border: 1px solid #444;
  border-radius: 5px;
  color: #888;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.tool-group .tool-btn {
  border: none;
  border-radius: 0;
  border-right: 1px solid #444;
}
.tool-group .tool-btn:last-child {
  border-right: none;
}
.tool-btn:hover {
  background: #333;
  color: #bbb;
}
.tool-btn.active {
  background: #3a3a3a;
  color: #eee;
  box-shadow: inset 0 -2px 0 #7aa2d4;
}

.group-section-label {
  font-size: 10px;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  margin: 8px 0 4px;
}

.preset-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
  color: #aaa;
  transition: background 0.1s;
}
.preset-item:hover {
  background: #2a2a2a;
  color: #ddd;
}
.preset-color {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
}
.preset-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.preset-delete {
  background: none;
  border: none;
  color: #666;
  cursor: pointer;
  padding: 2px;
  display: flex;
}
.preset-delete:hover {
  color: #f87171;
}

.list-controls {
  margin-bottom: 6px;
}
.search-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}
.search-icon {
  color: #555;
  flex-shrink: 0;
}
.search-input {
  flex: 1;
  padding: 4px 6px;
  font-size: 11px;
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 4px;
  color: #ddd;
  outline: none;
}
.search-input:focus {
  border-color: #5577aa;
}

.region-count {
  margin-left: auto;
  font-size: 10px;
  color: #555;
  font-variant-numeric: tabular-nums;
}

.region-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.region-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
  color: #aaa;
  transition: background 0.1s;
}
.region-item:hover {
  background: #2a2a2a;
  color: #ddd;
}
.region-item.selected {
  background: #2d3548;
  color: #eee;
}
.eye-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: #666;
  cursor: pointer;
  padding: 2px;
  flex-shrink: 0;
}
.eye-btn:hover {
  color: #aaa;
}
.region-color-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.region-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.region-shape-icon {
  color: #555;
  flex-shrink: 0;
}
.empty-list {
  text-align: center;
  font-size: 11px;
  color: #444;
  padding: 12px;
}

.export-panel {
  padding: 12px;
  border-top: 1px solid #333;
}
</style>
