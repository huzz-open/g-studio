<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../../shared/i18n'
import { ActionButtons, TextRow } from '../../../shared/components/editor-shell'
import type { ActionButton } from '../../../shared/components/editor-shell'
import type { TilesetInstance } from '../store'
import type { SharedTerrainState } from '../terrain-state'
import { generateTres } from '../core/tres-export'
import { getLayout } from '../core/layouts'
import { downloadBlob } from '../../../shared/utils/download'
import { pixelsToBlob } from '../../../shared/utils/canvas'

const { t } = useI18n()
const props = defineProps<{ store: TilesetInstance; terrain: SharedTerrainState }>()

async function exportPng() {
  const s = props.store.state
  const name = props.terrain.state.terrainName || 'tileset'
  const blob = await pixelsToBlob(s.atlasPixels!, s.atlasWidth, s.atlasHeight)
  downloadBlob(blob, `${name}.png`)
}

function exportPngTres() {
  exportPng()
  const s = props.store.state
  const name = props.terrain.state.terrainName || 'tileset'
  const tileSize = s.atlasTileW
  const filename = `${name}.png`
  const layout = getLayout(s.layout)
  const tres = generateTres(filename, tileSize, name || 'Terrain', layout)
  downloadBlob(new Blob([tres], { type: 'text/plain' }), `${name}.tres`)
}

const hasAtlas = computed(() => !!props.store.state.atlasPixels)

const exportActions = computed<ActionButton[]>(() => [
  { id: 'png', label: t('tileset.export.png'), disabled: !hasAtlas.value },
  { id: 'pngTres', label: t('tileset.export.pngTres'), disabled: !hasAtlas.value },
])

function onAction(id: string) {
  if (id === 'png') exportPng()
  else if (id === 'pngTres') exportPngTres()
}
</script>

<template>
  <div class="export-panel">
    <TextRow v-model="terrain.state.terrainName" :label="t('tileset.terrainName')" stacked live />
    <ActionButtons
      :buttons="exportActions"
      direction="column"
      @click="onAction"
    />
  </div>
</template>

<style scoped>
.export-panel {
  padding: 12px;
  border-top: 1px solid #333;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
