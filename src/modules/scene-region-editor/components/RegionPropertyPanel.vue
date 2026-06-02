<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../../shared/i18n'
import {
  SidebarSection,
  ColorRow,
  SliderRow,
  RadioGroup,
  CheckboxRow,
  TextRow,
  ActionButtons,
} from '../../../shared/components/editor-shell'
import type { RadioOption, ActionButton } from '../../../shared/components/editor-shell'
import SvgIcon from '../../../shared/icons/SvgIcon.vue'
import { confirm } from '../../../shared/components/confirm'
import type { SceneRegionStore } from '../store'

const props = defineProps<{
  store: SceneRegionStore
}>()

const { t } = useI18n()

const region = computed(() => props.store.selectedRegion.value)

const shapeLabel = computed(() => {
  const r = region.value
  if (!r) return ''
  if (r.createdAs === 'rect' && !r.verticesEdited) {
    return t('sceneEditor.property.shapeRect')
  }
  if (r.createdAs === 'rect' && r.verticesEdited) {
    return t('sceneEditor.property.shapeRectEdited')
  }
  return t('sceneEditor.property.shapePoly', { count: r.vertices.length })
})

const regionOpacity = computed(() => {
  const r = region.value
  if (!r) return 0
  const g = r.groups.find(g => g.startsWith('occlude_opacity_'))
  if (!g) return 0
  return parseInt(g.replace('occlude_opacity_', ''), 10)
})

function setOpacity(val: number) {
  const r = region.value
  if (!r) return
  const newGroups = r.groups.filter(g => !g.startsWith('occlude_opacity_'))
  newGroups.push(`occlude_opacity_${val}`)
  props.store.updateRegionProps(r.id, { groups: newGroups })
}

const typeOptions = computed<RadioOption[]>(() => [
  { value: 'occlude', label: t('sceneEditor.type.occlude') },
  { value: 'collision', label: t('sceneEditor.type.collision') },
])

const depthOptions = computed<RadioOption[]>(() => [
  { value: 'top_layer', label: t('sceneEditor.group.topLayer'), title: t('sceneEditor.group.topLayer.tip') },
  { value: 'y_sort', label: t('sceneEditor.group.ySort'), title: t('sceneEditor.group.ySort.tip') },
])

const depthMode = computed(() => {
  const r = region.value
  if (!r) return 'top_layer'
  if (r.groups.includes('occlude_y_sort')) return 'y_sort'
  return 'top_layer'
})

function setDepthMode(mode: string) {
  const r = region.value
  if (!r) return
  const groups = r.groups.filter(g => g !== 'occlude_top_layer' && g !== 'occlude_y_sort')
  groups.push(mode === 'y_sort' ? 'occlude_y_sort' : 'occlude_top_layer')
  props.store.updateRegionProps(r.id, { groups })
}

const isScreenMask = computed(() =>
  region.value?.groups.includes('occlude_screen_mask') ?? false
)

function toggleScreenMask(val: boolean) {
  const r = region.value
  if (!r) return
  const groups = [...r.groups]
  const idx = groups.indexOf('occlude_screen_mask')
  if (val && idx < 0) groups.push('occlude_screen_mask')
  else if (!val && idx >= 0) groups.splice(idx, 1)
  props.store.updateRegionProps(r.id, { groups })
}

function onColorChange(color: string) {
  const r = region.value
  if (!r) return
  props.store.updateRegionProps(r.id, { color, colorManuallySet: true })
}

function onTypeChange(val: string) {
  const r = region.value
  if (!r) return
  props.store.updateRegionProps(r.id, { type: val as 'occlude' | 'collision' })
}

const exportPreview = computed(() => {
  const r = region.value
  if (!r) return null
  if (r.type === 'occlude') {
    const shapeType = r.createdAs === 'rect' && !r.verticesEdited
      ? 'CollisionShape2D (RectangleShape2D)'
      : 'CollisionPolygon2D'
    return {
      parent: 'Obstacles',
      nodeType: 'Area2D',
      nodeName: r.name,
      shapeType,
      groups: r.groups.filter(g => g.startsWith('occlude_')),
    }
  }
  const shapeType = r.createdAs === 'rect' && !r.verticesEdited
    ? 'CollisionShape2D (RectangleShape2D)'
    : 'CollisionPolygon2D'
  return {
    parent: 'Collision (StaticBody2D)',
    nodeType: shapeType,
    nodeName: r.name,
    shapeType,
    groups: [],
  }
})

const deleteButtons = computed<ActionButton[]>(() => [
  { id: 'delete', label: t('sceneEditor.property.delete'), variant: 'danger' },
])

async function onDeleteAction() {
  const r = region.value
  if (!r) return
  const ok = await confirm({
    title: t('sceneEditor.property.delete'),
    message: t('sceneEditor.property.deleteConfirm', { name: r.name }),
    danger: true,
  })
  if (ok) {
    props.store.removeRegion(r.id)
  }
}
</script>

<template>
  <template v-if="region">
    <SidebarSection :title="t('sceneEditor.property.title')" icon="edit">
      <TextRow
        :label="t('sceneEditor.property.name')"
        :model-value="region.name"
        @update:model-value="store.updateRegionProps(region!.id, { name: $event })"
      />

      <ColorRow
        :label="t('sceneEditor.property.color')"
        :model-value="region.color"
        @update:model-value="onColorChange"
      />

      <div class="prop-row">
        <span class="prop-label">{{ t('sceneEditor.property.shape') }}</span>
        <span class="prop-value">{{ shapeLabel }}</span>
      </div>
    </SidebarSection>

    <!-- Purpose -->
    <SidebarSection :title="t('sceneEditor.property.purpose')">
      <RadioGroup
        :model-value="region.type"
        :options="typeOptions"
        @update:model-value="onTypeChange"
      />
    </SidebarSection>

    <!-- Occlusion Behavior (occlude only) -->
    <SidebarSection
      v-if="region.type === 'occlude'"
      :title="t('sceneEditor.property.godotGroups')"
    >
      <RadioGroup
        :label="t('sceneEditor.preset.depthMode')"
        :model-value="depthMode"
        :options="depthOptions"
        direction="row"
        @update:model-value="setDepthMode"
      />

      <CheckboxRow
        :label="t('sceneEditor.group.screenMask')"
        :model-value="isScreenMask"
        :title="t('sceneEditor.group.screenMask.tip')"
        @update:model-value="toggleScreenMask"
      />

      <SliderRow
        :label="t('sceneEditor.property.opacity')"
        :model-value="regionOpacity"
        :min="0"
        :max="100"
        :step="1"
        suffix="%"
        @update:model-value="setOpacity($event)"
      />
    </SidebarSection>

    <!-- Export Preview -->
    <SidebarSection
      v-if="exportPreview"
      :title="t('sceneEditor.property.exportPreview')"
      :default-open="false"
    >
      <div class="export-tree">
        <div class="tree-node">
          <span class="tree-indent">{{ exportPreview.parent }}</span>
        </div>
        <div class="tree-node tree-child">
          <span class="tree-line">└─ </span>
          <span class="tree-name">{{ exportPreview.nodeName }}</span>
          <span class="tree-type"> ({{ exportPreview.nodeType }})</span>
        </div>
        <div v-if="region.type === 'occlude'" class="tree-node tree-grandchild">
          <span class="tree-line">&nbsp;&nbsp;&nbsp;└─ </span>
          <span class="tree-type">{{ exportPreview.shapeType }}</span>
        </div>
        <div v-if="exportPreview.groups.length > 0" class="tree-groups">
          groups: {{ JSON.stringify(exportPreview.groups) }}
        </div>
      </div>
    </SidebarSection>

    <!-- Delete -->
    <div class="delete-section">
      <ActionButtons
        :buttons="deleteButtons"
        @click="onDeleteAction"
      />
    </div>
  </template>

  <template v-else>
    <div class="no-selection">
      <SvgIcon name="edit" :size="20" class="no-sel-icon" />
      <span>{{ t('sceneEditor.noSelection') }}</span>
    </div>
  </template>
</template>

<style scoped>
.prop-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.prop-label {
  font-size: 11px;
  color: #aaa;
  white-space: nowrap;
}
.prop-value {
  font-size: 11px;
  color: #888;
}

.export-tree {
  font-family: monospace;
  font-size: 10px;
  color: #888;
  line-height: 1.6;
}
.tree-node {
  white-space: nowrap;
}
.tree-child {
  margin-left: 8px;
}
.tree-grandchild {
  margin-left: 8px;
}
.tree-line {
  color: #555;
}
.tree-name {
  color: #8ab4f8;
}
.tree-type {
  color: #666;
}
.tree-groups {
  margin-top: 4px;
  font-size: 10px;
  color: #666;
  word-break: break-all;
}

.delete-section {
  padding: 10px;
  border-top: 1px solid #333;
}

.no-selection {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 20px;
  color: #555;
  font-size: 12px;
  text-align: center;
}
.no-sel-icon {
  opacity: 0.3;
}
</style>
