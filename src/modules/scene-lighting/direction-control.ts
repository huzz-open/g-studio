import { RIGHT, UP, FORWARD, PITCH } from './model'
import { dot, normalize, type Vec3 } from '../experiments/umbrella/math'

export interface SunSphere { x:number; y:number; radius:number }
export function wrapAzimuth(degrees:number){return ((degrees+180)%360+360)%360-180}
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n))

// A directional light has no position or radius. Keep its transparent gizmo
// docked in the lower-left viewport margin, independent of scene zoom/placement.
export function sunSphereFrame(width:number,height:number):SunSphere {
  const margin=24,radius=Math.max(12,Math.min(92,(width-margin*2)/2,(height-margin*2)/2))
  return {radius,x:radius+margin,y:height-margin-Math.sin(PITCH*Math.PI/180)*radius}
}
export interface SunSpherePath {d:string;kind:'equator'|'latitude'|'meridian'|'direction'}
export function sunSphereGrid(frame:SunSphere,azimuth:number):SunSpherePath[]{
  const point=(a:number,e:number)=>spherePoint([Math.sin(a)*Math.cos(e),Math.sin(e),Math.cos(a)*Math.cos(e)],frame)
  const path=(points:{x:number;y:number}[])=>points.map((p,i)=>(i?'L':'M')+p.x.toFixed(2)+','+p.y.toFixed(2)).join(' ')
  const latitude=(e:number)=>path(Array.from({length:73},(_,i)=>point(i*Math.PI/36,e)))
  const meridian=(a:number)=>path(Array.from({length:37},(_,i)=>point(a,i*Math.PI/72)))
  return [{kind:'equator',d:latitude(0)},
    ...[30,60].map(e=>({kind:'latitude' as const,d:latitude(e*Math.PI/180)})),
    ...[0,60,120,180,240,300].map(a=>({kind:'meridian' as const,d:meridian(a*Math.PI/180)})),
    {kind:'direction',d:meridian(azimuth*Math.PI/180)}]
}
export function spherePoint(direction:Vec3,frame:SunSphere){
  return {x:frame.x+dot(direction,RIGHT)*frame.radius,y:frame.y-dot(direction,UP)*frame.radius}
}
export function directionAngles(direction:Vec3,previousAzimuth=0){
  return {azimuth:Math.hypot(direction[0],direction[2])<1e-8?previousAzimuth:wrapAzimuth(Math.atan2(direction[0],direction[2])*180/Math.PI),
    elevation:clamp(Math.asin(clamp(normalize(direction)[1],-1,1))*180/Math.PI,5,85)}
}
/** Orthographic pointer ray intersecting the sphere; keep the nearest branch. */
export function pickSunSphere(x:number,y:number,frame:SunSphere,previous:Vec3){
  let u=(x-frame.x)/frame.radius,v=(frame.y-y)/frame.radius
  const length=Math.hypot(u,v)
  if(length>1){u/=length;v/=length}
  const depth=Math.sqrt(Math.max(0,1-u*u-v*v))
  const candidates=[-1,1].map(sign=>RIGHT.map((r,i)=>r*u+UP[i]*v+FORWARD[i]*depth*sign) as Vec3)
  candidates.sort((a,b)=>dot(b,previous)-dot(a,previous))
  // Clamp elevation on the current branch; never jump to the far side merely
  // because the pointer has crossed the horizon. Use the equator for that turn.
  const direction=candidates[0]
  return directionAngles(direction,directionAngles(previous).azimuth)
}
/** The equator handle removes front/back ambiguity and covers all 360 degrees. */
export function pickSunAzimuth(x:number,y:number,frame:SunSphere,current:number){
  const u=(x-frame.x)/frame.radius,v=(frame.y-y)/frame.radius
  const det=RIGHT[0]*UP[2]-RIGHT[2]*UP[0]
  const dx=(u*UP[2]-RIGHT[2]*v)/det,dz=(RIGHT[0]*v-u*UP[0])/det
  return Math.hypot(dx,dz)<.1?current:wrapAzimuth(Math.atan2(dx,dz)*180/Math.PI)
}
