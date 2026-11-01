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

  <label class="camera-pitch">{{t('parts.cameraPitch')}}<input type="range" min="5" max="80" :value="state.cameraPitch??20" @input="state.cameraPitch=Number(($event.target as HTMLInputElement).value)"/><span>{{(state.cameraPitch??20).toFixed(1)}}°</span></label>
</template>

<style scoped>.camera-pitch{display:flex;align-items:center;gap:8px;font-size:11px;color:#bbb}.camera-pitch input{min-width:40px;flex:1;width:90px}</style>
