<script setup lang="ts">
import { ref } from 'vue'
import LightingViewport from '../../modules/scene-lighting/LightingViewport.vue'
import ModelReferenceOverlay from './ModelReferenceOverlay.vue'
import type { PartAsset } from './schema'
import type { SceneState } from '../../modules/scene-lighting/model'
defineProps<{part:PartAsset;state:SceneState;mode:'overlay'|'difference';opacity:number;fitView:()=>void}>()
const emit=defineEmits<{ready:[];interact:[]}>()
const imageReady=ref(false),modelReady=ref(false)
function ready(side:'image'|'model'){if(side==='image')imageReady.value=true;else modelReady.value=true;if(imageReady.value&&modelReady.value)emit('ready')}
</script>
<template><div class="model-image-view">
<LightingViewport :state="state" :assets="[part]" compact :editable="false" :controls="false" :fit-view="fitView" :auto-fit="false" :display="{mode:'source'}" :guides="false" @ready="ready('image')"/>
<LightingViewport class="model-layer" :style="{opacity:mode==='overlay'?opacity:1}" :state="state" :assets="[part]" compact :editable="false" :controls="false" :auto-fit="false" :display="{mode:'alignment'}" :guides="false" @ready="ready('model')" @zoom="emit('interact')" @pan="emit('interact')"/>
<ModelReferenceOverlay :show-legend="false" v-if="mode==='difference'" :part="part" :state="state"/>
</div></template>
<style scoped>.model-image-view{position:relative;width:100%;height:100%}.model-image-view>.lighting-viewport{position:absolute;inset:0}.model-layer{mix-blend-mode:screen}</style>
