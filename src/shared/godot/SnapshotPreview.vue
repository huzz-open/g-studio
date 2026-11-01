<script setup lang="ts">
import {ref,reactive,onMounted} from 'vue'
import type {PartAsset} from '../parts/schema'
import {createPartPreview} from '../parts/preview-state'
import {fitModelComparison} from '../parts/model-comparison'
import {renderSnapshot} from './render-snapshot'
import ModelComparisonViewport from '../parts/ModelComparisonViewport.vue'
const props=defineProps<{part:PartAsset;expectedHash:string}>()
const state=reactive(createPartPreview(props.part)),host=ref<HTMLElement>(),effect=ref(false),verified=ref('校验中'),autoFit=ref(true)
state.mode='model';state.cameraPitch=20
function fit(){const r=host.value?.getBoundingClientRect();if(r?.height)fitModelComparison(state,props.part,props.part,r.width/r.height)}
onMounted(async()=>{const mesh=renderSnapshot(props.part),digest=await crypto.subtle.digest('SHA-256',new Float32Array(mesh.vertices).buffer),hash=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');verified.value=hash===props.expectedHash?'前端网格与导出快照一致':'网格校验失败'})
</script>
<template><div><p role="status">{{verified}} · 导出场景视角为 20°；拖动仅改变观察视角。</p><button @click="effect=!effect">{{effect?'查看模型':'查看 GS 效果'}}</button><button @click="fit">导出参考视角</button><div ref="host" class="snapshot-preview"><ModelComparisonViewport :original="part" :candidate="part" :state="state" :display="{mode:effect?'effect':'alignment'}" single :guides="false" :auto-fit="autoFit" :fit-view="fit" @interact="autoFit=false"/></div></div></template>
<style scoped>.snapshot-preview{height:440px;display:flex;position:relative;margin-top:10px}button{background:#333;color:#ddd;border:1px solid #555;border-radius:4px;padding:6px;margin-right:8px}</style>
