import { RIGHT, UP, FORWARD, type Mesh } from './model'
import type { PartAsset } from '../../shared/parts/schema'
import { dot, cross, sub, normalize, type Vec3 } from '../experiments/umbrella/math'
import { analyzeSolid, solidIntervals, type Crossing, type SolidTopology } from './solid-topology'

export interface GeometryRepair {
  version: 1 | 2; key: string; width: number; height: number; enabled: boolean
  status?: 'repaired' | 'unsupported-topology' | 'unsupported-cut'
  bounds: [number, number, number, number]
  /** Disjoint foreground runs [row, first column, exclusive last column]. */
  runs: number[][]
}
export interface RepairStats { sourceTriangles: number; outputTriangles: number; clippedTriangles: number; filledPixels: number; filledComponents: number; skippedComponents: number; rejected: {size:number;reason:string;frontRange?:number;backRange?:number}[]; status?:GeometryRepair['status']; topology?:Omit<SolidTopology,'faceComponents'>; supportShift?:number }
const imageKeys=new Map<string,string>()
function imageKey(uri:string){
  const old=imageKeys.get(uri);if(old)return old
  let a=2166136261,b=5381
  for(let i=0;i<uri.length;i++){a=Math.imul(a^uri.charCodeAt(i),16777619);b=Math.imul(b,33)^uri.charCodeAt(i)}
  const key=`${uri.length}:${a>>>0}:${b>>>0}`;imageKeys.set(uri,key);while(imageKeys.size>32)imageKeys.delete(imageKeys.keys().next().value!)
  return key
}
/** Content fingerprint is a cache invalidator, not an integrity/security hash. */
export function repairKey(part: PartAsset) { return JSON.stringify([part.geometry.mesh?.sha256,part.geometry.size,part.geometry.imageFit,part.alignment,part.image.width,part.image.height,imageKey(part.image.uri)]) }
export function repairSpec(part: PartAsset, pixels: {width:number;height:number;data:Uint8ClampedArray}, bounds: GeometryRepair['bounds']): GeometryRepair {
  const width=pixels.width,height=pixels.height,runs:number[][]=[]
  // Preserve native foreground AND background detail. Exceeding the work budget
  // is an explicit failure, never permission to erode uncertain source pixels.
  if(width*height>1048576)throw new Error('Native-resolution repair exceeds the pixel budget; original geometry is retained')
  for(let y=0;y<height;y++){
    let start=-1
    for(let x=0;x<=width;x++){
      let visible=false
      if(x<width)visible=pixels.data[(y*width+x)*4+3]>=21
      if(visible&&start<0)start=x
      if(!visible&&start>=0){runs.push([y,start,x]);start=-1}
    }
  }
  if(!runs.length)throw new Error('Image has no visible pixels')
  return {version:2,key:repairKey(part),width,height,bounds,runs,enabled:true}
}
type Vertex = { p: Vec3; n: Vec3; c: Vec3; x: number; y: number; z: number }
const cache=new Map<string,{mesh:Mesh;stats:RepairStats}>()
const boundsCache=new Map<string,{min:Vec3;max:Vec3}>()
const cacheKey=(spec:GeometryRepair)=>JSON.stringify([spec.version,spec.key,spec.width,spec.height,spec.bounds,spec.runs])
export function cachedRepair(spec:GeometryRepair){return cache.get(cacheKey(spec))}
export function cachedRepairBounds(spec:GeometryRepair){return boundsCache.get(cacheKey(spec))}
export function cacheRepair(spec:GeometryRepair,result:{mesh:Mesh;stats:RepairStats}){
  const key=cacheKey(spec),min:Vec3=[Infinity,Infinity,Infinity],max:Vec3=[-Infinity,-Infinity,-Infinity]
  for(let i=0;i<result.mesh.vertices.length;i+=9)for(let j=0;j<3;j++){min[j]=Math.min(min[j],result.mesh.vertices[i+j]);max[j]=Math.max(max[j],result.mesh.vertices[i+j])}
  cache.set(key,result);boundsCache.set(key,{min,max})
  while(cache.size>6)cache.delete(cache.keys().next().value!)
  while(boundsCache.size>64)boundsCache.delete(boundsCache.keys().next().value!)
}

/** Image-extrusion clipping (Sutherland–Hodgman) plus bounded harmonic depth
 * completion. Original surfaces and layers survive except where alpha excludes
 * them. Only small, nearby, depth-consistent missing components receive caps. */
export function repairGeometry(source:Mesh,spec:GeometryRepair):{mesh:Mesh;stats:RepairStats}{
  const previous=cachedRepair(spec)
  if(previous)return previous
  if(spec.version!==2)throw new Error('Legacy repair must be recomputed from the source image')
  const {width:w,height:h,bounds:b}=spec,count=w*h,mask=new Uint8Array(count)
  const rows:number[][][]=Array.from({length:h},()=>[])
  for(const [y,left,right] of spec.runs){mask.fill(1,y*w+left,y*w+right);rows[y].push([left,right])}
  const front=new Float64Array(count).fill(Infinity),back=new Float64Array(count).fill(-Infinity)
  const vertices:Vertex[]=[],out:number[]=[],triangles:Vec3[][]=[],rowTriangles:number[][]=Array.from({length:h+1},()=>[])
  const stats:RepairStats={sourceTriangles:source.vertices.length/27,outputTriangles:0,clippedTriangles:0,filledPixels:0,filledComponents:0,skippedComponents:0,rejected:[]}
  const {faceComponents,...topology}=analyzeSolid(source);stats.topology=topology
  const unchanged=(status:GeometryRepair['status'])=>{
    stats.status=status;stats.outputTriangles=stats.sourceTriangles
    stats.clippedTriangles=0;stats.filledPixels=0;stats.filledComponents=0
    const result={mesh:source,stats};cacheRepair(spec,result);return result
  }
  if(!topology.supported)return unchanged('unsupported-topology')
  for(let i=0;i<source.vertices.length;i+=9){
    const p=Array.from(source.vertices.slice(i,i+3)) as Vec3
    vertices.push({p,n:Array.from(source.vertices.slice(i+3,i+6)) as Vec3,c:Array.from(source.vertices.slice(i+6,i+9)) as Vec3,x:(dot(p,RIGHT)-b[0])/b[2]*w,y:(1-(dot(p,UP)-b[1])/b[3])*h,z:dot(p,FORWARD)})
  }
  function emit(a:Vertex,d:Vertex,c:Vertex){
    if(Math.hypot(...cross(sub(d.p,a.p),sub(c.p,a.p)))===0)return
    triangles.push([a.p,d.p,c.p]);for(const v of [a,d,c])out.push(...v.p,...v.n,...v.c)
    if(triangles.length>250000)throw new Error('Repaired geometry exceeds triangle budget')
  }
  const mix=(a:Vertex,c:Vertex,t:number):Vertex=>({p:a.p.map((v,i)=>v+(c.p[i]-v)*t) as Vec3,n:normalize(a.n.map((v,i)=>v+(c.n[i]-v)*t) as Vec3),c:a.c.map((v,i)=>v+(c.c[i]-v)*t) as Vec3,x:a.x+(c.x-a.x)*t,y:a.y+(c.y-a.y)*t,z:a.z+(c.z-a.z)*t})
  function clip(poly:Vertex[],axis:'x'|'y',value:number,above:boolean){
    const result:Vertex[]=[]
    for(let i=0;i<poly.length;i++){
      const a=poly[i],c=poly[(i+1)%poly.length],ai=above?a[axis]>=value:a[axis]<=value,ci=above?c[axis]>=value:c[axis]<=value
      if(ai)result.push(a)
      if(ai!==ci)result.push(mix(a,c,(value-a[axis])/(c[axis]-a[axis])))
    }
    return result
  }
  // Integral mask avoids subdivision of triangles wholly within foreground.
  const integral=new Uint32Array((w+1)*(h+1))
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)integral[(y+1)*(w+1)+x+1]=mask[y*w+x]+integral[y*(w+1)+x+1]+integral[(y+1)*(w+1)+x]-integral[y*(w+1)+x]
  const area=(x:number,y:number,X:number,Y:number)=>integral[Y*(w+1)+X]-integral[y*(w+1)+X]-integral[Y*(w+1)+x]+integral[y*(w+1)+x]
  for(let i=0;i<vertices.length;i+=3){
    const tri=vertices.slice(i,i+3),[a,d,c]=tri,minX=Math.min(a.x,d.x,c.x),maxX=Math.max(a.x,d.x,c.x),minY=Math.min(a.y,d.y,c.y),maxY=Math.max(a.y,d.y,c.y)
    // A triangle can be edge-on to this camera yet still cast shadows from a
    // side light. Give zero-width projections a cell instead of dropping them.
    const x0=Math.max(0,Math.min(w-1,Math.floor(minX))),x1=Math.min(w,Math.max(x0+1,Math.ceil(maxX))),y0=Math.max(0,Math.min(h-1,Math.floor(minY))),y1=Math.min(h,Math.max(y0+1,Math.ceil(maxY)))
    const denom=(d.y-c.y)*(a.x-c.x)+(c.x-d.x)*(a.y-c.y)
    for(let y=Math.max(0,Math.floor(minY-1e-5));y<=Math.min(h,Math.ceil(maxY+1e-5));y++)rowTriangles[y].push(i)
    if(Math.abs(denom)>1e-10)for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
      const u=((d.y-c.y)*(x+.5-c.x)+(c.x-d.x)*(y+.5-c.y))/denom,v=((c.y-a.y)*(x+.5-c.x)+(a.x-c.x)*(y+.5-c.y))/denom,t=1-u-v
      if(u<0||v<0||t<0)continue
      const index=y*w+x,z=u*a.z+v*d.z+t*c.z;front[index]=Math.min(front[index],z);back[index]=Math.max(back[index],z)
    }
    if(x0>=x1||y0>=y1){stats.clippedTriangles++;continue}
    if(minX>=0&&maxX<=w&&minY>=0&&maxY<=h&&area(x0,y0,x1,y1)===(x1-x0)*(y1-y0)){emit(a,d,c);continue}
    stats.clippedTriangles++
    for(let y=y0;y<y1;y++)for(const [left,right] of rows[y]){
      if(right<minX||left>maxX)continue
      let poly=clip(tri,'y',y,true);poly=clip(poly,'y',y+1,false);poly=clip(poly,'x',left,true);poly=clip(poly,'x',right,false)
      for(let j=1;j+1<poly.length;j++)emit(poly[0],poly[j],poly[j+1])
    }
  }
  const seen=new Uint8Array(count),filled=new Uint8Array(count),foreground=mask.reduce((s,v)=>s+v,0)
  const neighbors=(i:number)=>{const x=i%w,y=Math.floor(i/w);return [x?i-1:-1,x+1<w?i+1:-1,y?i-w:-1,y+1<h?i+w:-1]}
  const distance=new Int32Array(count).fill(-1),queue:number[]=[]
  for(let i=0;i<count;i++)if(mask[i]&&Number.isFinite(front[i])){distance[i]=0;queue.push(i)}
  for(let k=0;k<queue.length;k++)for(const j of neighbors(queue[k]))if(j>=0&&mask[j]&&distance[j]<0){distance[j]=distance[queue[k]]+1;queue.push(j)}
  const maxDistance=Math.max(1,Math.ceil(Math.max(w,h)*.015))
  const depthSpan=(()=>{let lo=Infinity,hi=-Infinity;for(const v of vertices){lo=Math.min(lo,v.z);hi=Math.max(hi,v.z)}return Math.max(hi-lo,b[2],b[3])})()
  for(let seed=0;seed<count;seed++){
    if(seen[seed]||!mask[seed]||Number.isFinite(front[seed]))continue
    const component=[seed],rim=new Set<number>();seen[seed]=1;let open=false
    for(let q=0;q<component.length;q++)for(const j of neighbors(component[q])){
      if(j<0||!mask[j]){open=true;continue}
      if(Number.isFinite(front[j]))rim.add(j)
      else if(!seen[j]){seen[j]=1;component.push(j)}
    }
    const rimArray=[...rim]
    if(!rimArray.length||component.length>foreground*.02||component.some(i=>distance[i]<0||distance[i]>maxDistance)){
      stats.skippedComponents++;stats.rejected.push({size:component.length,reason:open?'unsupported-boundary':'unsupported-hole'});continue
    }
    const fs=rimArray.map(i=>front[i]),bs=rimArray.map(i=>back[i])
    if(Math.max(...fs)-Math.min(...fs)>depthSpan*.15||Math.max(...bs)-Math.min(...bs)>depthSpan*.15){stats.skippedComponents++;stats.rejected.push({size:component.length,reason:'depth',frontRange:(Math.max(...fs)-Math.min(...fs))/depthSpan,backRange:(Math.max(...bs)-Math.min(...bs))/depthSpan});continue}
    const meanF=fs.reduce((s,v)=>s+v,0)/fs.length,meanB=bs.reduce((s,v)=>s+v,0)/bs.length
    for(const i of component){front[i]=meanF;back[i]=meanB;filled[i]=1}
    // Discrete Laplace equation with measured boundary depths held fixed.
    for(let iteration=0;iteration<400;iteration++){
      let delta=0
      for(const i of component){const ns=neighbors(i).filter(j=>j>=0&&mask[j]&&Number.isFinite(front[j]));const f=ns.reduce((s,j)=>s+front[j],0)/ns.length,z=ns.reduce((s,j)=>s+back[j],0)/ns.length;delta=Math.max(delta,Math.abs(f-front[i]),Math.abs(z-back[i]));front[i]=f;back[i]=z}
      if(delta<depthSpan*1e-6)break
    }
    stats.filledComponents++;stats.filledPixels+=component.length
  }
  const world=(x:number,y:number,z:number):Vec3=>RIGHT.map((v,i)=>v*(b[0]+x/w*b[2])+UP[i]*(b[1]+(1-y/h)*b[3])+FORWARD[i]*z) as Vec3
  function patch(points:Vec3[],desired:Vec3){
    const n=normalize(cross(sub(points[1],points[0]),sub(points[2],points[0])))
    if(dot(n,desired)<0)points.reverse()
    const normal=normalize(cross(sub(points[1],points[0]),sub(points[2],points[0])))
    const vs=points.map(p=>({p,n:normal,c:[.28,.30,.24] as Vec3,x:0,y:0,z:0}))
    emit(vs[0],vs[1],vs[2]);emit(vs[0],vs[2],vs[3])
  }
  // Seal silhouette cuts with source ray intervals, retaining separate depth
  // layers instead of connecting nearest and farthest surfaces across air.
  const rayCache=new Map<string,number[]|null>()
  function ray(x:number,y:number){
    const key=x+','+y;if(rayCache.has(key))return rayCache.get(key)!
    const hits:Crossing[]=[]
    for(const i of rowTriangles[y]){
      const [a,d,c]=vertices.slice(i,i+3),denom=(d.y-c.y)*(a.x-c.x)+(c.x-d.x)*(a.y-c.y)
      // Float32 vertices can give an exactly grazing face a tiny projected
      // area. Normalize the parallel test by its 3D area and pixel scale;
      // otherwise its ill-conditioned barycentrics invent interior crossings.
      const area3=Math.hypot(...cross(sub(d.p,a.p),sub(c.p,a.p)))
      if(Math.abs(denom)<=area3*w*h/(b[2]*b[3])*1e-6)continue
      const u=((d.y-c.y)*(x-c.x)+(c.x-d.x)*(y-c.y))/denom,v=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/denom,t=1-u-v
      if(u>=-1e-6&&v>=-1e-6&&t>=-1e-6)hits.push({z:u*a.z+v*d.z+t*c.z,delta:-Math.sign(denom)*topology.orientation,component:faceComponents[i/3]})
    }
    const intervals=solidIntervals(hits,depthSpan*1e-7);rayCache.set(key,intervals);return intervals
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(mask[y*w+x]){
    const edges:[number,number,number,number,Vec3,boolean][]=[
      [x,y,x,y+1,RIGHT.map(v=>-v) as Vec3,x===0||!mask[y*w+x-1]],
      [x+1,y,x+1,y+1,RIGHT,x+1===w||!mask[y*w+x+1]],
      [x,y,x+1,y,UP,y===0||!mask[(y-1)*w+x]],
      [x,y+1,x+1,y+1,UP.map(v=>-v) as Vec3,y+1===h||!mask[(y+1)*w+x]],
    ]
    for(const [X,Y,A,B,normal,boundary] of edges)if(boundary){
      const a=ray(X,Y),c=ray(A,B)
      if(!a||!c||a.length!==c.length){stats.rejected.push({size:0,reason:`ambiguous-cut ${JSON.stringify({X,Y,A,B,a,c})}`});return unchanged('unsupported-cut')}
      for(let j=0;j+1<a.length;j+=2)patch([world(X,Y,a[j]),world(A,B,c[j]),world(A,B,c[j+1]),world(X,Y,a[j+1])],normal)
    }
  }
  // One-cell overlap joins interpolated caps to the existing surface; it is
  // deliberately restricted to an already accepted small-gap neighborhood.
  const caps=new Set<number>()
  for(let i=0;i<count;i++)if(filled[i]){caps.add(i);for(const j of neighbors(i))if(j>=0&&mask[j])caps.add(j)}
  const corner=(x:number,y:number,field:Float64Array)=>{
    const samples:number[]=[]
    for(const dx of [-1,0])for(const dy of [-1,0]){const X=x+dx,Y=y+dy;if(X>=0&&X<w&&Y>=0&&Y<h&&mask[Y*w+X]&&Number.isFinite(field[Y*w+X]))samples.push(field[Y*w+X])}
    return samples.reduce((s,v)=>s+v,0)/samples.length
  }
  for(const i of caps){
    const x=i%w,y=Math.floor(i/w),corners=[[x,y],[x+1,y],[x+1,y+1],[x,y+1]],epsilon=depthSpan*1e-5
    patch(corners.map(([X,Y])=>world(X,Y,corner(X,Y,front)-epsilon)),FORWARD.map(v=>-v) as Vec3)
    patch(corners.map(([X,Y])=>world(X,Y,corner(X,Y,back)+epsilon)),FORWARD)
    if(filled[i]){
      const edges:[number,number,number,number,Vec3,boolean][]=[
        [x,y,x,y+1,RIGHT.map(v=>-v) as Vec3,x===0||!mask[y*w+x-1]],
        [x+1,y,x+1,y+1,RIGHT,x+1===w||!mask[y*w+x+1]],
        [x,y,x+1,y,UP,y===0||!mask[(y-1)*w+x]],
        [x,y+1,x+1,y+1,UP.map(v=>-v) as Vec3,y+1===h||!mask[(y+1)*w+x]],
      ]
      for(const [X,Y,A,B,normal,boundary] of edges)if(boundary)patch([world(X,Y,corner(X,Y,front)),world(A,B,corner(A,B,front)),world(A,B,corner(A,B,back)),world(X,Y,corner(X,Y,back))],normal)
    }
  }
  stats.outputTriangles=triangles.length
  if(!triangles.length)return unchanged('unsupported-cut')
  // Preserve the source support height, including deliberately elevated assets.
  // A translation along the viewing ray leaves the image projection unchanged.
  let sourceY=Infinity,resultY=Infinity
  for(let i=1;i<source.vertices.length;i+=9)sourceY=Math.min(sourceY,source.vertices[i])
  for(let i=1;i<out.length;i+=9)resultY=Math.min(resultY,out[i])
  const shift=(sourceY-resultY)/FORWARD[1];stats.supportShift=shift
  for(let i=0;i<out.length;i+=9)for(let j=0;j<3;j++)out[i+j]+=FORWARD[j]*shift
  // Some clipped faces share vertices; replace points instead of translating
  // shared references repeatedly.
  for(let i=0;i<triangles.length;i++)triangles[i]=triangles[i].map(p=>p.map((v,j)=>v+FORWARD[j]*shift) as Vec3)
  stats.status='repaired'
  const result={mesh:{vertices:new Float32Array(out),triangles},stats}
  cacheRepair(spec,result)
  return result
}
