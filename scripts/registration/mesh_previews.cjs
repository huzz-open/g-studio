// Depth-tested geometry previews for real inputs; no renderer/optimizer image normalization.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f)
const {decodeMesh,meshDataUri}=require('../../src/shared/parts/mesh.ts')
const {project}=require('../../src/modules/experiments/registration/camera-registration.ts')
const folder=path.resolve(process.argv[2]||'output/registration-validation-20261031'),report=JSON.parse(fs.readFileSync(path.join(folder,'report.json'),'utf8'))
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i])
const edge=(a,b,x,y)=>(b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0])
for(const c of report.runs.filter(r=>r.source)){
 const bytes=fs.readFileSync(c.source.mesh),mesh=decodeMesh(meshDataUri(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)))
 for(const [name,{frame}] of Object.entries(c.methods)){
  const depth=new Float64Array(c.width*c.height).fill(-Infinity),rgba=new Uint8Array(c.width*c.height*4),toward=cross(frame.right,frame.up)
  for(let i=0;i<mesh.vertices.length;i+=27){
   const p=[0,9,18].map(j=>Array.from(mesh.vertices.subarray(i+j,i+j+3))),s=p.map(v=>project(v,frame)),z=p.map(v=>dot(v,toward)),area=edge(s[0],s[1],...s[2]);if(Math.abs(area)<1e-9)continue
   const n=cross(sub(p[1],p[0]),sub(p[2],p[0])),shade=Math.round(255*(.22+.65*Math.abs(dot(n,[.267,.802,.535]))/Math.max(1e-12,Math.hypot(...n))))
   for(let y=Math.max(0,Math.floor(Math.min(...s.map(v=>v[1]))));y<Math.min(c.height,Math.ceil(Math.max(...s.map(v=>v[1]))));y++)for(let x=Math.max(0,Math.floor(Math.min(...s.map(v=>v[0]))));x<Math.min(c.width,Math.ceil(Math.max(...s.map(v=>v[0]))));x++){
    const a=edge(s[1],s[2],x+.5,y+.5)/area,b=edge(s[2],s[0],x+.5,y+.5)/area,d=1-a-b;if(a<0||b<0||d<0)continue
    const index=y*c.width+x,Z=a*z[0]+b*z[1]+d*z[2];if(Z<=depth[index])continue
    depth[index]=Z;rgba.set([shade,shade,shade,255],index*4)
   }
  }
  fs.writeFileSync(path.join(folder,`${c.id}-${name}-mesh.rgba`),rgba)
 }
 console.log(c.id+': geometry previews rendered')
}
