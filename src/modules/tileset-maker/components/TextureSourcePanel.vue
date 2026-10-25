<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../../shared/i18n'
import { useSettings } from '../../../shared/settings'
import type { TilesetInstance } from '../store'
import { PROFILE_NAMES, SLIDER_DEFS, getProfile } from '../core/sdf/profiles'
import type { TileSize } from '../core/types'
import FileDropZone from '../../../shared/components/FileDropZone.vue'
import { SegmentedControl, SliderRow, ActionButtons } from '../../../shared/components/editor-shell'
import type { SegmentOption } from '../../../shared/components/editor-shell'

const { t } = useI18n()
const { settings } = useSettings()
const props = defineProps<{ store: TilesetInstance }>()

function selectStyle(name: string) {
  props.store.setProfile(getProfile(name))
}

function onSlider(key: string, val: number) {
  props.store.setProfileParam(key as any, val)
}

const TILE_SIZES: TileSize[] = [16, 24, 32, 64]

const tileSizeOptions = computed<SegmentOption[]>(() =>
  TILE_SIZES.map(s => ({ value: String(s), label: `${s}px` }))
)

const layoutOptions: SegmentOption[] = [
  { value: '8x6', label: '8×6' },
  { value: '11x5', label: '11×5' },
]
</script>

<template>
  <div class="texture-source-panel">
    <div class="section">
      <label class="section-title">{{ t('tileset.source.upload') }}</label>
      <FileDropZone
        compact
        accept="image/png,image/jpeg,image/webp"
        :hint="props.store.state.textureFileName ? props.store.state.textureFileName : t('tileset.empty.sdfHint')"
        :file-name="props.store.state.textureFileName ? `${props.store.state.tileSize} × ${props.store.state.tileSize} px` : ''"
        icon="image"
        @file="(f: File) => props.store.loadTexture(f)"
      />
      <div class="source-actions">
        <ActionButtons :buttons="[{ id: 'draw', label: t('tileset.source.draw') }]" @click="props.store.state.showPainter = true" />
      </div>
    </div>

    <div class="section">
      <label class="section-title">{{ t('tileset.tileSize') }}</label>
      <SegmentedControl
        :model-value="String(props.store.state.tileSize)"
        :default-value="String(settings.tilesetMaker.defaults.tileSize)" :label="t('tileset.tileSize')"
        :options="tileSizeOptions"
        :indicator="false"
        @update:model-value="props.store.setTileSize(Number($event) as TileSize)"
      />
    </div>

    <div class="section">
      <label class="section-title">{{ t('tileset.layout') }}</label>
      <SegmentedControl
        :model-value="props.store.state.layout"
        :default-value="settings.tilesetMaker.defaults.layout" :label="t('tileset.layout')"
        :options="layoutOptions"
        :indicator="false"
        @update:model-value="props.store.setLayout($event as any)"
      />
    </div>

    <div class="section">
      <label class="section-title">{{ t('tileset.profile.style') }}</label>
      <div class="style-chips">
        <button
          v-for="name in PROFILE_NAMES"
          :key="name"
          class="chip"
          :class="{ active: props.store.state.profile.style === name }"
          @click="selectStyle(name)"
        >{{ t('tileset.profile.' + name) }}</button>
      </div>
    </div>

    <div class="section sliders">
      <SliderRow @commit="props.store.flushGeneration" v-for="def in SLIDER_DEFS" :key="def.key" :label="t(def.labelKey)" :min="def.min" :max="def.max" :step="0.01" :precision="2"
        :model-value="(props.store.state.profile as any)[def.key]" :default-value="getProfile(props.store.state.profile.style)[def.key] as number" @update:model-value="onSlider(def.key, $event)" />
    </div>
  </div>
</template>

<style scoped>
.texture-source-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  overflow-y: auto;
}
.section-title {
  font-size: 11px;
  color: #999;
  text-transform: uppercase;
  margin-bottom: 6px;
  display: block;
}
.source-actions {
  margin-top: 6px;
  display: flex;
  gap: 6px;
}
.style-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.chip {
  padding: 3px 8px;
  font-size: 11px;
  border-radius: 4px;
  border: 1px solid #444;
  background: #2a2a2a;
  color: #aaa;
  cursor: pointer;
  text-transform: capitalize;
}
.chip.active { border-color: #698dbd; color: #d9e8fc; background: #30445d; }
.chip:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 2px; }
.chip:hover { border-color: #666; }
.sliders { gap: 6px; display: flex; flex-direction: column; }
</style>
