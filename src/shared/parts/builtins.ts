import { normalSettings } from '../types/normal-settings'
import { createPart, type PartAsset } from './schema'
import { DEFINITIONS } from '../../modules/scene-lighting/model'
import { meshExtents } from '../../modules/scene-lighting/part-model'
import { decodeMesh,meshDataUri } from './mesh'
import { initializeComparison,chooseModelVersion } from './model-comparison'
import { repairKey } from '../../modules/scene-lighting/model-repair'
import { clonePart,type PartModel } from './schema'
const models=new Map<string,PartModel>()
let optimized:Record<string,PartModel>={}
let loading:Promise<void>|undefined
export function loadBuiltinModels(){return loading??=(async()=>{
 const base=new URL('scene-lighting/models/',document.baseURI).href
 const [manifest,recipes]=await Promise.all([fetch(base+'manifest.json').then(r=>r.json()),fetch(base+'optimized.json').then(r=>r.json())])
 if(recipes.algorithmVersion!=='model-fit-v3')throw Error('Default model optimization version mismatch')
 optimized=recipes.models
 await Promise.all(manifest.map(async(record:any)=>{
  if(!optimized[record.id])throw Error('Bundled optimized model missing: '+record.id)
  const response=await fetch(base+record.id+'.glb');if(!response.ok)throw Error('Default model unavailable: '+record.id)
  const bytes=await response.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('')
  const output=record.result.outputs.find((o:any)=>o.mime==='model/gltf-binary')
  if(hash!==output.sha256)throw Error('Default model hash mismatch')
  const uri=meshDataUri(bytes),size=meshExtents(decodeMesh(uri)).size.map(v=>Math.max(.02,Math.min(8,v))) as [number,number,number]
  models.set(record.id,{id:'model:'+hash,kind:'mesh',original:true,frozen:true,size,mesh:{uri,sha256:hash,inputSha256:record.request.inputSha256,providerId:record.request.providerId,modelId:'builtin:'+record.id,modelRevision:1,warnings:record.result.warnings,generation:{seed:record.request.seed,targetFaces:record.request.targetFaces,parameters:record.request.parameters}}})
 }))
})().catch(e=>{loading=undefined;throw e})}

// Default image assets have stable library identities.
const builtinIds = new Set(DEFINITIONS.map(d => 'example:' + d.id))
export function isBuiltinPart(part: PartAsset) { return builtinIds.has(part.id) }

export function createBuiltinParts(): PartAsset[] {
  const names = ['油纸伞', '酒桶', '靠背椅', '青花瓷瓶', '木箱', '松树盆栽'], detail = [1.5, 3, 2, .6, 2, 3]
  return DEFINITIONS.map((d, i) => {
    let asset = createPart(names[i], { uri: `builtin:${d.id}`, width: d.width, height: d.height }, `example:${d.id}`)
    const model=models.get(d.id)
    if(model){asset.version=2;asset.model=clonePart(model)}
    asset.normal = normalSettings({ detailStrength: detail[i] })
    if(model&&optimized[d.id]){
      asset=initializeComparison(asset)
      const candidate={...clonePart(optimized[d.id]),mesh:clonePart(model.mesh!)}
      if(candidate.sourceModelId!==asset.modelComparison!.source.id)throw Error('Default model source mismatch')
      if(candidate.repair)candidate.repair.key=repairKey({...asset,model:candidate})
      asset.modelComparison!.autoOptimize=true;asset.modelComparison!.candidate=candidate;chooseModelVersion(asset,'optimized')
    }
    return asset
  })
}
