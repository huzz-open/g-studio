/** Orthographic camera registration with immutable source geometry.
 * Assumptions: fixed source geometry/up axis, orthographic camera, zero camera roll.
 * Silhouette fitting estimates camera angles plus image scale/translation.
 * Correspondence fitting is an information-controlled reference, NOT an automatic matcher.
 */
import { nelderMead } from '../../shared/utils/nelder-mead'
import { visiblePixelBounds } from './image-fit'
import { imageSilhouette, silhouetteIoU, type Pixels } from './orientation-fit'
import { contourField, symmetricChamfer } from './contour-distance'
import type { Vec3 } from '../experiments/umbrella/math'

export interface Frame { right: Vec3; up: Vec3; scale: number; offset: [number, number] }
export interface Landmark { point: Vec3; pixel: [number, number] }
export const cameraAxes = (pitch: number, yaw: number) => {
  const p=pitch*Math.PI/180,y=yaw*Math.PI/180
  return {right:[Math.cos(y),0,-Math.sin(y)] as Vec3,up:[-Math.sin(p)*Math.sin(y),Math.cos(p),-Math.sin(p)*Math.cos(y)] as Vec3}
}
const dot=(a:ArrayLike<number>,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
export function project(point:ArrayLike<number>,frame:Frame):[number,number]{
  return [frame.offset[0]+frame.scale*dot(point,frame.right),frame.offset[1]-frame.scale*dot(point,frame.up)]
}
export function boundsFrame(positions:Float32Array,pixels:Pixels,axes:Pick<Frame,'right'|'up'>,correction:Vec3=[0,0,0]):Frame{
  let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity
  for(let i=0;i<positions.length;i+=3){const p=positions.subarray(i,i+3),x=dot(p,axes.right),y=dot(p,axes.up);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}
  const b=visiblePixelBounds(pixels),w=b.width*pixels.width,h=b.height*pixels.height
  const scale=Math.min(w/Math.max(1e-10,x1-x0),h/Math.max(1e-10,y1-y0))*Math.exp(correction[0])
  return {...axes,scale,offset:[(b.left+b.width*(.5+correction[1]))*pixels.width-scale*(x0+x1)/2,(1-b.bottom-b.height*(.5+correction[2]))*pixels.height+scale*(y0+y1)/2]}
}
/** Scan-line triangle union; test targets use a separate barycentric renderer. */
export function renderMask(positions:Float32Array,frame:Frame,width:number,height:number):Uint8Array{
  const mask=new Uint8Array(width*height)
  for(let i=0;i<positions.length;i+=9){
    const a=project(positions.subarray(i,i+3),frame),b=project(positions.subarray(i+3,i+6),frame),c=project(positions.subarray(i+6,i+9),frame),v=[a,b,c]
    for(let y=Math.max(0,Math.ceil(Math.min(a[1],b[1],c[1])-.5));y<=Math.min(height-1,Math.floor(Math.max(a[1],b[1],c[1])-.5));y++){
      let lo=Infinity,hi=-Infinity
      for(let j=0;j<3;j++){const p=v[j],q=v[(j+1)%3];if((p[1]<=y+.5&&y+.5<q[1])||(q[1]<=y+.5&&y+.5<p[1])){const x=p[0]+(y+.5-p[1])*(q[0]-p[0])/(q[1]-p[1]);lo=Math.min(lo,x);hi=Math.max(hi,x)}}
      const start=Math.max(0,Math.ceil(lo-.5)),end=Math.min(width-1,Math.floor(hi-.5));if(start<=end)mask.fill(1,y*width+start,y*width+end+1)
    }
  }
  return mask
}
function validate(positions:Float32Array){if(!positions.length||positions.length%9||!positions.every(Number.isFinite))throw Error('Finite triangle positions required')}
export function fitCameraSilhouette(positions:Float32Array,pixels:Pixels,options:{pitchRange?:[number,number];fixedPitch?:number}={},progress:(value:number)=>void=()=>{}){
  validate(positions)
  const [minimumPitch,maximumPitch]=options.pitchRange??[-85,85]
  if(!Number.isFinite(minimumPitch)||!Number.isFinite(maximumPitch)||minimumPitch < -85||maximumPitch>85||minimumPitch>=maximumPitch)throw Error('Invalid pitch range')
  if(options.fixedPitch!==undefined&&(!Number.isFinite(options.fixedPitch)||options.fixedPitch<minimumPitch||options.fixedPitch>maximumPitch))throw Error('Invalid fixed camera pitch')
  const b=visiblePixelBounds(pixels),margin=.125
  // Same loss and resolutions as the legacy fitter, but no visibility gate or model rotation.
  const evaluator=(size:number)=>{
    const target=imageSilhouette(pixels,size,margin),contour=contourField(target,size)
    return (x:number[])=>{
      if(x[0]<minimumPitch||x[0]>maximumPitch||Math.abs(x[2])>.4||Math.abs(x[3])>.25||Math.abs(x[4])>.25)return 10
      const full=boundsFrame(positions,pixels,cameraAxes(x[0],x[1]),x.slice(2) as Vec3)
      const sx=size*(1-2*margin)/(b.width*pixels.width),sy=size*(1-2*margin)/(b.height*pixels.height)
      // Render the normalized rectangle without assuming square source pixels.
      const normalized:Frame={right:full.right,up:full.up.map(v=>v*sy/sx) as Vec3,scale:full.scale*sx,offset:[margin*size+(full.offset[0]-b.left*pixels.width)*sx,margin*size+(full.offset[1]-(1-b.bottom-b.height)*pixels.height)*sy]}
      const mask=renderMask(positions,normalized,size,size),score=silhouetteIoU(mask,target)
      return .7*(1-score)+.3*symmetricChamfer(contourField(mask,size),contour)
    }
  }
  const coarse=evaluator(48),seeds:number[][]=[]
  const pitches=options.fixedPitch!==undefined?[options.fixedPitch]:options.pitchRange?Array.from({length:6},(_,i)=>minimumPitch+(maximumPitch-minimumPitch)*(i+.5)/6):[-70,-40,-10,20,50,80]
  for(const pitch of pitches)for(let yaw=-180;yaw<180;yaw+=30)seeds.push([pitch,yaw,0,0,0])
  const ranked=seeds.map((x,i)=>{progress(Math.round(30*i/seeds.length));return {x,loss:coarse(x)}}).sort((a,b)=>a.loss-b.loss)
  const distinct:typeof ranked=[]
  for(const c of ranked){if(distinct.every(s=>Math.abs(s.x[0]-c.x[0])+Math.abs(s.x[1]-c.x[1])>35))distinct.push(c);if(distinct.length===6)break}
  distinct.push({x:[options.fixedPitch??Math.max(minimumPitch,Math.min(maximumPitch,20)),25,0,0,0],loss:0})
  const medium=evaluator(80),fine=evaluator(160)
  const optimize=(loss:(x:number[])=>number,x:number[],steps:number[])=>{
    if(options.fixedPitch===undefined)return nelderMead(loss,x,steps,180)
    const fixed=options.fixedPitch,result=nelderMead(v=>loss([fixed,...v]),x.slice(1),steps.slice(1),180)
    return {...result,x:[fixed,...result.x]}
  }
  const candidates=distinct.map((s,i)=>{progress(30+Math.round(30*i/distinct.length));return optimize(medium,s.x,[7,9,.035,.02,.02])}).map((s,i)=>{progress(60+Math.round(39*i/distinct.length));return optimize(fine,s.x,[2,3,.015,.008,.008])}).sort((a,b)=>a.loss-b.loss)
  progress(100)
  const best=candidates[0],x=best.x
  return {pitch:x[0],yaw:((x[1]+180)%360+360)%360-180,loss:best.loss,frame:boundsFrame(positions,pixels,cameraAxes(x[0],x[1]),x.slice(2) as Vec3),hypotheses:candidates.map(c=>({pitch:c.x[0],yaw:c.x[1],loss:c.loss}))}
}
/** Variable projection: solve positive scale and translation analytically for each angle pair. */
export function fitCameraLandmarks(landmarks:Landmark[]){
  if(landmarks.length<4||landmarks.some(l=>![...l.point,...l.pixel].every(Number.isFinite)))throw Error('At least four finite correspondences required')
  function evaluate(pitch:number,yaw:number){
    const axes=cameraAxes(pitch,yaw),q=landmarks.map(l=>[dot(l.point,axes.right),-dot(l.point,axes.up)])
    const mean=(a:number[][])=>[0,1].map(j=>a.reduce((s,v)=>s+v[j],0)/a.length),mq=mean(q),mp=mean(landmarks.map(l=>l.pixel))
    let numerator=0,denominator=0
    q.forEach((p,i)=>{for(let j=0;j<2;j++){numerator+=(p[j]-mq[j])*(landmarks[i].pixel[j]-mp[j]);denominator+=(p[j]-mq[j])**2}})
    const scale=Math.max(1e-12,numerator/Math.max(1e-12,denominator)),frame:Frame={...axes,scale,offset:[mp[0]-scale*mq[0],mp[1]-scale*mq[1]]}
    const loss=landmarks.reduce((s,l)=>{const p=project(l.point,frame);return s+(p[0]-l.pixel[0])**2+(p[1]-l.pixel[1])**2},0)/landmarks.length
    return {loss,frame}
  }
  const candidates=[]
  for(const pitch of [-60,20,70])for(let yaw=-180;yaw<180;yaw+=60){const r=nelderMead(x=>Math.abs(x[0])>85?1e9:evaluate(x[0],x[1]).loss,[pitch,yaw],[8,12],300);candidates.push(r)}
  candidates.sort((a,b)=>a.loss-b.loss);const x=candidates[0].x
  return {pitch:x[0],yaw:((x[1]+180)%360+360)%360-180,...evaluate(x[0],x[1])}
}
