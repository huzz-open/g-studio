<script setup lang="ts">
import MapToolbar from './MapToolbar.vue'
import MapLocationList from './MapLocationList.vue'
import MapCanvas from './MapCanvas.vue'
import MapPropertyPanel from './MapPropertyPanel.vue'
</script>

<template>
  <div class="map-editor-view">
    <MapToolbar />
    <div class="editor-main">
      <MapLocationList />
      <MapCanvas />
      <MapPropertyPanel />
    </div>
  </div>
</template>

<style scoped>
.map-editor-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.editor-main {
  flex: 1;
  display: flex;
  overflow: hidden;
}
</style>
