<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { useI18n } from '../../../shared/i18n'
import SvgIcon from '../../../shared/icons/SvgIcon.vue'
import GridCanvas from '../../../shared/components/GridCanvas.vue'
import type { SharedTerrainState, TilesetRef } from '../terrain-state'
import { computePeering, findTilePosition } from '../core/preview'
import { getLayout } from '../core/layouts'

const { t } = useI18n()
const props = defineProps<{ terrain: SharedTerrainState }>()

const gridRef = ref<InstanceType<typeof GridCanvas>>()

// --- Atlas OffscreenCanvas cache ---
const atlasCache = new Map<string, OffscreenCanvas>()

function rebuildAtlasCache(tilesets: TilesetRef[]) {
  const currentIds = new Set(tilesets.map(ts => ts.id))
  for (const id of atlasCache.keys()) {
    if (!currentIds.has(id)) atlasCache.delete(id)
  }
  for (const ts of tilesets) {
    const oc = new OffscreenCanvas(ts.atlasWidth, ts.atlasHeight)
    const ctx = oc.getContext('2d')!
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(ts.atlasPixels), ts.atlasWidth, ts.atlasHeight),
      0, 0,
    )
    atlasCache.set(ts.id, oc)
  }
}

onUnmounted(() => { atlasCache.clear() })

watch(
  () => props.terrain.availableTilesets.value,
  (tilesets) => {
    rebuildAtlasCache(tilesets)
    gridRef.value?.requestRender()
  },
  { immediate: true },
)

watch(
  () => props.terrain.state.terrainGrid,
  () => { gridRef.value?.requestRender() },
  { deep: true },
)

const cellSize = computed(() => {
  const ts = props.terrain.activeTileset.value
  return ts && ts.atlasTileW > 0 ? ts.atlasTileW : 32
})

function paintCells(ctx: CanvasRenderingContext2D) {
  const cols = props.terrain.gridCols.value
  const rows = props.terrain.gridRows.value
  const cs = cellSize.value
  const grid = props.terrain.state.terrainGrid
  const ox = props.terrain.state.originX
  const oy = props.terrain.state.originY
  const tilesets = props.terrain.availableTilesets.value
  const tilesetMap = new Map<string, TilesetRef>(tilesets.map(ts => [ts.id, ts]))

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cellId = grid[y]?.[x]
      if (!cellId) continue

      const worldX = (ox + x) * cs
      const worldY = (oy + y) * cs

      const ts = tilesetMap.get(cellId)
      const cached = atlasCache.get(cellId)
      if (ts && cached && ts.atlasTileW > 0) {
        const layout = getLayout(ts.layout)
        const peering = computePeering(grid, x, y, rows, cols, cellId)
        const pos = findTilePosition(peering, layout)
        if (pos) {
          ctx.drawImage(
            cached,
            pos.col * ts.atlasTileW, pos.row * ts.atlasTileH,
            ts.atlasTileW, ts.atlasTileH,
            worldX, worldY, cs, cs,
          )
        }
      } else {
        ctx.fillStyle = '#2a1a1a'
        ctx.fillRect(worldX, worldY, cs, cs)
      }
    }
  }
}

// --- Cell interaction ---
let drawErasing = false

function onCellDown(x: number, y: number, button: number) {
  drawErasing = button === 2
  props.terrain.beginStroke()
  if (drawErasing) {
    props.terrain.terrainDraw(x, y, null)
  } else {
    const tsId = props.terrain.activeTileset.value?.id
    if (!tsId) return
    props.terrain.terrainDraw(x, y, tsId)
  }
}

function onCellMove(x: number, y: number) {
  if (drawErasing) {
    props.terrain.terrainDraw(x, y, null)
  } else {
    const tsId = props.terrain.activeTileset.value?.id
    if (!tsId) return
    props.terrain.terrainDraw(x, y, tsId)
  }
}

function onClear() {
  props.terrain.clearTerrain()
  gridRef.value?.requestRender()
}

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault()
    if (e.shiftKey) props.terrain.terrainRedo()
    else props.terrain.terrainUndo()
    gridRef.value?.requestRender()
  }
}
</script>

<template>
  <GridCanvas
    ref="gridRef"
    :cols="terrain.gridCols.value"
    :rows="terrain.gridRows.value"
    :origin-x="terrain.originX.value"
    :origin-y="terrain.originY.value"
    :cell-size="cellSize"
    :paint-cells="paintCells"
    @cell-down="onCellDown"
    @cell-move="onCellMove"
    @keydown="onKeydown"
    @contextmenu.prevent
  >
    <template #toolbar>
      <div class="tc-toolbar">
        <div class="tc-toolbar-left">
          <span class="tc-label">{{ t('tileset.terrain.title') }}</span>
          <button class="tc-btn" @click="onClear" :title="t('tileset.terrain.clear')">
            <SvgIcon name="trash" :size="12" />
          </button>
        </div>
        <div class="tc-toolbar-right">
          <span v-if="terrain.activeTileset.value" class="tc-tileset-label">
            {{ t('tileset.terrain.brush') }}: {{ terrain.activeTileset.value.label }}
          </span>
          <span v-else class="tc-no-tileset">{{ t('tileset.terrain.noTileset') }}</span>
        </div>
      </div>
    </template>
  </GridCanvas>
</template>

<style scoped>
.tc-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 10px;
  background: #222;
  border-bottom: 1px solid #333;
  flex-shrink: 0;
  height: 32px;
}
.tc-toolbar-left,
.tc-toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.tc-label {
  font-size: 11px;
  color: #aaa;
  font-weight: 500;
}
.tc-btn {
  background: none;
  border: 1px solid #444;
  border-radius: 3px;
  color: #888;
  cursor: pointer;
  padding: 2px 4px;
  display: flex;
  align-items: center;
}
.tc-btn:hover { color: #ccc; border-color: #666; }
.tc-tileset-label {
  font-size: 10px;
  color: #8ab4f8;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tc-no-tileset {
  font-size: 10px;
  color: #666;
  font-style: italic;
}
</style>
