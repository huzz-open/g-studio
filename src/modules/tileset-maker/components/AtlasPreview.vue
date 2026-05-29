<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { pixelsToBlobUrl } from '../../../shared/utils/canvas'
import type { TilesetInstance } from '../store'
import { getLayout } from '../core/layouts'
import ImageCanvas from '../../../shared/components/ImageCanvas.vue'

const props = defineProps<{ store: TilesetInstance }>()
const hoverTile = ref<{ col: number; row: number; idx: number } | null>(null)
const atlasBlobUrl = ref('')

const layout = computed(() => getLayout(props.store.state.layout))
const tileW = computed(() => props.store.state.atlasTileW)
const tileH = computed(() => props.store.state.atlasTileH)
const atlasW = computed(() => props.store.state.atlasWidth)
const atlasH = computed(() => props.store.state.atlasHeight)
const layoutCols = computed(() => layout.value.cols)
const layoutRows = computed(() => layout.value.rows)

watch(() => props.store.state.atlasPixels, async (pixels) => {
  if (!pixels) { atlasBlobUrl.value = ''; return }
  const oldUrl = atlasBlobUrl.value
  atlasBlobUrl.value = await pixelsToBlobUrl(
    pixels,
    props.store.state.atlasWidth,
    props.store.state.atlasHeight,
  )
  if (oldUrl) URL.revokeObjectURL(oldUrl)
}, { immediate: true })

onUnmounted(() => {
  if (atlasBlobUrl.value) URL.revokeObjectURL(atlasBlobUrl.value)
})

const gridLines = computed(() => {
  if (!tileW.value || !tileH.value) return []
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = []
  for (let c = 1; c < layoutCols.value; c++) {
    const x = c * tileW.value
    lines.push({ x1: x, y1: 0, x2: x, y2: atlasH.value })
  }
  for (let r = 1; r < layoutRows.value; r++) {
    const y = r * tileH.value
    lines.push({ x1: 0, y1: y, x2: atlasW.value, y2: y })
  }
  return lines
})

function onSvgMouseMove(e: MouseEvent) {
  const svg = e.currentTarget as SVGSVGElement
  const pt = svg.createSVGPoint()
  pt.x = e.clientX
  pt.y = e.clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return
  const svgPt = pt.matrixTransform(ctm.inverse())
  const col = Math.floor(svgPt.x / tileW.value)
  const row = Math.floor(svgPt.y / tileH.value)
  const tile = layout.value.tiles.find(t => t.col === col && t.row === row)
  hoverTile.value = tile ? { col, row, idx: tile.peeringIndex } : null
}

function onSvgMouseLeave() {
  hoverTile.value = null
}
</script>

<template>
  <div class="atlas-preview">
    <ImageCanvas
      :src="atlasBlobUrl"
      :pixelated="true"
      :checker-background="true"
      :min-scale="0.25"
      :max-scale="16"
      :keep-view-on-src-change="true"
      show-info-bar
      controls-position="bottom-right"
    >
      <template #default>
        <svg
          v-if="atlasW && atlasH"
          class="grid-overlay"
          :viewBox="`0 0 ${atlasW} ${atlasH}`"
          preserveAspectRatio="xMidYMid meet"
          overflow="visible"
          @mousemove="onSvgMouseMove"
          @mouseleave="onSvgMouseLeave"
        >
          <rect :width="atlasW" :height="atlasH" fill="transparent" />

          <line
            v-for="(ln, i) in gridLines" :key="i"
            :x1="ln.x1" :y1="ln.y1" :x2="ln.x2" :y2="ln.y2"
            stroke="rgba(255,255,255,0.15)" stroke-width="1"
            shape-rendering="crispEdges"
            style="pointer-events: none"
          />

          <rect
            v-if="hoverTile"
            :x="hoverTile.col * tileW"
            :y="hoverTile.row * tileH"
            :width="tileW"
            :height="tileH"
            fill="rgba(106, 154, 226, 0.18)"
            stroke="rgba(106, 154, 226, 0.7)"
            stroke-width="1.5"
            style="pointer-events: none"
          />
        </svg>
      </template>
    </ImageCanvas>
  </div>
</template>

<style scoped>
.atlas-preview {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.grid-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
</style>
