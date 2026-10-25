<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from '../../../shared/i18n'
import { useSettings } from '../../../shared/settings'
import { useWorkspace } from '../../../shared/workspace'
import { listDirs, resolveDir } from '../../../shared/workspace/fs'
import { prompt } from '../../../shared/components/prompt'
import { showToast } from '../../../shared/components/toast'
import FileDropZone from '../../../shared/components/FileDropZone.vue'
import SidebarSection from '../../../shared/components/editor-shell/SidebarSection.vue'
import SegmentedControl from '../../../shared/components/SegmentedControl.vue'
import InlineSwitch from '../../../shared/components/InlineSwitch.vue'
import { ActionButtons, SliderRow, NumberRow, ColorRow, TextRow, TagInput, DirPicker } from '../../../shared/components/editor-shell/sidebar-atoms'
import type { ActionButton } from '../../../shared/components/editor-shell/sidebar-atoms'
import { bgRemovers, type SlicerInstance } from '../store'
import { SLICER_PARAMETER_DEFAULTS } from '../defaults'

export interface OutputPayload {
  composite: boolean
  sprites: boolean
  meta: boolean
  normals: boolean
  tags: string[]
  dir: string
}

const props = defineProps<{
  store: SlicerInstance
  hasImage: boolean
  outputBusy?: boolean
  outputProgress?: string
}>()

const emit = defineEmits<{
  file: [file: File]
  'show-anim': []
  'export-local': [payload: OutputPayload]
  'save-workspace': [payload: OutputPayload]
}>()

const { t } = useI18n()
const { settings } = useSettings()
const { isOpen: wsOpen } = useWorkspace()

const workspaceDirs = ref<string[]>([])
const saveDir = ref(settings.spriteSlicer.lastSaveDir ?? 'spritesheets')
const tags = ref<string[]>([...(settings.spriteSlicer.lastTags ?? [])])

const exportOpts = ref({ ...settings.spriteSlicer.defaults.exportOptions, normals: false })

const hasAnyImage = computed(() => exportOpts.value.composite || exportOpts.value.sprites)
const outputDisabled = computed(() =>
  props.outputBusy || !props.hasImage || !hasAnyImage.value || props.store.selectedSprites.value.length === 0,
)

async function refreshDirs() {
  workspaceDirs.value = await listDirs()
}

onMounted(() => {
  if (wsOpen.value) refreshDirs()
})

watch(wsOpen, (open) => {
  if (open) refreshDirs()
})

async function onNewFolder() {
  if (!wsOpen.value || props.outputBusy) return
  const name = await prompt({
    title: t('slicer.save.newFolder'),
    message: t('slicer.save.newFolderPrompt'),
    placeholder: 'characters/hero',
    suggestions: workspaceDirs.value,
  })
  if (!name) return
  const cleaned = name.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!cleaned) return
  try {
    await resolveDir(cleaned, true)
    await refreshDirs()
    saveDir.value = cleaned
  } catch (e) {
    console.error('[slicer] folder creation failed:', cleaned, e)
    showToast(t('toast.folder.error'), 'error')
  }
}

function onMetaChange(checked: boolean) {
  if (!exportOpts.value.composite) return
  exportOpts.value.meta = checked
}

function getPayload(): OutputPayload {
  return {
    composite: exportOpts.value.composite,
    sprites: exportOpts.value.sprites,
    meta: exportOpts.value.composite ? exportOpts.value.meta : false,
    normals: exportOpts.value.normals,
    tags: [...tags.value],
    dir: saveDir.value,
  }
}

function rgbToHex(c: [number, number, number]): string {
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('')
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ]
}

function onBgColorChange(hex: string) {
  props.store.state.bgColor = hexToRgb(hex)
}

const arrangeModeOptions = [
  { value: 'none', labelKey: 'slicer.arrangeMode.none' },
  { value: 'standardize', labelKey: 'slicer.arrangeMode.standardize' },
  { value: 'bin-pack', labelKey: 'slicer.arrangeMode.binPack' },
]

const bgRemoverOptions = computed(() =>
  bgRemovers.map(r => ({ value: r.id, labelKey: r.labelKey })),
)

const outputButtons = computed<ActionButton[]>(() => [
  {
    id: 'export-local',
    label: t('slicer.output.exportLocal'),
    icon: 'download',
    disabled: outputDisabled.value,
  },
  {
    id: 'save-workspace',
    label: t('slicer.output.saveWorkspace'),
    icon: 'save',
    variant: 'primary',
    disabled: outputDisabled.value || !wsOpen.value,
  },
])

function onOutputAction(id: string) {
  if (id === 'export-local') emit('export-local', getPayload())
  else if (id === 'save-workspace') emit('save-workspace', getPayload())
}

const gridRows = [
  [{ key: 'cols', label: 'slicer.grid.cols', max: 20, min: 1 }, { key: 'rows', label: 'slicer.grid.rows', max: 20, min: 1 }],
  [{ key: 'gapH', label: 'slicer.grid.gapH', max: 200, min: 0 }, { key: 'gapV', label: 'slicer.grid.gapV', max: 200, min: 0 }],
  [{ key: 'marginH', label: 'slicer.grid.margin', axis: 'H', max: 200, min: 0 }, { key: 'marginV', label: 'slicer.grid.margin', axis: 'V', max: 200, min: 0 }],
] as const

</script>

<template>
  <div class="sidebar-content">
    <SidebarSection :title="t('slicer.source')" :collapsible="false">
      <FileDropZone compact accept="image/png,image/jpeg,image/webp" :hint="hasImage ? t('slicer.reselect') : t('slicer.upload.hint')"
        :file-name="hasImage ? `${store.state.imgSize.w} × ${store.state.imgSize.h} px` : ''" :loading="store.state.loading" loading-text="..." icon="image" @file="(f: File) => emit('file', f)" />
    </SidebarSection>
    <SidebarSection :title="t('slicer.bgRemoval')" :collapsible="false">
      <SegmentedControl :model-value="store.state.bgRemoverId" :default-value="settings.spriteSlicer.defaults.bgRemoval" :options="bgRemoverOptions" :disabled="!hasImage" :aria-label="t('slicer.bgRemoval')" role="group" @update:model-value="store.state.bgRemoverId = $event" />
      <template v-if="store.state.bgRemoverId === 'auto'">
        <ColorRow :label="t('slicer.bgRemoval.bgColor')" :model-value="rgbToHex(store.state.bgColor)" :default-value="rgbToHex(SLICER_PARAMETER_DEFAULTS.bgColor)" :disabled="!hasImage" @update:model-value="onBgColorChange" />
        <SliderRow v-model="store.state.bgTolerance" :default-value="SLICER_PARAMETER_DEFAULTS.bgTolerance" :label="t('slicer.bgRemoval.tolerance')" :min="0" :max="100" :disabled="!hasImage" />
        <SliderRow v-model="store.state.bgSpillStrength" :default-value="SLICER_PARAMETER_DEFAULTS.bgSpillStrength" :label="t('slicer.bgRemoval.spillCorrection')" :min="0" :max="100" :disabled="!hasImage" />
      </template>
    </SidebarSection>
    <SidebarSection :title="t('slicer.detection')" :collapsible="false">
      <SegmentedControl :model-value="store.state.detectionMode" :default-value="settings.spriteSlicer.defaults.detectionMode" :aria-label="t('slicer.detection')" role="group"
        :options="[{ value: 'auto', labelKey: 'slicer.detection.auto' }, { value: 'grid', labelKey: 'slicer.detection.grid' }]"
        :disabled="!hasImage" @update:model-value="store.state.detectionMode = $event as 'auto' | 'grid'; store.runDetection()" />
    </SidebarSection>
    <SidebarSection v-if="store.state.detectionMode === 'auto'" :title="t('slicer.detection.params')" :collapsible="false">
      <SliderRow v-model="store.state.mergeGap" :default-value="settings.spriteSlicer.defaults.mergeGap" :label="t('slicer.detection.mergeGap')" :min="0" :max="30" suffix="px" :disabled="!hasImage" />
      <SliderRow v-model="store.state.minArea" :default-value="settings.spriteSlicer.defaults.minArea" :label="t('slicer.detection.minArea')" :title="t('slicer.detection.minArea.tip')" :min="10" :max="500" suffix="px²" :disabled="!hasImage" />
    </SidebarSection>
    <SidebarSection v-else :title="t('slicer.grid')" :collapsible="false">
      <div v-for="(row, index) in gridRows" :key="index" class="grid-fields">
        <NumberRow v-for="field in row" :key="field.key" v-model="store.state[field.key]" :default-value="SLICER_PARAMETER_DEFAULTS[field.key]" stacked live
          :label="('axis' in field ? t(field.label) + ' · ' + t(field.axis === 'H' ? 'slicer.grid.gapH' : 'slicer.grid.gapV') : (index === 1 ? t('slicer.grid.gap') + ' · ' : '') + t(field.label))" :min="field.min" :max="field.max" :disabled="!hasImage" />
      </div>
    </SidebarSection>
    <SidebarSection :title="t('slicer.arrangeMode')" :collapsible="false">
      <SegmentedControl :model-value="store.state.arrangeMode" :default-value="settings.spriteSlicer.defaults.arrangeMode" :options="arrangeModeOptions" :disabled="!hasImage" :aria-label="t('slicer.arrangeMode')" role="group" @update:model-value="store.state.arrangeMode = $event as 'none' | 'standardize' | 'bin-pack'" />
    </SidebarSection>
    <div class="standalone-field"><TextRow v-model="store.state.namePrefix" :default-value="settings.spriteSlicer.defaults.namePrefix" :label="t('slicer.naming.prefix')" stacked live :disabled="!hasImage" /></div>
    <SidebarSection v-if="hasImage && store.selectedSprites.value.length >= 2" :title="t('slicer.anim.title')" :collapsible="false">
      <ActionButtons :buttons="[{ id: 'preview', label: t('slicer.anim.preview', { count: store.selectedSprites.value.length }), icon: 'play' }]" @click="emit('show-anim')" />
    </SidebarSection>
    <SidebarSection :title="t('slicer.output')" :collapsible="false">
      <DirPicker v-model="saveDir" :label="t('slicer.save.saveDir')" :options="workspaceDirs" :action-label="t('slicer.save.newFolder')" :disabled="!hasImage || !wsOpen || outputBusy" @browse="onNewFolder" />
      <TagInput v-model="tags" :label="t('slicer.save.tags')" :placeholder="t('slicer.save.tagPlaceholder')" :disabled="!hasImage || outputBusy" commit-on-blur />
      <div class="output-choices">
        <label class="output-choice" :class="{ checked: exportOpts.composite, disabled: !hasImage || outputBusy }">
          <input v-model="exportOpts.composite" type="checkbox" :disabled="!hasImage || outputBusy" /><span>{{ t('slicer.output.composite') }}</span>
        </label>
        <label class="output-choice" :class="{ checked: exportOpts.sprites, disabled: !hasImage || outputBusy }">
          <input v-model="exportOpts.sprites" type="checkbox" :disabled="!hasImage || outputBusy" /><span>{{ t('slicer.output.sprites') }} ZIP</span>
        </label>
      </div>
      <InlineSwitch :model-value="exportOpts.meta" :default-value="settings.spriteSlicer.defaults.exportOptions.meta" :label="t('normal.exportMeta')" :tooltip="t('slicer.output.metaTip')" block
        :disabled="!hasImage || !exportOpts.composite || outputBusy" @update:model-value="onMetaChange" />
      <InlineSwitch v-model="exportOpts.normals" :default-value="false" :label="t('normal.export')" :description="t('normal.exportHint')" :disabled="!hasImage || !hasAnyImage || outputBusy" block />
      <p v-if="outputBusy" class="output-progress" role="status">{{ outputProgress || t('normal.exporting') }}</p>
      <ActionButtons :buttons="outputButtons" @click="onOutputAction" />
    </SidebarSection>
  </div>
</template>

<style scoped>
.sidebar-content { height: 100%; overflow-y: auto; }
.grid-fields { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 10px; }
.standalone-field { padding: 10px; border-bottom: 1px solid #333; }
.output-choices { display: flex; gap: 6px; }
.output-choice { display: flex; flex: 1; align-items: center; gap: 7px; padding: 9px 8px; border: 1px solid #4b4b4b; border-radius: 5px; background: #303030; color: #bbb; font-size: 12px; cursor: pointer; }
.output-choice.checked { border-color: #698dbd; background: #30445d; color: #d9e8fc; }
.output-choice input { accent-color: #8ab4f8; margin: 0; width: 14px; height: 14px; }
.output-choice:focus-within { outline: 2px solid #8ab4f8; outline-offset: 2px; }
.output-choice.disabled { opacity: .4; cursor: default; }
.output-progress { font-size: 11px; color: #8ab4f8; margin: 0; }
</style>
