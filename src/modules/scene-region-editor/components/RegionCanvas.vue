<script setup lang="ts">
import { computed, unref } from 'vue'
import ImageCanvas from '../../../shared/components/ImageCanvas.vue'
import RegionDrawTool from '../../../shared/components/draw-tools/RegionDrawTool.vue'
import type { DrawnPolygon, DrawPoint } from '../../../shared/components/draw-tools/types'
import type { SceneRegionStore } from '../store'
import type { Transaction } from '../../../shared/history'

const props = defineProps<{
  store: SceneRegionStore
}>()

let vertexDragTx: Transaction | null = null

const visibleRegionPolygons = computed<DrawnPolygon[]>(() =>
  unref(props.store.visibleRegions).map(r => ({
    id: r.id,
    vertices: r.vertices.map(([x, y]) => ({ x, y })),
  }))
)

const regionColorMap = computed(() => unref(props.store.regionColorMap))

const creationMode = computed<'rect' | 'polygon'>(() =>
  props.store.state.activeTool === 'rect' ? 'rect' : 'polygon'
)

function onRegionCreated(vertices: DrawPoint[]) {
  props.store.addRegion(vertices)
}

function onRegionUpdated(payload: { id: string; vertices: DrawPoint[] }) {
  if (!vertexDragTx) {
    props.store.history.record()
  }
  props.store.updateRegionVertices(payload.id, payload.vertices)
}

function onRegionSelected(id: string | null) {
  props.store.selectRegion(id)
}

function onVertexDragStart() {
  vertexDragTx = props.store.history.transaction()
}

function onVertexDragEnd() {
  vertexDragTx?.commit()
  vertexDragTx = null
}
</script>

<template>
  <ImageCanvas
    :src="store.state.imageUrl"
    :pixelated="true"
    :checker-background="true"
    :min-scale="0.1"
    :max-scale="16"
    :keep-view-on-src-change="true"
    viewport-cursor="crosshair"
    pan-mode="middle"
    controls-position="bottom-right"
  >
    <template #default>
      <RegionDrawTool
        :image-width="store.state.imageSize.w"
        :image-height="store.state.imageSize.h"
        :polygons="visibleRegionPolygons"
        :selected-id="store.state.selectedRegionId"
        :active="true"
        :creation-mode="creationMode"
        :polygon-colors="regionColorMap"
        :preview-fill="true"
        :preview-color="store.state.creationConfig.color"
        @polygon-created="onRegionCreated"
        @polygon-updated="onRegionUpdated"
        @polygon-selected="onRegionSelected"
        @vertex-drag-start="onVertexDragStart"
        @vertex-drag-end="onVertexDragEnd"
      />
    </template>
  </ImageCanvas>
</template>
