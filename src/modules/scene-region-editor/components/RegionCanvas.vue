<script setup lang="ts">
import { computed } from 'vue'
import ImageCanvas from '../../../shared/components/ImageCanvas.vue'
import RegionDrawTool from '../../../shared/components/draw-tools/RegionDrawTool.vue'
import type { DrawnPolygon, DrawPoint } from '../../../shared/components/draw-tools/types'
import type { SceneRegionStore } from '../store'

const props = defineProps<{
  store: SceneRegionStore
}>()

const visibleRegionPolygons = computed<DrawnPolygon[]>(() =>
  props.store.visibleRegions.value.map(r => ({
    id: r.id,
    vertices: r.vertices.map(([x, y]) => ({ x, y })),
  }))
)

const creationMode = computed<'rect' | 'polygon'>(() =>
  props.store.state.activeTool === 'rect' ? 'rect' : 'polygon'
)

const isActive = computed(() =>
  props.store.state.activeTool !== 'select'
)

const viewportCursor = computed(() =>
  isActive.value ? 'crosshair' : 'default'
)

function onRegionCreated(vertices: DrawPoint[]) {
  const createdAs = props.store.state.activeTool === 'rect' ? 'rect' as const : 'polygon' as const
  props.store.addRegion(vertices, createdAs)
}

function onRegionUpdated(payload: { id: string; vertices: DrawPoint[] }) {
  props.store.updateRegionVertices(payload.id, payload.vertices)
}

function onRegionSelected(id: string | null) {
  props.store.selectRegion(id)
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
    :viewport-cursor="viewportCursor"
    pan-mode="middle"
    controls-position="bottom-right"
  >
    <template #default>
      <RegionDrawTool
        :image-width="store.state.imageSize.w"
        :image-height="store.state.imageSize.h"
        :polygons="visibleRegionPolygons"
        :selected-id="store.state.selectedRegionId"
        :active="isActive"
        :creation-mode="creationMode"
        :polygon-colors="store.regionColorMap.value"
        :preview-fill="true"
        :preview-color="store.state.creationPreset.color"
        @polygon-created="onRegionCreated"
        @polygon-updated="onRegionUpdated"
        @polygon-selected="onRegionSelected"
      />
    </template>
  </ImageCanvas>
</template>
