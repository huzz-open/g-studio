<script setup lang="ts">
import { ref, shallowRef, reactive, watch } from 'vue'
import { createPart, clonePart, type PartAsset, type PartModel } from '../parts/schema'
import { loadImage } from '../parts/images'
import { initializeComparison, originalVersion, optimizedVersion, fitModelComparison } from '../parts/model-comparison'
import { createPartPreview } from '../parts/preview-state'
import ModelReviewViewport from '../parts/ModelReviewViewport.vue'
import { readReview, saveReview } from '../parts/optimization-storage'
import { comparisonInputKey, repairKey } from '../../modules/scene-lighting/model-repair'
import InlineSwitch from '../components/InlineSwitch.vue'
import { useI18n } from '../i18n'
import { chooseModelVersion } from '../parts/model-comparison'
const props=defineProps<{uri:string;image:string;name:string;model:PartModel;sourcePart?:PartAsset;comparison?:PartAsset['modelComparison'];controlsTarget?:string}>()
const emit=defineEmits<{change:[PartAsset|undefined];busy:[boolean]}>()
const part=ref<PartAsset>(),state=shallowRef<ReturnType<typeof createPartPreview>>(),host=ref<HTMLElement>(),autoFit=ref(true),error=ref(''),busy=ref(false)
const {t}=useI18n(),review=ref<InstanceType<typeof ModelReviewViewport>>()
const drafts=new Map<string,PartAsset>()
watch(()=>[props.uri,props.image,props.sourcePart?.id,props.model.mesh?.modelId,props.model.mesh?.modelRevision,props.comparison],async(_,__,cleanup)=>{
  let current=true;cleanup(()=>{current=false});emit('change',undefined);part.value=undefined;error.value=''
  try{
    const image=await loadImage(props.image);if(!current)return
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.getContext('2d')!.drawImage(image,0,0)
    const imageUri=props.image.startsWith('data:')?props.image:canvas.toDataURL('image/png')
    const key=props.uri+'|'+props.image+'|'+(props.sourcePart?.id??'')+'|'+props.model.mesh?.modelId+'|'+props.model.mesh?.modelRevision
    const base=props.sourcePart?clonePart(props.sourcePart):createPart(props.name,{uri:imageUri,width:image.naturalWidth,height:image.naturalHeight},`review:${props.model.mesh!.sha256}`)
    base.image={uri:imageUri,width:image.naturalWidth,height:image.naturalHeight};base.version=2;base.model=clonePart(props.model);delete base.modelComparison
    const initialized=drafts.get(key)??initializeComparison(base)
    const source=props.sourcePart
    const fromAsset=source?.modelComparison&&source.modelComparison.source.mesh?.sha256===props.model.mesh?.sha256?clonePart(source.modelComparison):undefined
    if(fromAsset){
      fromAsset.inputKey=comparisonInputKey(initialized)
      if(fromAsset.candidate?.repair)fromAsset.candidate.repair.key=repairKey({...initialized,model:fromAsset.candidate})
    }
    const saved=fromAsset??(props.comparison?clonePart(props.comparison):await readReview(initialized));if(!current)return
    if(saved){saved.inputKey=comparisonInputKey(initialized);initialized.modelComparison=saved;chooseModelVersion(initialized,saved.selected)}
    part.value=initialized
    state.value=reactive(createPartPreview(part.value));state.value.mode='model';autoFit.value=true
    emit('change',part.value)
  }catch(e){if(current)error.value=String(e)}
},{immediate:true})
function update(value:PartAsset){part.value=value;drafts.set(props.uri+'|'+props.image+'|'+(props.sourcePart?.id??'')+'|'+props.model.mesh?.modelId+'|'+props.model.mesh?.modelRevision,value);emit('change',value);void saveReview(value).catch(e=>{error.value=String(e)})}
function fit(){
  if(!part.value||!state.value)return
  const rect=host.value?.getBoundingClientRect(),aspect=rect&&rect.height?rect.width/rect.height:1,candidate=optimizedVersion(part.value)
  fitModelComparison(state.value,originalVersion(part.value),candidate??originalVersion(part.value),aspect)
}
</script>
<template><div ref="host" class="generated-review">
  <Teleport :to="controlsTarget || 'body'" :disabled="!controlsTarget">
    <aside v-if="part" class="model-controls" :class="{ 'floating-controls': !controlsTarget }"><strong>{{name}}</strong><span v-if="busy" role="status">{{t('parts.aligning')}}</span><InlineSwitch v-else :model-value="part.modelComparison?.autoOptimize??true" :label="t('parts.useOptimized')" @update:model-value="review?.toggleOptimization($event)"/><p v-if="part.modelComparison?.optimizationError" role="alert">{{part.modelComparison.optimizationError}}</p></aside>
  </Teleport>
  <ModelReviewViewport ref="review" v-if="part&&state" model-only :model-value="part" :state="state" :auto-fit="autoFit" :fit-view="fit" @update:model-value="update" @interact="autoFit=false" @busy="busy=$event;emit('busy',$event)"/>
  <span v-if="error" role="alert">{{error}}</span>

</div></template>
<style scoped>.model-controls{box-sizing:border-box;width:100%;padding:16px 0;display:flex;flex-direction:column;gap:16px;color:#d6ded9;font-size:12px}.model-controls strong,.model-controls p{margin:0;overflow-wrap:anywhere}.floating-controls{position:absolute;top:12px;right:12px;z-index:9;width:200px;max-width:calc(100% - 24px);padding:12px;background:#242b28;border-radius:5px}.generated-review{position:relative;display:flex;flex:1;min-width:0;min-height:0;width:100%;height:100%}</style>
