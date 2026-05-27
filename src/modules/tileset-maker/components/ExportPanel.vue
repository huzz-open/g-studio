<script setup lang="ts">
import { useI18n } from '../../../shared/i18n'
import type { TilesetInstance } from '../store'
import { generateTres } from '../core/tres-export'
import { getLayout } from '../core/layouts'
import { downloadBlob } from '../../../shared/utils/download'
import { pixelsToBlob } from '../../../shared/utils/canvas'

const { t } = useI18n()
const props = defineProps<{ store: TilesetInstance }>()

async function exportPng() {
  const s = props.store.state
  const blob = await pixelsToBlob(s.atlasPixels, s.atlasWidth, s.atlasHeight)
  downloadBlob(blob, `${s.terrainName || 'tileset'}.png`)
}

function exportPngTres() {
  exportPng()
  const s = props.store.state
  const tileSize = s.atlasTileW
  const filename = `${s.terrainName || 'tileset'}.png`
  const layout = getLayout(s.layout)
  const tres = generateTres(filename, tileSize, s.terrainName || 'Terrain', layout)
  downloadBlob(new Blob([tres], { type: 'text/plain' }), `${s.terrainName || 'tileset'}.tres`)
}
</script>

<template>
  <div class="export-panel">
    <div class="field">
      <label>{{ t('tileset.terrainName') }}</label>
      <input
        type="text"
        v-model="props.store.state.terrainName"
        class="input-sm"
      />
    </div>
    <div class="actions">
      <button class="btn-export" :disabled="!props.store.state.atlasPixels" @click="exportPng">
        {{ t('tileset.export.png') }}
      </button>
      <button class="btn-export" :disabled="!props.store.state.atlasPixels" @click="exportPngTres">
        {{ t('tileset.export.pngTres') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.export-panel {
  padding: 12px;
  border-top: 1px solid #333;
}
.field { margin-bottom: 8px; }
.field label { font-size: 11px; color: #999; display: block; margin-bottom: 4px; }
.input-sm {
  width: 100%;
  padding: 4px 8px;
  font-size: 12px;
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 4px;
  color: #ccc;
}
.actions { display: flex; flex-direction: column; gap: 6px; }
.btn-export {
  padding: 6px 12px;
  font-size: 12px;
  background: #333;
  border: 1px solid #555;
  border-radius: 5px;
  color: #ccc;
  cursor: pointer;
  text-align: center;
}
.btn-export:hover:not(:disabled) { border-color: #888; color: #eee; }
.btn-export:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
