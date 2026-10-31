import { RIGHT, UP, type SceneState, type SpriteBounds } from '../../modules/scene-lighting/model'
import { sceneCamera } from '../../modules/scene-lighting/scene-camera'
import { transform, type Vec3 } from '../../modules/experiments/umbrella/math'

/** Use the same camera and instance transform as the model viewport. */
export function referenceProjection(state:SceneState,assetId:string,width:number,height:number,bounds:SpriteBounds){
  const item=state.items.find(i=>i.assetId===assetId),scale=item?.scale??1
  const matrix=sceneCamera(state,width/height).matrix
  const project=(p:Vec3):[number,number]=>{
    const c=transform(matrix,[p[0]*scale+(item?.x??0),p[1]*scale,p[2]*scale+(item?.z??0)])
    return [(c[0]/c[3]*.5+.5)*width,(.5-c[1]/c[3]*.5)*height]
  }
  const point=(x:number,y:number)=>project(RIGHT.map((v,i)=>v*x+UP[i]*y) as Vec3)
  return {project,topLeft:point(bounds.left,bounds.bottom+bounds.height),topRight:point(bounds.left+bounds.width,bounds.bottom+bounds.height),bottomLeft:point(bounds.left,bounds.bottom)}
}

/** Preserve transparent holes; classify union pixels instead of bounding boxes. */
export function alignmentColors(source:Uint8ClampedArray,model:Uint8ClampedArray){
  if(source.length!==model.length||source.length%4)throw new Error('Mismatched reference masks')
  const result=new Uint8ClampedArray(source.length)
  for(let i=0;i<result.length;i+=4){
    const image=source[i+3]!>=21,mesh=model[i+3]!>=128
    if(image||mesh)result.set(image&&mesh?[72,210,135,145]:mesh?[255,170,65,200]:[211,110,241,200],i)
  }
  return result
}
