type Point = [number,number]
/** Slice a triangle soup parallel to the ground. Preserve separate components;
 * never substitute a convex hull (which would fill gaps between supports).
 * Non-manifold sections are rejected explicitly rather than emitting broken physics.
 */
export function groundSection(vertices:Float32Array,height:number,tolerance=1e-5):Point[][]{
  const points=new Map<string,Point>(),edges=new Map<string,Set<string>>()
  const key=(p:Point)=>`${Math.round(p[0]/tolerance)},${Math.round(p[1]/tolerance)}`
  for(let i=0;i<vertices.length;i+=27){
    const hits:Point[]=[]
    for(let e=0;e<3;e++){
      const a=i+e*9,b=i+(e+1)%3*9,ay=vertices[a+1]-height,by=vertices[b+1]-height
      if((ay<=0&&by>0)||(by<=0&&ay>0)){
        const t=ay/(ay-by);hits.push([vertices[a]+t*(vertices[b]-vertices[a]),vertices[a+2]+t*(vertices[b+2]-vertices[a+2])])
      }
    }
    if(hits.length!==2)continue
    const [a,b]=hits.map(key);if(a===b)continue
    points.set(a,hits[0]);points.set(b,hits[1])
    if(!edges.has(a))edges.set(a,new Set());if(!edges.has(b))edges.set(b,new Set())
    edges.get(a)!.add(b);edges.get(b)!.add(a)
  }
  if(!edges.size)throw Error('The ground section is empty')
  for(const adjacent of edges.values())if(adjacent.size!==2)throw Error('Ground section is open or non-manifold')
  const visited=new Set<string>(),loops:Point[][]=[]
  for(const start of edges.keys()){
    if(visited.has(start))continue
    const loop:Point[]=[];let current=start,previous=''
    do{
      if(visited.has(current))throw Error('Intersecting ground section')
      visited.add(current);loop.push(points.get(current)!)
      const next=[...edges.get(current)!].find(v=>v!==previous)!
      previous=current;current=next
    }while(current!==start)
    if(loop.length>=3)loops.push(loop)
  }
  return loops
}

/** Bounded local simplification; no disconnected components are merged. */
export function simplifyLoop(input:Point[],error:number):Point[]{
  const points=input.slice()
  let changed=true
  while(changed&&points.length>3){
    changed=false
    for(let i=0;i<points.length;i++){
      const a=points[(i+points.length-1)%points.length],b=points[i],c=points[(i+1)%points.length],dx=c[0]-a[0],dy=c[1]-a[1],length=dx*dx+dy*dy
      const t=length?((b[0]-a[0])*dx+(b[1]-a[1])*dy)/length:0
      if(t<0||t>1)continue
      if(Math.hypot(b[0]-a[0]-t*dx,b[1]-a[1]-t*dy)<=error){points.splice(i,1);changed=true;break}
    }
  }
  return points
}
