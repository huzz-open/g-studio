<script setup lang="ts">
import SegmentedControl from '../../shared/components/SegmentedControl.vue'
import { useI18n } from '../../shared/i18n'
import type { SceneState } from './model'
defineProps<{state:SceneState}>()
const {t}=useI18n()
</script>
<template>
  <SegmentedControl :label="t('sceneLight.display')" :model-value="state.mode" :options="[{value:'sprites',label:t('sceneLight.sprites')},{value:'geometry',label:t('sceneLight.geometry')},{value:'visibility',label:t('sceneLight.visibility')}]" role="group" :aria-label="t('sceneLight.display')" @update:model-value="v=>{if(v==='sprites'||v==='geometry'||v==='visibility')state.mode=v}"/>

</template>
