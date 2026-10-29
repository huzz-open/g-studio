import { clonePart, type PartAsset, type PartGeometry, type Triple } from './schema'
import { decodeMesh } from './mesh'
import { alignedBounds, buildPartGeometry, meshExtents } from '../../modules/scene-lighting/part-geometry'
import { comparisonInputKey } from '../../modules/scene-lighting/geometry-repair'
import { generatedModels,resolveModelGeometry } from '../generation/models'
import { RIGHT,UP,PITCH,YAW,type SceneState } from '../../modules/scene-lighting/model'
import { dot,type Vec3 } from '../../modules/experiments/umbrella/math'

/** Older explicitly saved geometry keeps its current appearance and selection. */
export function initializeComparison(part:PartAsset, fresh=false):PartAsset{
  if(part.geometry.kind!=='mesh'||part.modelComparison)return part
  const copy=clonePart(part),g=copy.geometry
  const native=meshExtents(decodeMesh(g.mesh!.uri)).size.map(v=>Math.max(.02,Math.min(8,v))) as Triple
  const height=copy.alignment.height??alignedBounds(copy,buildPartGeometry(copy,{width:0,height:0,data:new Uint8ClampedArray()})).height/copy.alignment.scale
  const source:PartGeometry={kind:'mesh',mesh:clonePart(g.mesh!),size:native,frozen:true,original:true}
  const modified=!fresh&&!!(g.imageFit||g.repair||g.size.some((v,i)=>Math.abs(v-native[i])>1e-6))
  copy.modelComparison={source,sourceAlignment:{...clonePart(copy.alignment),height},inputKey:comparisonInputKey(copy),selected:modified?'optimized':'original'}
  copy.alignment.height=height
  if(modified){g.frozen=true;copy.modelComparison.candidate=clonePart(g);copy.modelComparison.candidateAlignment=clonePart(copy.alignment)}
  else copy.geometry=clonePart(source)
  return copy
}
export function originalVersion(part:PartAsset):PartAsset{
  const c=part.modelComparison
  return c?{...part,geometry:c.source,alignment:c.sourceAlignment}:part
}
export function optimizedVersion(part:PartAsset):PartAsset|undefined{
  const c=part.modelComparison
  return c?.candidate&&c.candidateAlignment?{...part,geometry:c.candidate,alignment:c.candidateAlignment}:undefined
}
export function comparisonCurrent(part:PartAsset){
  const c=part.modelComparison;if(!c||c.inputKey!==comparisonInputKey(part))return false
  void generatedModels.size // Also invalidate when a legacy source gains an ID.
  const source=c.source.mesh!,latest=source.modelId?generatedModels.get(source.modelId)?.mesh:resolveModelGeometry({...c.source,frozen:undefined}).mesh
  return !latest||latest.sha256===source.sha256
}
export function candidateApplied(part:PartAsset){const candidate=optimizedVersion(part);return !!candidate&&part.modelComparison?.selected==='optimized'&&JSON.stringify(candidate.geometry)===JSON.stringify(part.geometry)&&JSON.stringify(candidate.alignment)===JSON.stringify(part.alignment)}
export function storeCandidate(part:PartAsset,processed:PartAsset){
  const c=part.modelComparison
  if(!c||!comparisonCurrent(part)||processed.geometry.mesh?.sha256!==c.source.mesh?.sha256)throw new Error('Optimization source changed')
  c.candidate=clonePart({...processed.geometry,frozen:true,original:undefined})
  c.candidateAlignment=clonePart(processed.alignment)
  // Deliberately leave active geometry, alignment and selected version alone.
}
export function chooseModelVersion(part:PartAsset,version:'original'|'optimized'){
  const c=part.modelComparison;if(!c)return
  if(version==='optimized'&&!comparisonCurrent(part))throw new Error('Optimization source changed')
  const chosen=version==='original'?originalVersion(part):optimizedVersion(part)
  if(!chosen)throw new Error('No optimization candidate')
  part.geometry=clonePart(chosen.geometry);part.alignment=clonePart(chosen.alignment);c.selected=version
}

/** One union frame for both versions. Never fit the two canvases independently. */
export function fitModelComparison(state:SceneState,left:PartAsset,right:PartAsset,aspect:number){
  state.inspectionYaw=YAW;state.inspectionPitch=PITCH
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity
  const item=state.items[0],offset:Vec3=[item?.x??0,0,item?.z??0],scale=item?.scale??1
  const include=(p:Vec3)=>{const x=dot(p,RIGHT),y=dot(p,UP);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y)}
  for(const part of [left,right]){
    const mesh=buildPartGeometry(part,{width:0,height:0,data:new Uint8ClampedArray()}),bounds=alignedBounds(part,mesh)
    for(let i=0;i<mesh.vertices.length;i+=9)include([mesh.vertices[i]*scale+offset[0],mesh.vertices[i+1]*scale,mesh.vertices[i+2]*scale+offset[2]])
    for(const x of [bounds.left,bounds.left+bounds.width])for(const y of [bounds.bottom,bounds.bottom+bounds.height])include(RIGHT.map((v,i)=>offset[i]+scale*(v*x+UP[i]*y)) as Vec3)
  }
  // Frame the two objects, not the light handle: the initial divider should
  // pass through the subject. Both sides still use the same unchanged light.
  const center:Vec3=[offset[0],1,offset[2]],dx=(minX+maxX)/2-dot(center,RIGHT),dy=(minY+maxY)/2-dot(center,UP)
  state.target=center.map((v,i)=>v+RIGHT[i]*dx+UP[i]*dy) as Vec3
  state.zoom=Math.max(4,Math.min(40,1.3*Math.max(maxY-minY,(maxX-minX)/Math.max(.1,aspect))/.8))
}
