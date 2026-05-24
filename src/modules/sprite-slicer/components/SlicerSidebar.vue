<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from '../../../shared/i18n'
import { useSettings } from '../../../shared/settings'
import { useWorkspace } from '../../../shared/workspace'
import { listDirs, resolveDir } from '../../../shared/workspace/fs'
import { prompt } from '../../../shared/components/prompt'
import SvgIcon from '../../../shared/icons/SvgIcon.vue'
import FileDropZone from '../../../shared/components/FileDropZone.vue'
import SegmentedControl from '../../../shared/components/SegmentedControl.vue'
import InlineSwitch from '../../../shared/components/InlineSwitch.vue'

export interface OutputPayload {
  composite: boolean
  sprites: boolean
  meta: boolean
  tags: string[]
  dir: string
}

const props = defineProps<{
  store: ReturnType<typeof import('../store').useSlicerStore>
  hasImage: boolean
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
const tagInput = ref('')

const exportOpts = ref({ ...settings.spriteSlicer.defaults.exportOptions })

const hasAnyImage = computed(() => exportOpts.value.composite || exportOpts.value.sprites)
const outputDisabled = computed(() =>
  !props.hasImage || !hasAnyImage.value || props.store.selectedSprites.value.length === 0,
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

function addTag() {
  const v = tagInput.value.trim()
  if (v && !tags.value.includes(v)) {
    tags.value.push(v)
  }
  tagInput.value = ''
}

function removeTag(tag: string) {
  tags.value = tags.value.filter(t => t !== tag)
}

function onTagKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    addTag()
  }
}

async function onNewFolder() {
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
  } catch {
    /* ignore */
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

function onBgColorChange(e: Event) {
  const hex = (e.target as HTMLInputElement).value
  props.store.bgColor.value = hexToRgb(hex)
}

const arrangeModeOptions = [
  { value: 'none', labelKey: 'slicer.arrangeMode.none' },
  { value: 'standardize', labelKey: 'slicer.arrangeMode.standardize' },
  { value: 'bin-pack', labelKey: 'slicer.arrangeMode.binPack' },
]

const sidebarWidth = ref(300)
const MIN_WIDTH = 220
const MAX_WIDTH = 500
let dragging = false

function onResizeStart(e: MouseEvent) {
  e.preventDefault()
  dragging = true
  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', onResizeEnd)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}
function onResizeMove(e: MouseEvent) {
  if (!dragging) return
  sidebarWidth.value = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX))
}
function onResizeEnd() {
  dragging = false
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

onUnmounted(() => {
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
})
</script>

<template>
  <aside class="sidebar" :style="{ width: sidebarWidth + 'px', minWidth: sidebarWidth + 'px' }">
    <!-- Source / Upload -->
    <div class="sidebar-section">
      <h4>{{ t('slicer.source') }}</h4>
      <FileDropZone
        compact
        accept="image/png,image/jpeg,image/webp"
        :hint="hasImage ? t('slicer.reselect') : t('slicer.upload.hint')"
        :file-name="hasImage ? `${store.imgSize.value.w} × ${store.imgSize.value.h} px` : ''"
        :loading="store.loading.value"
        loading-text="..."
        icon="image"
        @file="(f: File) => emit('file', f)"
      />
    </div>

    <!-- Background Removal -->
    <div class="sidebar-section">
      <h4>{{ t('slicer.bgRemoval') }}</h4>
      <div class="seg-group">
        <button
          v-for="r in store.bgRemovers"
          :key="r.id"
          class="seg-item"
          :class="{ active: store.bgRemoverId.value === r.id }"
          :disabled="!hasImage"
          @click="store.bgRemoverId.value = r.id"
        >{{ t(r.labelKey) }}</button>
      </div>

      <template v-if="store.bgRemoverId.value === 'auto'">
        <div class="param-row slider-row" style="margin-top:8px">
          <label class="slider-label">{{ t('slicer.bgRemoval.bgColor') }}</label>
          <input
            type="color"
            :value="rgbToHex(store.bgColor.value)"
            :disabled="!hasImage"
            @input="onBgColorChange"
            class="color-input"
          />
        </div>
        <div class="param-row slider-row">
          <label class="slider-label">{{ t('slicer.bgRemoval.tolerance') }}</label>
          <input type="range" v-model.number="store.bgTolerance.value" min="0" max="100" class="slider" :disabled="!hasImage" />
          <span class="range-val">{{ store.bgTolerance.value }}</span>
        </div>
        <div class="param-row slider-row">
          <label class="slider-label">{{ t('slicer.bgRemoval.spillCorrection') }}</label>
          <input type="range" v-model.number="store.bgSpillStrength.value" min="0" max="100" class="slider" :disabled="!hasImage" />
          <span class="range-val">{{ store.bgSpillStrength.value }}</span>
        </div>
      </template>
    </div>

    <!-- Detection Mode -->
    <div class="sidebar-section">
      <h4>{{ t('slicer.detection') }}</h4>
      <div class="seg-group">
        <button
          class="seg-item"
          :class="{ active: store.detectionMode.value === 'auto' }"
          :disabled="!hasImage"
          @click="store.detectionMode.value = 'auto'; store.runDetection()"
        >
          <SvgIcon name="wand" :size="12" />
          {{ t('slicer.detection.auto') }}
        </button>
        <button
          class="seg-item"
          :class="{ active: store.detectionMode.value === 'grid' }"
          :disabled="!hasImage"
          @click="store.detectionMode.value = 'grid'; store.runDetection()"
        >
          <SvgIcon name="grid" :size="12" />
          {{ t('slicer.detection.grid') }}
        </button>
      </div>
    </div>

    <!-- Auto Detection Params -->
    <div v-if="store.detectionMode.value === 'auto'" class="sidebar-section">
      <h4>{{ t('slicer.detection.params') }}</h4>
      <div class="param-row slider-row">
        <label class="slider-label">{{ t('slicer.detection.mergeGap') }}</label>
        <input type="range" v-model.number="store.mergeGap.value" min="0" max="30" class="slider" :disabled="!hasImage" />
        <span class="range-val">{{ store.mergeGap.value }}px</span>
      </div>
      <div class="param-row slider-row">
        <label class="slider-label" :title="t('slicer.detection.minArea.tip')">{{ t('slicer.detection.minArea') }}</label>
        <input type="range" v-model.number="store.minArea.value" min="10" max="500" class="slider" :disabled="!hasImage" />
        <span class="range-val">{{ store.minArea.value }}px</span>
      </div>
    </div>

    <!-- Grid Params -->
    <div v-else class="sidebar-section">
      <h4>{{ t('slicer.grid') }}</h4>
      <div class="param-row">
        <label>{{ t('slicer.grid.cols') }} <input type="number" v-model.number="store.cols.value" min="1" max="20" :disabled="!hasImage" /></label>
        <label>{{ t('slicer.grid.rows') }} <input type="number" v-model.number="store.rows.value" min="1" max="20" :disabled="!hasImage" /></label>
      </div>
      <div class="param-row" style="margin-top:4px">
        <label>{{ t('slicer.grid.gapH') }} <input type="number" v-model.number="store.gapH.value" min="0" max="200" :disabled="!hasImage" /></label>
        <label>{{ t('slicer.grid.gapV') }} <input type="number" v-model.number="store.gapV.value" min="0" max="200" :disabled="!hasImage" /></label>
      </div>
      <div class="param-row" style="margin-top:4px">
        <label>{{ t('slicer.grid.margin') }} H <input type="number" v-model.number="store.marginH.value" min="0" max="200" :disabled="!hasImage" /></label>
        <label>{{ t('slicer.grid.margin') }} V <input type="number" v-model.number="store.marginV.value" min="0" max="200" :disabled="!hasImage" /></label>
      </div>
    </div>

    <!-- Arrange Mode -->
    <div class="sidebar-section">
      <h4>{{ t('slicer.arrangeMode') }}</h4>
      <SegmentedControl
        :model-value="store.arrangeMode.value"
        :options="arrangeModeOptions"
        :disabled="!hasImage"
        @update:model-value="store.arrangeMode.value = $event as any"
      />
    </div>

    <!-- Naming -->
    <div class="sidebar-section">
      <h4>{{ t('slicer.naming.prefix') }}</h4>
      <input type="text" v-model="store.namePrefix.value" class="text-input" :disabled="!hasImage" />
    </div>

    <!-- Animation Preview -->
    <div v-if="hasImage && store.selectedSprites.value.length >= 2" class="sidebar-section">
      <h4>{{ t('slicer.anim.title') }}</h4>
      <button class="btn btn-sm" @click="emit('show-anim')">
        <SvgIcon name="play" :size="12" />
        {{ t('slicer.anim.preview', { count: store.selectedSprites.value.length }) }}
      </button>
    </div>

    <!-- Output -->
    <div class="sidebar-section">
      <h4>{{ t('slicer.output') }}</h4>

      <div class="param-row" style="margin-bottom:6px">
        <label>{{ t('slicer.save.saveDir') }}
          <div class="dir-picker">
            <select v-model="saveDir" :disabled="!hasImage" class="select-input">
              <option v-for="d in workspaceDirs" :key="d" :value="d">{{ d }}</option>
              <option v-if="!workspaceDirs.includes(saveDir)" :value="saveDir">{{ saveDir }}</option>
            </select>
            <button class="btn-new-folder" :disabled="!hasImage" @click="onNewFolder" :title="t('slicer.save.newFolder')">+</button>
          </div>
        </label>
      </div>

      <div class="param-row tag-section" style="margin-bottom:6px">
        <label>{{ t('slicer.save.tags') }}
          <div class="tag-input-area">
            <span v-for="tag in tags" :key="tag" class="tag-chip">
              {{ tag }}
              <button class="tag-remove" @click="removeTag(tag)">&times;</button>
            </span>
            <input
              type="text"
              v-model="tagInput"
              class="tag-text-input"
              :placeholder="t('slicer.save.tagPlaceholder')"
              :disabled="!hasImage"
              @keydown="onTagKeydown"
              @blur="addTag"
            />
          </div>
        </label>
      </div>

      <div class="cb-pair">
        <label class="cb-row">
          <input type="checkbox" v-model="exportOpts.composite" :disabled="!hasImage" />
          <span>{{ t('slicer.output.composite') }}</span>
        </label>
        <InlineSwitch
          :model-value="exportOpts.meta"
          label=""
          :tooltip="t('slicer.output.metaTip')"
          :disabled="!hasImage || !exportOpts.composite"
          @update:model-value="onMetaChange($event)"
        />
      </div>
      <label class="cb-row">
        <input type="checkbox" v-model="exportOpts.sprites" :disabled="!hasImage" />
        <span>{{ t('slicer.output.sprites') }}</span>
      </label>
      <div class="output-btns">
        <button
          class="btn btn-sm"
          :disabled="outputDisabled || store.saving.value"
          @click="emit('export-local', getPayload())"
        >
          <SvgIcon name="download" :size="12" />
          {{ t('slicer.output.exportLocal') }}
        </button>
        <button
          class="btn btn-sm btn-accent"
          :disabled="outputDisabled || store.saving.value"
          @click="emit('save-workspace', getPayload())"
        >
          <SvgIcon name="save" :size="12" />
          {{ store.saving.value ? t('slicer.save.saving') : t('slicer.output.saveWorkspace') }}
        </button>
      </div>
    </div>
  </aside>
  <div class="resize-handle" @mousedown="onResizeStart" />
</template>

<style scoped>
.sidebar {
  background: #252525;
  border-right: 1px solid #3a3a3a;
  padding: 12px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.resize-handle {
  width: 4px;
  cursor: col-resize;
  background: transparent;
  flex-shrink: 0;
  transition: background 0.15s;
}
.resize-handle:hover { background: #5577aa44; }
.sidebar-section {
  padding-bottom: 10px;
  margin-bottom: 6px;
  border-bottom: 1px solid #333;
}
.sidebar-section:last-child { border-bottom: none; }
.sidebar-section h4 {
  margin: 0 0 6px;
  font-size: 11px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.seg-group {
  display: flex;
  border: 1px solid #444;
  border-radius: 5px;
  overflow: hidden;
}
.seg-item {
  flex: 1;
  padding: 5px 6px;
  background: transparent;
  color: #888;
  border: none;
  font-size: 11px;
  cursor: pointer;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  transition: background 0.15s, color 0.15s;
  border-right: 1px solid #444;
}
.seg-item:last-child { border-right: none; }
.seg-item:hover:not(:disabled) { background: #333; color: #bbb; }
.seg-item.active {
  background: #3a3a3a;
  color: #eee;
  box-shadow: inset 0 -2px 0 #7aa2d4;
}
.seg-item:disabled { cursor: default; }
.param-row { display: flex; gap: 8px; }
.param-row label {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
  color: #888;
  flex: 1;
}
.param-row input[type="number"] {
  width: 100%;
  padding: 3px 5px;
  background: #333;
  color: #eee;
  border: 1px solid #555;
  border-radius: 3px;
  font-size: 12px;
}
.slider-row { align-items: center; margin-top: 4px; }
.slider-label {
  font-size: 11px;
  color: #888;
  min-width: 48px;
  flex: none !important;
}
.slider { flex: 1; min-width: 0; max-width: 90px; accent-color: #5577aa; }
.range-val { font-size: 11px; color: #aaa; min-width: 28px; text-align: right; flex: none; }
.color-input {
  width: 28px;
  height: 22px;
  border: 1px solid #555;
  border-radius: 3px;
  cursor: pointer;
  background: none;
  padding: 0;
}
.section-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.section-header-row h4 { margin: 0; }
.switch {
  position: relative;
  display: inline-block;
  width: 32px;
  height: 18px;
  flex-shrink: 0;
  cursor: pointer;
}
.switch input { opacity: 0; width: 0; height: 0; position: absolute; }
.switch-slider {
  position: absolute;
  inset: 0;
  background: #444;
  border-radius: 9px;
  transition: background 0.2s;
}
.switch-slider::before {
  content: '';
  position: absolute;
  width: 14px;
  height: 14px;
  left: 2px;
  bottom: 2px;
  background: #999;
  border-radius: 50%;
  transition: transform 0.2s, background 0.2s;
}
.switch input:checked + .switch-slider { background: #3a6a5a; }
.switch input:checked + .switch-slider::before { transform: translateX(14px); background: #d0f0e0; }
.switch input:disabled + .switch-slider { opacity: 0.4; cursor: default; }
.select-input {
  width: 100%;
  padding: 3px 5px;
  background: #333;
  color: #eee;
  border: 1px solid #555;
  border-radius: 3px;
  font-size: 12px;
}
.text-input {
  width: 100%;
  padding: 4px 8px;
  background: #333;
  color: #eee;
  border: 1px solid #555;
  border-radius: 4px;
  font-size: 12px;
}
.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  background: #3a5070;
  color: #dde4f0;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.15s;
}
.btn:hover:not(:disabled) { background: #4a6080; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-sm { padding: 4px 8px; font-size: 11px; }
.btn-accent { background: #3a6a5a; color: #d0f0e0; }
.btn-accent:hover:not(:disabled) { background: #4a7a6a; }
.actions { padding-top: 4px; display: flex; flex-direction: column; gap: 6px; }
.cb-pair {
  display: flex;
  gap: 12px;
}
.cb-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #bbb;
  cursor: pointer;
  padding: 3px 0;
}
.cb-row input[type="checkbox"] {
  accent-color: #5577aa;
  cursor: pointer;
  margin: 0;
}
.cb-row input:disabled { opacity: 0.4; cursor: default; }
.cb-row input:disabled + span { opacity: 0.4; }
.output-btns {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.output-btns .btn { flex: 1; }
.dir-picker {
  display: flex;
  gap: 4px;
  align-items: stretch;
}
.dir-picker .select-input { flex: 1; min-width: 0; }
.btn-new-folder {
  width: 28px;
  background: #3a5070;
  color: #dde4f0;
  border: 1px solid #555;
  border-radius: 3px;
  cursor: pointer;
  font-size: 14px;
  font-weight: bold;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}
.btn-new-folder:hover:not(:disabled) { background: #4a6080; }
.btn-new-folder:disabled { opacity: 0.4; cursor: not-allowed; }
.tag-section label { flex: 1; }
.tag-input-area {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 6px;
  background: #333;
  border: 1px solid #555;
  border-radius: 4px;
  min-height: 28px;
  align-items: center;
}
.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 6px;
  background: #3a5070;
  color: #dde4f0;
  border-radius: 3px;
  font-size: 11px;
  white-space: nowrap;
}
.tag-remove {
  background: none;
  border: none;
  color: #aaa;
  cursor: pointer;
  font-size: 13px;
  padding: 0 2px;
  line-height: 1;
}
.tag-remove:hover { color: #ff9999; }
.tag-text-input {
  flex: 1;
  min-width: 50px;
  background: none;
  border: none;
  color: #eee;
  font-size: 11px;
  outline: none;
  padding: 2px 0;
}
</style>
