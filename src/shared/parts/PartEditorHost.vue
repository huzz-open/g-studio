<script setup lang="ts">
import { partEditorSession } from './editor-session'
import { partLibrary } from './library'
import PartEditor from './PartEditor.vue'
</script>
<template><PartEditor v-if="partEditorSession&&partLibrary[partEditorSession.assetId]" :key="partEditorSession.assetId+partEditorSession.origin" :asset="partLibrary[partEditorSession.assetId]" :origin="partEditorSession.origin"/></template>
