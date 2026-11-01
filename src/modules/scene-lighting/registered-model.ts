import type { PartAsset } from '../../shared/parts/schema'
import type { Mesh } from './model'
import { YAW } from './model'
import { cameraAxes } from './camera-registration'
import { cross, type Vec3 } from '../experiments/umbrella/math'
export function registrationBasis(pitch=20){const {right,up}=cameraAxes(pitch,YAW);return {right,up,forward:cross(up,right)}}
export function registeredModel(source:Mesh,part:PartAsset):Mesh{
 const r=part.model.registration! ,frame=part.imageFrame,basis=registrationBasis(r.pitch),angle=(YAW-r.yaw)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),scale=r.scale*frame.height/r.height
 const rotate=(p:Vec3):Vec3=>[c*p[0]+s*p[2],p[1],-s*p[0]+c*p[2]]
 let minimum=Infinity;for(let i=1;i<source.vertices.length;i+=9)minimum=Math.min(minimum,source.vertices[i]*scale)
 const tx=frame.left+r.offset[0]*frame.height/r.height,ty=frame.bottom+(r.height-r.offset[1])*frame.height/r.height
 const shift=basis.right.map((v,i)=>v*tx+basis.up[i]*ty) as Vec3
 const depth=-(minimum+shift[1])/basis.forward[1];for(let i=0;i<3;i++)shift[i]+=depth*basis.forward[i]
 const point=(p:Vec3)=>rotate(p).map((v,i)=>v*scale+shift[i]) as Vec3
 const vertices=source.vertices.slice()
 for(let i=0;i<vertices.length;i+=9){vertices.set(point(Array.from(source.vertices.subarray(i,i+3)) as Vec3),i);vertices.set(rotate(Array.from(source.vertices.subarray(i+3,i+6)) as Vec3),i+3)}
 return {vertices,triangles:source.triangles.map(t=>t.map(point))}
}
