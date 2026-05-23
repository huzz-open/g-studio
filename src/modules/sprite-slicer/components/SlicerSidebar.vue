<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from '../../../shared/i18n'
import SvgIcon from '../../../shared/icons/SvgIcon.vue'
import FileDropZone from '../../../shared/components/FileDropZone.vue'

const props = defineProps<{
  store: ReturnType<typeof import('../store').useSlicerStore>
  hasImage: boolean
}>()

const emit = defineEmits<{
  file: [file: File]
  save: [type: string]
  'save-spritesheet': []
  'show-anim': []
  'export-png': []
  'export-zip': []
  'export-meta': []
}>()

const { t } = useI18n()

const saveType = ref<string>('generic')

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
</script>

<template>
  <aside class="sidebar">
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
        <label class="slider-label">{{ t('slicer.detection.minArea') }}</label>
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

    <!-- Standardize -->
    <div class="sidebar-section">
      <div class="section-header-row">
        <h4>{{ t('slicer.standardize') }}</h4>
        <label class="switch" :title="t('slicer.standardize.tooltip')">
          <input type="checkbox" v-model="store.stdEnabled.value" :disabled="!hasImage" />
          <span class="switch-slider" />
        </label>
      </div>
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

    <!-- Export -->
    <div class="sidebar-section">
      <h4>{{ t('common.export') }}</h4>
      <div class="actions">
        <button class="btn btn-sm" :disabled="!hasImage || store.selectedSprites.value.length === 0" @click="emit('export-png')">
          <SvgIcon name="download" :size="12" />
          {{ t('slicer.export.png') }}
        </button>
        <button class="btn btn-sm" :disabled="!hasImage || store.selectedSprites.value.length === 0" @click="emit('export-zip')">
          <SvgIcon name="download" :size="12" />
          {{ t('slicer.export.zip') }}
        </button>
        <button class="btn btn-sm" :disabled="!hasImage || store.selectedSprites.value.length === 0" @click="emit('export-meta')">
          <SvgIcon name="download" :size="12" />
          {{ t('slicer.export.meta') }}
        </button>
      </div>
    </div>

    <!-- Save as Spritesheet -->
    <div class="sidebar-section">
      <h4>{{ t('slicer.save.asSpritesheet') }}</h4>
      <button
        class="btn btn-sm"
        :disabled="!hasImage || store.sprites.value.length === 0 || store.saving.value"
        @click="emit('save-spritesheet')"
        :title="t('slicer.save.asSpritesheetHint')"
      >
        <SvgIcon name="save" :size="12" />
        {{ t('slicer.save.asSpritesheet') }}
      </button>
    </div>

    <!-- Save Actions -->
    <div class="sidebar-section actions">
      <div class="param-row" style="margin-bottom:6px">
        <label>{{ t('slicer.save.resourceType') }}
          <select v-model="saveType" :disabled="!hasImage" class="select-input">
            <option value="generic">{{ t('resource.type.generic') }}</option>
            <option value="animation">{{ t('resource.type.animation') }}</option>
            <option value="icon">{{ t('resource.type.icon') }}</option>
            <option value="item">{{ t('resource.type.item') }}</option>
          </select>
        </label>
      </div>
      <button
        class="btn btn-accent"
        @click="emit('save', saveType)"
        :disabled="!hasImage || store.selectedSprites.value.length === 0 || store.saving.value"
      >
        <SvgIcon name="save" :size="14" />
        {{ store.saving.value ? t('slicer.save.saving') : t('slicer.save.count', { count: store.selectedSprites.value.length }) }}
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 230px;
  min-width: 230px;
  background: #252525;
  border-right: 1px solid #3a3a3a;
  padding: 12px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
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
</style>
