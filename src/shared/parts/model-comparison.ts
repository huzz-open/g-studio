import { clonePart, type PartAsset, type PartModel, type Triple } from './schema'
import { decodeMesh } from './mesh'
import { imageBounds, buildPartModel, meshExtents } from '../../modules/scene-lighting/part-model'
import { comparisonInputKey } from '../../modules/scene-lighting/model-repair'
import { RIGHT,UP,PITCH,YAW,type SceneState } from '../../modules/scene-lighting/model'
import { dot,type Vec3 } from '../../modules/experiments/umbrella/math'

/** Initialize independent model versions against one shared image reference. */
export function initializeComparison(part:PartAsset):PartAsset{
  if(part.model.kind!=='mesh'||part.modelComparison)return part
  const copy=clonePart(part),g=copy.model
  const native=meshExtents(decodeMesh(g.mesh!.uri)).size.map(v=>Math.max(.02,Math.min(8,v))) as Triple
  const source:PartModel={kind:'mesh',mesh:clonePart(g.mesh!),size:native,frozen:true,original:true}
  source.id=`model:${g.mesh!.sha256}`
  copy.modelComparison={source,inputKey:comparisonInputKey(copy),selected:'original',autoOptimize:false}
  copy.model=clonePart(source)
  return copy
}
export function originalVersion(part:PartAsset):PartAsset{
  const c=part.modelComparison
  return c?{...part,model:c.source}:part
}
export function optimizedVersion(part:PartAsset):PartAsset|undefined{
  const c=part.modelComparison
  return c?.candidate?{...part,model:c.candidate}:undefined
}
export function comparisonCurrent(part:PartAsset){
  const c=part.modelComparison;if(!c||c.inputKey!==comparisonInputKey(part))return false
  return true // A pinned source remains valid when its generation task is replaced.
}
export function candidateApplied(part:PartAsset){const candidate=optimizedVersion(part);return !!candidate&&part.modelComparison?.selected==='optimized'&&JSON.stringify(candidate.model)===JSON.stringify(part.model)}
export function storeCandidate(part:PartAsset,processed:PartAsset){
  const c=part.modelComparison
  if(!c||!comparisonCurrent(part)||processed.model.mesh?.sha256!==c.source.mesh?.sha256||JSON.stringify(processed.imageFrame)!==JSON.stringify(part.imageFrame))throw new Error('Optimization source changed')
  c.candidate=clonePart({...processed.model,id:crypto.randomUUID(),sourceModelId:c.source.id,frozen:true,original:undefined})
  // Deliberately leave active model, image frame and selected version alone.
}
export function chooseModelVersion(part:PartAsset,version:'original'|'optimized'){
  const c=part.modelComparison;if(!c)return
  if(version==='optimized'&&!comparisonCurrent(part))throw new Error('Optimization source changed')
  const chosen=version==='original'?originalVersion(part):optimizedVersion(part)
  if(!chosen)throw new Error('No optimization candidate')
  part.model=clonePart(chosen.model);c.selected=version
}

/** One union frame for both versions. Never fit the two canvases independently. */
export function fitModelComparison(state:SceneState,left:PartAsset,right:PartAsset,aspect:number){
  state.inspectionYaw=YAW;state.inspectionPitch=PITCH
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity
  const item=state.items[0],offset:Vec3=[item?.x??0,0,item?.z??0],scale=item?.scale??1
  const include=(p:Vec3)=>{const x=dot(p,RIGHT),y=dot(p,UP);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y)}
  for(const part of [left,right]){
    const mesh=buildPartModel(part,{width:0,height:0,data:new Uint8ClampedArray()}),bounds=imageBounds(part)
    for(let i=0;i<mesh.vertices.length;i+=9)include([mesh.vertices[i]*scale+offset[0],mesh.vertices[i+1]*scale,mesh.vertices[i+2]*scale+offset[2]])
    for(const x of [bounds.left,bounds.left+bounds.width])for(const y of [bounds.bottom,bounds.bottom+bounds.height])include(RIGHT.map((v,i)=>offset[i]+scale*(v*x+UP[i]*y)) as Vec3)
  }
  // Frame the two objects, not the light handle: the initial divider should
  // pass through the subject. Both sides still use the same unchanged light.
  const center:Vec3=[offset[0],1,offset[2]],dx=(minX+maxX)/2-dot(center,RIGHT),dy=(minY+maxY)/2-dot(center,UP)
  state.target=center.map((v,i)=>v+RIGHT[i]*dx+UP[i]*dy) as Vec3
  state.zoom=Math.max(4,Math.min(40,1.3*Math.max(maxY-minY,(maxX-minX)/Math.max(.1,aspect))/.8))
}
