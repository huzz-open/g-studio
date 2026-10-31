<script setup lang="ts">
import { watch } from 'vue'
import SegmentedControl from '../../shared/components/SegmentedControl.vue'
import { useI18n } from '../../shared/i18n'
import type { SceneState } from './model'
const props=defineProps<{state:SceneState;modelTools?:boolean}>()
watch(()=>[props.modelTools,props.state.mode],()=>{if(!props.modelTools&&props.state.mode==='model')props.state.mode='sprites'},{immediate:true})
const {t}=useI18n()
</script>
<template>
  <SegmentedControl :label="t('sceneLight.display')" :model-value="state.mode" :options="[{value:'sprites',label:t('sceneLight.sprites')},...(modelTools?[{value:'model',label:t('sceneLight.model')}]:[]),{value:'visibility',label:t('sceneLight.visibility')}]" role="group" :aria-label="t('sceneLight.display')" @update:model-value="v=>{if(v==='sprites'||v==='model'||v==='visibility')state.mode=v}"/>

</template>
