<script setup lang="ts">
import { useI18n } from '../../../shared/i18n'
import type { TilesetInstance } from '../store'
import FileDropZone from '../../../shared/components/FileDropZone.vue'
import { CheckboxRow } from '../../../shared/components/editor-shell/sidebar-atoms'

const { t } = useI18n()
const props = defineProps<{ store: TilesetInstance }>()
</script>

<template>
  <div class="ninegrid-source-panel">
    <div class="section">
      <label class="section-title">{{ t('tileset.ninegrid.upload') }}</label>
      <FileDropZone
        compact
        accept="image/png,image/jpeg,image/webp"
        :hint="props.store.state.nineGridFileName ? props.store.state.nineGridFileName : t('tileset.empty.subtileHint')"
        :file-name="props.store.state.nineGridFileName ? `${props.store.state.nineGridWidth} × ${props.store.state.nineGridHeight} px` : ''"
        icon="image"
        @file="(f: File) => props.store.loadNineGrid(f)"
      />
      <p v-if="props.store.state.generateError && props.store.state.mode === 'subtile'" class="error">
        {{ props.store.state.generateError }}
      </p>
    </div>

    <div class="section">
      <CheckboxRow
        :label="t('tileset.ninegrid.magenta')"
        :model-value="props.store.state.useMagenta"
        @update:model-value="props.store.setMagenta($event)"
      />
      <div v-if="props.store.state.useMagenta" class="slider-row">
        <label>{{ t('tileset.ninegrid.tolerance') }}</label>
        <input
          type="range"
          :min="0"
          :max="100"
          :step="1"
          :value="props.store.state.magentaTolerance"
          @input="props.store.setMagentaTolerance(parseInt(($event.target as HTMLInputElement).value))"
        />
        <span class="slider-val">{{ props.store.state.magentaTolerance }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ninegrid-source-panel {
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
.error { color: #e88; font-size: 11px; margin-top: 6px; }
.slider-row {
  display: grid;
  grid-template-columns: auto 1fr 30px;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
.slider-row label { font-size: 11px; color: #999; }
.slider-val { font-size: 10px; color: #888; }
</style>
