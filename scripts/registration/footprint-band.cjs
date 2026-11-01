// Raster union of near-ground cross sections; independent components and holes remain empty.
// Emit disjoint rectangles so Godot never fills an inner ring as a solid polygon.
exports.rasterFootprint=sections=>{
 const points=sections.flat(2),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),step=1,x0=Math.floor(Math.min(...xs)),y0=Math.floor(Math.min(...ys)),w=Math.ceil(Math.max(...xs))-x0+1,h=Math.ceil(Math.max(...ys))-y0+1;
 if(w*h>4000000)throw Error('Ground footprint exceeds raster budget');const mask=new Uint8Array(w*h);
 for(const loops of sections)for(let y=0;y<h;y++){
  const scan=y0+y+.5,hits=[];
  for(const poly of loops)for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];if((a[1]<=scan&&scan<b[1])||(b[1]<=scan&&scan<a[1]))hits.push(a[0]+(scan-a[1])*(b[0]-a[0])/(b[1]-a[1]))}
  hits.sort((a,b)=>a-b);for(let i=0;i+1<hits.length;i+=2)for(let x=Math.max(0,Math.floor(hits[i]-x0));x<Math.min(w,Math.ceil(hits[i+1]-x0));x++)mask[y*w+x]=1;
 }
 const boundary=new Map(),key=(x,y)=>`${x},${y}`;let ambiguous=false;
 const add=(a,b)=>{if(boundary.has(a))ambiguous=true;boundary.set(a,b)};
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(mask[y*w+x]){
  if(y===0||!mask[(y-1)*w+x])add(key(x,y),key(x+1,y));
  if(x===w-1||!mask[y*w+x+1])add(key(x+1,y),key(x+1,y+1));
  if(y===h-1||!mask[(y+1)*w+x])add(key(x+1,y+1),key(x,y+1));
  if(x===0||!mask[y*w+x-1])add(key(x,y+1),key(x,y));
 }
 if(!ambiguous){
  const rings=[],visited=new Set();for(const start of boundary.keys()){if(visited.has(start))continue;let current=start;const ring=[];do{if(visited.has(current)||!boundary.has(current)){ambiguous=true;break}visited.add(current);const [x,y]=current.split(',').map(Number);ring.push([x0+x,y0+y]);current=boundary.get(current)}while(current!==start);if(ambiguous)break;rings.push(ring)}
  const inside=(p,poly)=>{let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes}return yes};
  const holes=rings.some((ring,i)=>rings.some((outer,j)=>i!==j&&inside(ring[0],outer)));
  if(!ambiguous&&!holes){const {simplifyLoop}=require('../../src/shared/godot/ground-footprint.ts');return rings.map(r=>simplifyLoop(r,.65))}
 }
 const polygons=[];
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){if(!mask[y*w+x])continue;let X=x+1;while(X<w&&mask[y*w+X])X++;let Y=y+1;outer:while(Y<h){for(let i=x;i<X;i++)if(!mask[Y*w+i])break outer;Y++}for(let j=y;j<Y;j++)mask.fill(0,j*w+x,j*w+X);polygons.push([[x0+x,y0+y],[x0+X,y0+y],[x0+X,y0+Y],[x0+x,y0+Y]])}
 if(!polygons.length)throw Error('No ground occupancy');if(polygons.length>512)throw Error('Ground footprint requires too many shapes');return polygons;
}
