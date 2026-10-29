import type { Mesh } from './model'

export interface SolidTopology { supported:boolean; boundaryEdges:number; nonManifoldEdges:number; inconsistentEdges:number; components:number; orientation:number; faceComponents:Int32Array }
/** Exact-position welding, followed by edge incidence/orientation checks.
 * No tolerance welding: tiny source holes must not silently disappear. */
export function analyzeSolid(source:Mesh):SolidTopology{
  const count=source.vertices.length/27,parent=Int32Array.from({length:count},(_,i)=>i),vertices=new Map<string,number>(),edges=new Map<string,{faces:number[];balance:number}>()
  const root=(i:number):number=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i]}return i}
  for(let f=0;f<count;f++){
    const ids:number[]=[]
    for(let j=0;j<3;j++){const i=f*27+j*9,key=Array.from(source.vertices.subarray(i,i+3)).join(',');if(!vertices.has(key))vertices.set(key,vertices.size);ids.push(vertices.get(key)!)}
    for(let j=0;j<3;j++){
      const a=ids[j],b=ids[(j+1)%3],key=`${Math.min(a,b)},${Math.max(a,b)}`,edge=edges.get(key)??{faces:[],balance:0}
      if(edge.faces.length)parent[root(f)]=root(edge.faces[0]);edge.faces.push(f);edge.balance+=a<b?1:-1;edges.set(key,edge)
    }
  }
  const labels=new Map<number,number>(),faceComponents=new Int32Array(count),volumes:number[]=[],origin=Array.from(source.vertices.subarray(0,3))
  for(let f=0;f<count;f++){
    const r=root(f);if(!labels.has(r)){labels.set(r,labels.size);volumes.push(0)}const c=labels.get(r)!;faceComponents[f]=c
    const a=Array.from(source.vertices.subarray(f*27,f*27+3)).map((v,i)=>v-origin[i]),b=Array.from(source.vertices.subarray(f*27+9,f*27+12)).map((v,i)=>v-origin[i]),d=Array.from(source.vertices.subarray(f*27+18,f*27+21)).map((v,i)=>v-origin[i])
    volumes[c]+=a[0]*(b[1]*d[2]-b[2]*d[1])+a[1]*(b[2]*d[0]-b[0]*d[2])+a[2]*(b[0]*d[1]-b[1]*d[0])
  }
  let boundaryEdges=0,nonManifoldEdges=0,inconsistentEdges=0
  for(const e of edges.values()){if(e.faces.length===1)boundaryEdges++;if(e.faces.length>2)nonManifoldEdges++;if(e.faces.length===2&&e.balance!==0)inconsistentEdges++}
  const orientation=Math.sign(volumes.reduce((a,b)=>Math.abs(b)>Math.abs(a)?b:a,0))
  // Mixed shell orientations may mean a cavity or corrupt input, not a union
  // of solids. Do not guess which interpretation the asset intended.
  return {supported:count>0&&!boundaryEdges&&!nonManifoldEdges&&!inconsistentEdges&&orientation!==0&&volumes.every(v=>Math.sign(v)===orientation),boundaryEdges,nonManifoldEdges,inconsistentEdges,components:labels.size,orientation,faceComponents}
}

export interface Crossing {z:number;delta:number;component:number}
/** Non-zero winding occupancy of consistently oriented component solids.
 * Coincident triangle-edge hits are deduplicated per component, not globally. */
export function solidIntervals(crossings:Crossing[],epsilon:number):number[]|null{
  const hits=[...crossings].sort((a,b)=>a.z-b.z),intervals:number[]=[]
  let winding=0
  for(let i=0;i<hits.length;){
    const z=hits[i].z,groups=new Map<number,Set<number>>()
    while(i<hits.length&&hits[i].z-z<=epsilon){const h=hits[i++],set=groups.get(h.component)??new Set();set.add(h.delta);groups.set(h.component,set)}
    let delta=0;for(const set of groups.values())if(set.size===1)delta+=[...set][0]
    const next=winding+delta
    if(next<0)return null
    if(winding===0&&next>0)intervals.push(z)
    if(winding>0&&next===0)intervals.push(z)
    winding=next
  }
  return winding===0?intervals:null
}
