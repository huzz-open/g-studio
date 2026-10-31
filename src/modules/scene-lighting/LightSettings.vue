<script setup lang="ts">
import { computed } from 'vue'
import { SliderRow } from '../../shared/components/editor-shell/sidebar-atoms'
import SegmentedControl from '../../shared/components/SegmentedControl.vue'
import InlineSwitch from '../../shared/components/InlineSwitch.vue'
import { useI18n } from '../../shared/i18n'
import { roomBounds, createScene, type SceneState } from './model'
const props=withDefaults(defineProps<{state:SceneState; showShadowToggle?:boolean; defaults?:Pick<SceneState,'light'|'power'|'ambient'|'sun'>}>(),{showShadowToggle:true})
const {t}=useI18n()
const factoryDefaults=createScene()
const defaults=computed(()=>props.defaults??factoryDefaults)
const bounds=computed(()=>roomBounds(props.state.room))
const lightX=computed({get:()=>props.state.light[0]-bounds.value.minX,set:v=>{props.state.light[0]=v+bounds.value.minX}})
const lightZ=computed({get:()=>props.state.light[2]-bounds.value.minZ,set:v=>{props.state.light[2]=v+bounds.value.minZ}})
</script>
<template>
        <SegmentedControl v-model="state.lightKind" :label="t('sceneLight.lightType')" :options="[{value:'point',label:t('sceneLight.point')},{value:'directional',label:t('sceneLight.directional')}]"/>
        <template v-if="state.lightKind==='point'">
          <SliderRow v-model="lightX" :default-value="Math.max(0,Math.min(state.room.width,defaults.light[0]-bounds.minX))" :label="t('sceneLight.positionX')" :min="Math.min(0,lightX)" :max="Math.max(state.room.width,lightX)" :step="0.01" :precision="2"/>
          <SliderRow v-model="state.light[1]" :default-value="defaults.light[1]" :label="t('sceneLight.positionY')" :min="0.5" :max="12" :step="0.1" :precision="1"/>
          <SliderRow v-model="lightZ" :default-value="Math.max(0,Math.min(state.room.depth,defaults.light[2]-bounds.minZ))" :label="t('sceneLight.positionZ')" :min="Math.min(0,lightZ)" :max="Math.max(state.room.depth,lightZ)" :step="0.01" :precision="2"/>
          <SliderRow v-if="state.mode!=='visibility'" v-model="state.power" :default-value="defaults.power" :label="t('sceneLight.power')" :min="0" :max="60" :step="1" :precision="0"/>
        </template>
        <template v-else>
          <SliderRow v-model="state.sun.azimuth" :default-value="defaults.sun.azimuth" :label="t('sceneLight.azimuth')" :min="-180" :max="180" :step="1" :precision="0" suffix="°"/>
          <SliderRow v-model="state.sun.elevation" :default-value="defaults.sun.elevation" :label="t('sceneLight.elevation')" :min="5" :max="85" :step="1" :precision="0" suffix="°"/>
          <SliderRow v-if="state.mode!=='visibility'" v-model="state.sun.intensity" :default-value="defaults.sun.intensity" :label="t('sceneLight.power')" :min="0" :max="4" :step="0.05" :precision="2"/>
        </template>
        <SliderRow v-if="state.mode!=='visibility'" v-model="state.ambient" :default-value="defaults.ambient" :label="t('sceneLight.ambient')" :min="0" :max="1" :step="0.01" :precision="2"/>
        <InlineSwitch v-if="showShadowToggle!==false" v-model="state.shadows" :label="t('sceneLight.shadows')" block/><InlineSwitch v-model="state.filtered" :label="t('sceneLight.filter')" block/>
</template>
