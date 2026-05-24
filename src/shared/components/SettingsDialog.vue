<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from '../i18n'
import { useSettings } from '../settings'
import SvgIcon from '../icons/SvgIcon.vue'
import SegmentedControl from './SegmentedControl.vue'
import InlineSwitch from './InlineSwitch.vue'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const { t } = useI18n()
const { settings, resetSettings, DEFAULTS } = useSettings()

interface SettingItem {
  key: string
  labelKey: string
  descKey?: string
  type: 'boolean' | 'number' | 'string' | 'select' | 'segmented' | 'inline-switch'
  get: () => any
  set: (v: any) => void
  min?: number
  max?: number
  step?: number
  options?: { value: any; labelKey: string }[]
  defaultVal: any
}

interface Category {
  id: string
  labelKey: string
  icon: string
  children?: Category[]
  items?: SettingItem[]
}

const categories: Category[] = [
  {
    id: 'slicer',
    labelKey: 'settings.cat.slicer',
    icon: 'scissors',
    children: [
      {
        id: 'slicer.defaults',
        labelKey: 'settings.cat.slicer.defaults',
        icon: 'wand',
        items: [
          {
            key: 'slicer.defaults.detectionMode',
            labelKey: 'settings.slicer.detectionMode',
            descKey: 'settings.slicer.detectionMode.desc',
            type: 'select',
            options: [
              { value: 'auto', labelKey: 'slicer.detection.auto' },
              { value: 'grid', labelKey: 'slicer.detection.grid' },
            ],
            get: () => settings.spriteSlicer.defaults.detectionMode,
            set: (v: string) => { settings.spriteSlicer.defaults.detectionMode = v as 'auto' | 'grid' },
            defaultVal: DEFAULTS.spriteSlicer.defaults.detectionMode,
          },
          {
            key: 'slicer.defaults.bgRemoval',
            labelKey: 'settings.slicer.bgRemoval',
            descKey: 'settings.slicer.bgRemoval.desc',
            type: 'select',
            options: [
              { value: 'auto', labelKey: 'slicer.bgRemoval.auto' },
              { value: 'none', labelKey: 'slicer.bgRemoval.none' },
            ],
            get: () => settings.spriteSlicer.defaults.bgRemoval,
            set: (v: string) => { settings.spriteSlicer.defaults.bgRemoval = v as 'auto' | 'none' },
            defaultVal: DEFAULTS.spriteSlicer.defaults.bgRemoval,
          },
          {
            key: 'slicer.defaults.minArea',
            labelKey: 'settings.slicer.minArea',
            descKey: 'settings.slicer.minArea.desc',
            type: 'number',
            get: () => settings.spriteSlicer.defaults.minArea,
            set: (v: number) => { settings.spriteSlicer.defaults.minArea = v },
            min: 1, max: 10000, step: 1,
            defaultVal: DEFAULTS.spriteSlicer.defaults.minArea,
          },
          {
            key: 'slicer.defaults.mergeGap',
            labelKey: 'settings.slicer.mergeGap',
            descKey: 'settings.slicer.mergeGap.desc',
            type: 'number',
            get: () => settings.spriteSlicer.defaults.mergeGap,
            set: (v: number) => { settings.spriteSlicer.defaults.mergeGap = v },
            min: 0, max: 100, step: 1,
            defaultVal: DEFAULTS.spriteSlicer.defaults.mergeGap,
          },
          {
            key: 'slicer.defaults.namePrefix',
            labelKey: 'settings.slicer.namePrefix',
            descKey: 'settings.slicer.namePrefix.desc',
            type: 'string',
            get: () => settings.spriteSlicer.defaults.namePrefix,
            set: (v: string) => { settings.spriteSlicer.defaults.namePrefix = v },
            defaultVal: DEFAULTS.spriteSlicer.defaults.namePrefix,
          },
          {
            key: 'slicer.defaults.arrangeMode',
            labelKey: 'settings.slicer.arrangeMode',
            descKey: 'settings.slicer.arrangeMode.desc',
            type: 'segmented',
            options: [
              { value: 'none', labelKey: 'slicer.arrangeMode.none' },
              { value: 'standardize', labelKey: 'slicer.arrangeMode.standardize' },
              { value: 'bin-pack', labelKey: 'slicer.arrangeMode.binPack' },
            ],
            get: () => settings.spriteSlicer.defaults.arrangeMode,
            set: (v: string) => { settings.spriteSlicer.defaults.arrangeMode = v as 'none' | 'standardize' | 'bin-pack' },
            defaultVal: DEFAULTS.spriteSlicer.defaults.arrangeMode,
          },
          {
            key: 'slicer.defaults.snapDistance',
            labelKey: 'settings.slicer.snapDistance',
            descKey: 'settings.slicer.snapDistance.desc',
            type: 'number',
            get: () => settings.spriteSlicer.defaults.snapDistance,
            set: (v: number) => { settings.spriteSlicer.defaults.snapDistance = v },
            min: 1, max: 50, step: 1,
            defaultVal: DEFAULTS.spriteSlicer.defaults.snapDistance,
          },
          {
            key: 'slicer.defaults.exportComposite',
            labelKey: 'settings.slicer.exportComposite',
            descKey: 'settings.slicer.exportComposite.desc',
            type: 'inline-switch',
            get: () => settings.spriteSlicer.defaults.exportOptions.composite,
            set: (v: boolean) => { settings.spriteSlicer.defaults.exportOptions.composite = v },
            defaultVal: DEFAULTS.spriteSlicer.defaults.exportOptions.composite,
          },
          {
            key: 'slicer.defaults.exportSprites',
            labelKey: 'settings.slicer.exportSprites',
            descKey: 'settings.slicer.exportSprites.desc',
            type: 'inline-switch',
            get: () => settings.spriteSlicer.defaults.exportOptions.sprites,
            set: (v: boolean) => { settings.spriteSlicer.defaults.exportOptions.sprites = v },
            defaultVal: DEFAULTS.spriteSlicer.defaults.exportOptions.sprites,
          },
          {
            key: 'slicer.defaults.exportMeta',
            labelKey: 'settings.slicer.exportMeta',
            descKey: 'settings.slicer.exportMeta.desc',
            type: 'inline-switch',
            get: () => settings.spriteSlicer.defaults.exportOptions.meta,
            set: (v: boolean) => { settings.spriteSlicer.defaults.exportOptions.meta = v },
            defaultVal: DEFAULTS.spriteSlicer.defaults.exportOptions.meta,
          },
        ],
      },
    ],
  },
]

function flatCategories(cats: Category[], depth = 0): (Category & { depth: number })[] {
  const result: (Category & { depth: number })[] = []
  for (const c of cats) {
    result.push({ ...c, depth })
    if (c.children) {
      result.push(...flatCategories(c.children, depth + 1))
    }
  }
  return result
}

const flatCats = computed(() => flatCategories(categories))
const activeCatId = ref(flatCats.value.find(c => c.items && c.items.length > 0)?.id || '')

const activeItems = computed(() => {
  const cat = flatCats.value.find(c => c.id === activeCatId.value)
  return cat?.items ?? []
})

function selectCat(id: string) {
  const cat = flatCats.value.find(c => c.id === id)
  if (cat?.items && cat.items.length > 0) {
    activeCatId.value = id
  } else if (cat?.children?.length) {
    const first = flatCategories(cat.children).find(c => c.items && c.items.length > 0)
    if (first) activeCatId.value = first.id
  }
}

function onResetAll() {
  resetSettings()
}

function isModified(item: SettingItem): boolean {
  return item.get() !== item.defaultVal
}

function resetItem(item: SettingItem) {
  item.set(item.defaultVal)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="sd-overlay" @click="emit('close')">
      <div class="sd-dialog" @click.stop @keydown.escape="emit('close')">
        <!-- Header -->
        <div class="sd-header">
          <SvgIcon name="settings" :size="16" />
          <span class="sd-title">{{ t('settings.title') }}</span>
          <span class="sd-spacer" />
          <button class="sd-reset-btn" @click="onResetAll" :title="t('settings.resetAll')">
            <SvgIcon name="undo" :size="12" />
            {{ t('settings.resetAll') }}
          </button>
          <button class="sd-close" @click="emit('close')">✕</button>
        </div>

        <div class="sd-body">
          <!-- Sidebar -->
          <nav class="sd-sidebar">
            <button
              v-for="cat in flatCats"
              :key="cat.id"
              class="sd-cat"
              :class="{ active: activeCatId === cat.id, leaf: !!cat.items?.length }"
              :style="{ paddingLeft: (12 + cat.depth * 16) + 'px' }"
              @click="selectCat(cat.id)"
            >
              <SvgIcon :name="cat.icon" :size="13" />
              <span>{{ t(cat.labelKey) }}</span>
            </button>
          </nav>

          <!-- Content -->
          <div class="sd-content">
            <div v-for="item in activeItems" :key="item.key" class="sd-item">
              <div class="sd-item-head">
                <label class="sd-label">{{ t(item.labelKey) }}</label>
                <button
                  v-if="isModified(item)"
                  class="sd-item-reset"
                  :title="t('common.reset')"
                  @click="resetItem(item)"
                >
                  <SvgIcon name="undo" :size="10" />
                </button>
              </div>
              <p v-if="item.descKey" class="sd-desc">{{ t(item.descKey) }}</p>

              <!-- Boolean -->
              <label v-if="item.type === 'boolean'" class="sd-toggle">
                <input
                  type="checkbox"
                  :checked="item.get()"
                  @change="item.set(($event.target as HTMLInputElement).checked)"
                />
                <span class="sd-toggle-track"><span class="sd-toggle-thumb" /></span>
              </label>

              <!-- Number -->
              <div v-if="item.type === 'number'" class="sd-number">
                <input
                  type="number"
                  :value="item.get()"
                  :min="item.min"
                  :max="item.max"
                  :step="item.step"
                  @input="item.set(Number(($event.target as HTMLInputElement).value))"
                />
              </div>

              <!-- String -->
              <div v-if="item.type === 'string'" class="sd-string">
                <input
                  type="text"
                  :value="item.get()"
                  @input="item.set(($event.target as HTMLInputElement).value)"
                />
              </div>

              <!-- Select -->
              <div v-if="item.type === 'select'" class="sd-select">
                <select
                  :value="item.get()"
                  @change="item.set(($event.target as HTMLSelectElement).value)"
                >
                  <option
                    v-for="opt in item.options"
                    :key="opt.value"
                    :value="opt.value"
                  >{{ t(opt.labelKey) }}</option>
                </select>
              </div>

              <!-- Segmented -->
              <SegmentedControl
                v-if="item.type === 'segmented' && item.options"
                :model-value="item.get()"
                :options="item.options"
                @update:model-value="item.set($event)"
              />

              <!-- Inline Switch -->
              <InlineSwitch
                v-if="item.type === 'inline-switch'"
                :model-value="item.get()"
                :label="''"
                :tooltip="item.descKey ? t(item.descKey) : undefined"
                @update:model-value="item.set($event)"
              />
            </div>

            <div v-if="activeItems.length === 0" class="sd-empty">
              {{ t('settings.selectCategory') }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.sd-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}
.sd-dialog {
  background: #252525;
  border: 1px solid #444;
  border-radius: 12px;
  width: min(680px, 90vw);
  height: min(520px, 80vh);
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}

/* Header */
.sd-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid #3a3a3a;
  background: #2a2a2a;
  flex-shrink: 0;
}
.sd-title { font-size: 14px; font-weight: 600; color: #eee; }
.sd-spacer { flex: 1; }
.sd-reset-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: 1px solid #555;
  border-radius: 5px;
  color: #999;
  font-size: 11px;
  padding: 3px 8px;
  cursor: pointer;
  transition: all 0.12s;
}
.sd-reset-btn:hover { border-color: #888; color: #ddd; }
.sd-close {
  background: none;
  border: none;
  color: #888;
  font-size: 16px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.sd-close:hover { color: #ddd; }

/* Body */
.sd-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* Sidebar */
.sd-sidebar {
  width: 180px;
  flex-shrink: 0;
  border-right: 1px solid #3a3a3a;
  padding: 8px 0;
  overflow-y: auto;
  background: #262626;
}
.sd-cat {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 12px;
  background: none;
  border: none;
  color: #999;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s, color 0.1s;
  border-left: 2px solid transparent;
}
.sd-cat:not(.leaf) {
  color: #777;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  cursor: default;
  margin-top: 6px;
}
.sd-cat.leaf:hover { background: #333; color: #ccc; }
.sd-cat.active {
  background: #333;
  color: #eee;
  border-left-color: #5b9cf6;
}

/* Content */
.sd-content {
  flex: 1;
  padding: 16px 24px;
  overflow-y: auto;
}
.sd-item {
  padding: 12px 0;
  border-bottom: 1px solid #2f2f2f;
}
.sd-item:last-child { border-bottom: none; }
.sd-item-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}
.sd-label {
  font-size: 13px;
  color: #ddd;
  font-weight: 500;
}
.sd-item-reset {
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  padding: 2px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  transition: color 0.1s;
}
.sd-item-reset:hover { color: #5b9cf6; }
.sd-desc {
  font-size: 11px;
  color: #888;
  margin: 2px 0 8px;
  line-height: 1.4;
}

/* Toggle */
.sd-toggle {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
}
.sd-toggle input { display: none; }
.sd-toggle-track {
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: #444;
  position: relative;
  transition: background 0.2s;
}
.sd-toggle input:checked + .sd-toggle-track {
  background: #3b82f6;
}
.sd-toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #ccc;
  transition: transform 0.2s, background 0.2s;
}
.sd-toggle input:checked + .sd-toggle-track .sd-toggle-thumb {
  transform: translateX(16px);
  background: #fff;
}

/* Number */
.sd-number input {
  width: 80px;
  background: #1e1e1e;
  border: 1px solid #555;
  border-radius: 5px;
  padding: 5px 8px;
  color: #eee;
  font-size: 12px;
  outline: none;
  transition: border-color 0.15s;
}
.sd-number input:focus { border-color: #5b9cf6; }

/* String */
.sd-string input {
  width: 160px;
  background: #1e1e1e;
  border: 1px solid #555;
  border-radius: 5px;
  padding: 5px 8px;
  color: #eee;
  font-size: 12px;
  outline: none;
  transition: border-color 0.15s;
}
.sd-string input:focus { border-color: #5b9cf6; }

/* Select */
.sd-select select {
  background: #1e1e1e;
  border: 1px solid #555;
  border-radius: 5px;
  padding: 5px 8px;
  color: #eee;
  font-size: 12px;
  outline: none;
  cursor: pointer;
  transition: border-color 0.15s;
}
.sd-select select:focus { border-color: #5b9cf6; }

/* Empty */
.sd-empty {
  color: #666;
  font-size: 13px;
  text-align: center;
  padding: 40px 0;
}
</style>
