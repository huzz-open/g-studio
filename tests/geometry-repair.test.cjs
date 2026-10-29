const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f)
const {meshBuilder,RIGHT,UP,FORWARD,rayHit}=require('../src/modules/scene-lighting/model.ts')
const {repairGeometry,repairSpec,repairKey}=require('../src/modules/scene-lighting/geometry-repair.ts')
const {createPart,validatePart,clonePart}=require('../src/shared/parts/schema.ts')
let serial=0
const world=p=>RIGHT.map((v,j)=>v*p[0]+UP[j]*p[1]+FORWARD[j]*p[2])
function boxMesh(boxes){const b=meshBuilder();for(const box of boxes)b.box(...box,[1,1,1]);const m=b.build(),v=m.vertices.slice();for(let i=0;i<v.length;i+=9)for(const o of [0,3])v.set(world([...v.slice(i+o,i+o+3)]),i+o);return {vertices:v,triangles:m.triangles.map(t=>t.map(world))}}
function spec(hole=false){const w=100,h=100,runs=[];for(let y=0;y<h;y++){if(hole&&y>=45&&y<55)runs.push([y,0,45],[y,55,w]);else runs.push([y,0,w])}return {version:2,enabled:true,key:'test-'+serial++,width:w,height:h,bounds:[-.5,0,1,1],runs}}
const hit=(mesh,x,y)=>rayHit(world([x,y,-2]),world([x,y,2]),mesh.triangles)
test('clips excess geometry and preserves real alpha holes for both lighting and shadow triangles',()=>{
 const mesh=boxMesh([[0,-.2,0,1.4,1.4,.2]]),original=mesh.vertices.slice(),result=repairGeometry(mesh,spec(true))
 assert.ok(result.stats.clippedTriangles>0);assert.equal(hit(result.mesh,0,.5),null);assert.notEqual(hit(result.mesh,.2,.5),null);assert.equal(hit(result.mesh,.6,.5),null)
 assert.deepEqual(mesh.vertices,original);assert.ok(result.mesh.vertices.every(Number.isFinite))
 result.mesh.triangles.forEach((t,i)=>t.forEach((v,j)=>v.forEach((p,k)=>assert.ok(Math.abs(p-result.mesh.vertices[i*27+j*9+k])<1e-5))))
})
test('fills a small false opaque hole with front and back surfaces, without object-specific rules',()=>{
 const mesh=boxMesh([[-.26,0,0,.48,1,.2],[.26,0,0,.48,1,.2],[0,0,0,.04,.48,.21],[0,.52,0,.04,.48,.21]])
 assert.equal(hit(mesh,0,.5),null)
 const result=repairGeometry(mesh,spec())
 assert.ok(result.stats.filledComponents>0);assert.ok(result.stats.filledPixels>0);assert.notEqual(hit(result.mesh,0,.5),null)
 assert.notEqual(rayHit(world([0,.5,2]),world([0,.5,-2]),result.mesh.triangles),null)
})
test('large unsupported gaps are not invented',()=>{
 const mesh=boxMesh([[-.4,0,0,.2,1,.2],[.4,0,0,.2,1,.2]]),result=repairGeometry(mesh,spec())
 assert.equal(hit(result.mesh,0,.5),null);assert.ok(result.stats.skippedComponents>0)
})
test('a deep discontinuity is not bridged by interpolation',()=>{
 const mesh=boxMesh([[-.26,0,-.4,.48,1,.1],[.26,0,.4,.48,1,.1],[0,0,-.4,.04,.48,.11],[0,.52,.4,.04,.48,.11]])
 const result=repairGeometry(mesh,spec());assert.equal(result.stats.filledPixels,0);assert.ok(result.stats.rejected.some(r=>r.reason==='depth'))
})
test('repair metadata invalidates on alignment, authored size and mesh replacement',()=>{
 const p=createPart('generic',{uri:'data:image/png;base64,eA==',width:4,height:4});p.geometry.kind='mesh';p.geometry.mesh={sha256:'source'}
 const key=repairKey(p);p.name='renamed';assert.equal(repairKey(p),key)
 for(const mutate of [p=>p.geometry.size[0]*=2,p=>p.alignment.offset[0]=.1,p=>p.geometry.mesh.sha256='new',p=>p.image.uri='data:image/png;base64,bmV3']){const copy=clonePart(p);mutate(copy);assert.notEqual(repairKey(copy),key)}
 const pixels={width:4,height:4,data:new Uint8ClampedArray(64).fill(255)},r=repairSpec(p,pixels,[-.5,0,1,1]);assert.equal(r.width,4);assert.equal(r.runs.length,4)
 const invalid=createPart('invalid',{uri:'data:image/png;base64,eA==',width:4,height:4});invalid.geometry.repair=r;assert.throws(()=>validatePart(invalid))
})
test('native mask preserves a one-pixel transparent source hole',()=>{
 const p=createPart('unlabelled',{uri:'data:image/png;base64,eA==',width:1000,height:1}),data=new Uint8ClampedArray(4000).fill(255);data[2*4+3]=0
 const r=repairSpec(p,{width:1000,height:1,data},[0,0,1,1])
 assert.equal(r.width,1000);assert.ok(!r.runs.some(([,left,right])=>left<=2&&2<right))
})

test('winding intervals merge overlapping solids without creating side-light leaks',()=>{
 for(const depthScale of [.5,1,3]){
  const mesh=boxMesh([[0,0,-.15*depthScale,1.4,1,.7*depthScale],[0,0,.15*depthScale,1.4,1,.7*depthScale]])
  const repaired=repairGeometry(mesh,spec());assert.equal(repaired.stats.status,'repaired')
  // Support correction moves along the view ray: test the corrected depth.
  const z=repaired.stats.supportShift
  for(const y of [.25,.505,.75])assert.notEqual(rayHit(world([-2,y,z]),world([2,y,z]),repaired.mesh.triangles),null)
 }
})
test('native image mask retains both a one-pixel foreground rod and one-pixel hole',()=>{
 const p=createPart('unlabelled',{uri:'data:image/png;base64,eA==',width:1000,height:1000}),data=new Uint8ClampedArray(4000000)
 for(let y=0;y<1000;y++)data[(y*1000+500)*4+3]=255
 data[(500*1000+500)*4+3]=0
 const r=repairSpec(p,{width:1000,height:1000,data},[0,0,1,1]);assert.equal(r.runs.length,999);assert.ok(r.runs.every(([y,x,X])=>y!==500&&x===500&&X===501))
})
test('unsupported open surfaces retain the exact original mesh',()=>{
 const mesh=boxMesh([[0,0,0,1.4,1,.2]])
 mesh.vertices=mesh.vertices.slice(27);mesh.triangles=mesh.triangles.slice(1)
 const result=repairGeometry(mesh,spec());assert.equal(result.stats.status,'unsupported-topology');assert.equal(result.mesh,mesh);assert.ok(result.stats.topology.boundaryEdges>0)
})
test('support height and projection are preserved after a supported crop',()=>{
 const mesh=boxMesh([[0,-.2,0,1.4,1.4,.2]]),result=repairGeometry(mesh,spec());assert.equal(result.stats.status,'repaired')
 const minY=m=>{let y=Infinity;for(let i=1;i<m.vertices.length;i+=9)y=Math.min(y,m.vertices[i]);return y}
 assert.ok(Math.abs(minY(mesh)-minY(result.mesh))<1e-6)
})

test('solid-union caps preserve separated depth layers',()=>{
 const mesh=boxMesh([[0,-.2,-.4,1.4,1.4,.2],[0,-.2,.4,1.4,1.4,.2]]),r=repairGeometry(mesh,spec());assert.equal(r.stats.status,'repaired')
 for(const z of [-.4,.4])assert.notEqual(rayHit(world([-2,.5,z+r.stats.supportShift]),world([2,.5,z+r.stats.supportShift]),r.mesh.triangles),null)
 assert.equal(rayHit(world([-2,.5,r.stats.supportShift]),world([2,.5,r.stats.supportShift]),r.mesh.triangles),null)
})
test('repair is equivariant under unit changes and translation, including elevated support',()=>{
 const source=boxMesh([[0,-.2,-.15,1.4,1.4,.7],[0,-.2,.15,1.4,1.4,.7]])
 for(const scale of [.001,1,100]){
  const offset=[3*scale,2*scale,-scale],point=p=>p.map((v,j)=>v*scale+offset[j]),vertices=source.vertices.slice()
  for(let i=0;i<vertices.length;i+=9)vertices.set(point([...vertices.subarray(i,i+3)]),i)
  const mesh={vertices,triangles:source.triangles.map(t=>t.map(point))},r=spec();r.bounds=[-.5*scale+offset.reduce((s,v,i)=>s+v*RIGHT[i],0),offset.reduce((s,v,i)=>s+v*UP[i],0),scale,scale]
  const fixed=repairGeometry(mesh,r);assert.equal(fixed.stats.status,'repaired')
  const a=point(world([-2,.5,0])).map((v,j)=>v+FORWARD[j]*fixed.stats.supportShift),b=point(world([2,.5,0])).map((v,j)=>v+FORWARD[j]*fixed.stats.supportShift)
  assert.notEqual(rayHit(a,b,fixed.mesh.triangles),null)
  const minY=m=>{let y=Infinity;for(let i=1;i<m.vertices.length;i+=9)y=Math.min(y,m.vertices[i]);return y}
  assert.ok(Math.abs(minY(mesh)-minY(fixed.mesh))<scale*1e-5)
 }
})
test('native resolution over budget is rejected without destructive resampling',()=>{
 const p=createPart('unlabelled',{uri:'data:image/png;base64,eA==',width:1025,height:1025}),before=clonePart(p)
 assert.throws(()=>repairSpec(p,{width:1025,height:1025,data:new Uint8ClampedArray(1025*1025*4)},[0,0,1,1]),/pixel budget/);assert.deepEqual(p,before)
})

test('winding sweep is independent of tessellation duplicate hits and merges component overlaps',()=>{
 const {solidIntervals}=require('../src/modules/scene-lighting/solid-topology.ts')
 const events=[{z:0,delta:1,component:0},{z:0,delta:1,component:0},{z:1,delta:1,component:1},{z:2,delta:-1,component:0},{z:3,delta:-1,component:1}]
 assert.deepEqual(solidIntervals(events,1e-9),[0,3]);assert.equal(solidIntervals(events.slice(0,-1),1e-9),null)
})
