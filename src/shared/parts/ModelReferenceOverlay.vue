<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { clonePart, partRenderKey, type PartAsset } from './schema'
import { partPixels } from './images'
import { imageBounds } from '../../modules/scene-lighting/part-model'
import { type SceneState, type Mesh } from '../../modules/scene-lighting/model'
import { referenceProjection, alignmentColors } from './reference-projection'
import { useI18n } from '../i18n'
const props=defineProps<{part:PartAsset;state:SceneState;showLegend?:boolean}>()
const {t}=useI18n(),canvas=ref<HTMLCanvasElement>(),error=ref('')
let observer:ResizeObserver|undefined,frame=0
let data:{part:PartAsset;image:HTMLImageElement;mesh:Mesh}|undefined
watch(()=>partRenderKey(props.part),async(_,__,cleanup)=>{
  const controller=new AbortController();cleanup(()=>controller.abort())
  data=undefined;canvas.value?.getContext('2d')?.clearRect(0,0,canvas.value.width,canvas.value.height)
  try{
    const part=clonePart({...props.part,modelAlternatives:undefined,modelComparison:undefined}),{image,pixels}=await partPixels(part)
    const {buildPartModelAsync}=await import('../../modules/scene-lighting/part-model-async')
    const mesh=await buildPartModelAsync(part,pixels,controller.signal)
    if(controller.signal.aborted)return
    data={part,image,mesh};error.value='';draw()
  }catch(e){if(!controller.signal.aborted)error.value=String(e)}
},{immediate:true})
function draw(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;paint()})}
function paint(){
  if(!canvas.value||!data)return
  const rect=canvas.value.getBoundingClientRect();if(!rect.width||!rect.height)return
  // Bound diagnostic resolution while retaining every model triangle and alpha hole.
  const ratio=Math.min(1,900/Math.max(rect.width,rect.height)),w=Math.max(1,Math.round(rect.width*ratio)),h=Math.max(1,Math.round(rect.height*ratio))
  canvas.value.width=w;canvas.value.height=h
  const ctx=canvas.value.getContext('2d')!,{part,image,mesh}=data,bounds=imageBounds(part)
  const {project,topLeft:a,topRight:b,bottomLeft:c}=referenceProjection(props.state,part.id,w,h,bounds)
  const source=document.createElement('canvas');source.width=w;source.height=h
  const sc=source.getContext('2d')!
  sc.setTransform((b[0]-a[0])/image.width,(b[1]-a[1])/image.width,(c[0]-a[0])/image.height,(c[1]-a[1])/image.height,a[0],a[1]);sc.drawImage(image,0,0)

  const mask=document.createElement('canvas');mask.width=w;mask.height=h
  const mc=mask.getContext('2d')!;mc.fillStyle='#fff'
  for(const triangle of mesh.triangles){mc.beginPath();triangle.forEach((p,i)=>{const q=project(p);if(i===0)mc.moveTo(q[0],q[1]);else mc.lineTo(q[0],q[1])});mc.closePath();mc.fill()}
  const sourcePixels=sc.getImageData(0,0,w,h).data,modelPixels=mc.getImageData(0,0,w,h).data,out=mc.createImageData(w,h)
  out.data.set(alignmentColors(sourcePixels,modelPixels))
  for(let i=3;i<out.data.length;i+=4)if(out.data[i])out.data[i]=255
  mc.putImageData(out,0,0);ctx.drawImage(mask,0,0)
}
watch(()=>props.state,draw,{deep:true})
onMounted(()=>{observer=new ResizeObserver(draw);observer.observe(canvas.value!);draw()})
onUnmounted(()=>{observer?.disconnect();cancelAnimationFrame(frame)})
</script>
<template><div class="reference-overlay"><canvas ref="canvas"/><span v-if="showLegend!==false" class="legend">{{t('parts.alignmentLegend')}}</span><span v-if="error" class="legend" role="alert">{{error}}</span></div></template>
<style scoped>.reference-overlay{position:absolute;inset:0;pointer-events:none;background:#151b19}.reference-overlay canvas{width:100%;height:100%;display:block}.legend{position:absolute;bottom:48px;left:12px;padding:5px 8px;background:#16221ee8;color:#e4eee8;font-size:11px;border-radius:4px}</style>
