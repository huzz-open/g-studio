// No built-in asset names or meshes. Deterministic procedural validation fixtures.
const {meshBuilder}=require('../../src/modules/scene-lighting/model.ts')
const white=[.8,.8,.8]
function shape(kind,seed=1){
 const b=meshBuilder();let n=seed;const random=()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/2**32}
 if(kind==='assembly')for(let i=0;i<7;i++)b.box(random()*2-1,random()*1.6,random()*1.4-.7,.15+random()*.65,.2+random()*1.3,.15+random()*.7,white)
 if(kind==='portal'){b.box(-.8,0,0,.2,2,.25,white);b.box(.8,0,0,.2,2,.25,white);b.box(0,1.8,0,1.8,.2,.25,white);b.box(.5,.2,.35,.2,.4,.5,white)}
 if(kind==='canopy'){b.lathe([[0,2.7],[1.2,2.1],[1.2,2.04],[0,2.64]],white);b.box(0,0,0,.065,2.65,.065,white);b.box(.3,.25,.2,.15,.1,.2,white)}
 if(kind==='symmetric')b.lathe([[0,0],[.6,0],[.6,1.5],[0,1.5]],white,48)
 if(kind==='sheet'){b.box(0,0,0,1.8,2,.025,white);b.box(.6,.1,.1,.2,.4,.2,white)}
 if(kind==='bridge'){for(const x of [-.9,.9])b.box(x,0,0,.25,1.7,1,white);b.box(0,1.7,0,2.1,.15,1,white);b.box(.65,1.85,.3,.25,.3,.2,white)}
 const m=b.build(),p=new Float32Array(m.vertices.length/3)
 for(let i=0,j=0;i<m.vertices.length;i+=9,j+=3)p.set(m.vertices.subarray(i,i+3),j)
 return p
}
// Independent projection equations and barycentric pixel coverage (not fitter renderer).
function reference(positions,pitch,yaw,{size=224,shift=[0,0],perspective=false,pixelated=false,occluded=false}={}){
 const p=pitch*Math.PI/180,y=yaw*Math.PI/180,sp=Math.sin(p),cp=Math.cos(p),sy=Math.sin(y),cy=Math.cos(y)
 const projected=[]
 for(let i=0;i<positions.length;i+=3){const X=positions[i],Y=positions[i+1],Z=positions[i+2],depth=sy*cp*X+sp*Y+cy*cp*Z,k=perspective?5/(5-depth):1;projected.push([(cy*X-sy*Z)*k,(-sp*sy*X+cp*Y-sp*cy*Z)*k])}
 let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity
 for(const [x,y] of projected){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y)}
 const scale=size*.72/Math.max(maxX-minX,maxY-minY),offset=[size/2-(minX+maxX)*scale/2+shift[0],size/2+(minY+maxY)*scale/2+shift[1]]
 const screen=projected.map(([x,y])=>[offset[0]+x*scale,offset[1]-y*scale]),mask=new Uint8Array(size*size)
 const edge=(a,b,x,y)=>(b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0])
 for(let i=0;i<screen.length;i+=3){const [a,b,c]=screen.slice(i,i+3);if(Math.abs(edge(a,b,...c))<1e-9)continue
  for(let y=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1])));y<Math.min(size,Math.ceil(Math.max(a[1],b[1],c[1])));y++)for(let x=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0])));x<Math.min(size,Math.ceil(Math.max(a[0],b[0],c[0])));x++){
   const a0=edge(a,b,x+.5,y+.5),a1=edge(b,c,x+.5,y+.5),a2=edge(c,a,x+.5,y+.5)
   if((a0>=0&&a1>=0&&a2>=0)||(a0<=0&&a1<=0&&a2<=0))mask[y*size+x]=1
  }
 }
 if(pixelated){const original=mask.slice();for(let y=0;y<size;y++)for(let x=0;x<size;x++)mask[y*size+x]=original[Math.min(size-1,Math.floor(y/4)*4+2)*size+Math.min(size-1,Math.floor(x/4)*4+2)]}
 if(occluded)for(let y=Math.floor(size*.58);y<size;y++)for(let x=0;x<Math.floor(size*.55);x++)mask[y*size+x]=0
 const data=new Uint8ClampedArray(size*size*4);mask.forEach((v,i)=>{data.set([160,190,220,v*255],i*4)})
 const unique=new Map();for(let i=0;i<positions.length;i+=3)unique.set(Array.from(positions.subarray(i,i+3)).join(','),{point:Array.from(positions.subarray(i,i+3)),pixel:screen[i/3]})
 return {pixels:{width:size,height:size,data},mask,landmarks:[...unique.values()],scale,offset}
}
function cases(){
 const specs=[['assembly',11,8,-55],['assembly',29,35,67],['assembly',47,60,125],['assembly',73,78,-110],['portal',1,20,25],['portal',1,50,-35],['canopy',1,12,25],['canopy',1,55,80],['symmetric',1,35,63],['sheet',1,25,10],['bridge',1,40,70],['assembly',91,-25,110]]
 const list=specs.map(([kind,seed,pitch,yaw],i)=>({id:`${kind}-${seed}-${pitch}`,kind,positions:shape(kind,seed),pitch,yaw,options:{shift:[i%2?13:-11,i%3?7:-9]},assumption:'exact-orthographic'}))
 for(const [id,options] of [['pixelated',{pixelated:true}],['occluded',{occluded:true}],['perspective',{perspective:true}]])list.push({id,kind:'assembly',positions:shape('assembly',131),pitch:45,yaw:55,options,assumption:id})
 const original=shape('assembly',151),distorted=original.map((v,i)=>i%3===1?v*1.25:v)
 list.push({id:'shape-mismatch',kind:'assembly',positions:distorted,targetPositions:original,pitch:35,yaw:45,options:{},assumption:'shape-mismatch'})
 return list
}
module.exports={shape,reference,cases}
