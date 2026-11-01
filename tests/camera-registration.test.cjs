const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f)
const {cameraAxes,project,fitCameraLandmarks,fitCameraSilhouette,renderMask}=require('../src/modules/experiments/registration/camera-registration.ts')
const {shape,reference}=require('../scripts/registration/fixtures.cjs')
const {RIGHT,UP}=require('../src/modules/scene-lighting/model.ts')
test('default experimental camera agrees with the application coordinate convention',()=>{
 const axes=cameraAxes(20,25)
 for(let i=0;i<3;i++){assert.ok(Math.abs(axes.right[i]-RIGHT[i])<1e-12);assert.ok(Math.abs(axes.up[i]-UP[i])<1e-12)}
})
test('known 3D-2D correspondences recover unseen projected points across angles and image offsets',()=>{
 for(const [pitch,yaw] of [[8,-55],[35,67],[78,-110],[-25,110]]){
  const target=reference(shape('assembly',331),pitch,yaw,{shift:[17,-11]}),train=target.landmarks.filter((_,i)=>i%3===0),validation=target.landmarks.filter((_,i)=>i%3!==0),before=JSON.stringify(train)
  const result=fitCameraLandmarks(train)
  for(const l of validation){const p=project(l.point,result.frame);assert.ok(Math.hypot(p[0]-l.pixel[0],p[1]-l.pixel[1])<.15)}
  assert.equal(JSON.stringify(train),before)
 }
})
test('independent barycentric and scanline renderers agree for the same known camera',()=>{
 const positions=shape('portal'),target=reference(positions,35,60)
 const mask=renderMask(positions,{...cameraAxes(35,60),scale:target.scale,offset:target.offset},224,224)
 assert.deepEqual(mask,target.mask)
})
test('camera registration preserves all source coordinates and recovers an asymmetric test view',()=>{
 const positions=shape('assembly',227),before=positions.slice(),target=reference(positions,42,-151)
 const result=fitCameraSilhouette(positions,target.pixels)
 const mask=renderMask(positions,result.frame,224,224)
 const {silhouetteIoU}=require('../src/modules/scene-lighting/orientation-fit.ts')
 assert.ok(silhouetteIoU(mask,target.mask)>.95);assert.deepEqual(positions,before)
})
test('orthographic depth translation is unobservable in image coordinates',()=>{
 const axes=cameraAxes(35,60),frame={...axes,scale:100,offset:[80,90]},p=[1,2,3]
 const [r,u]=[axes.right,axes.up],depth=[r[1]*u[2]-r[2]*u[1],r[2]*u[0]-r[0]*u[2],r[0]*u[1]-r[1]*u[0]],q=p.map((v,i)=>v+depth[i]*7)
 const a=project(p,frame),b=project(q,frame)
 assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-10);assert.ok(Math.abs(q[1]-p[1])>1)
})
test('camera rotation and inverse relative model rotation have identical projections',()=>{
 const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
 const a=cameraAxes(20,25),b=cameraAxes(55,-70),A=[a.right,a.up,cross(a.right,a.up)],B=[b.right,b.up,cross(b.right,b.up)]
 // Q = A^T B. Changing camera basis to B is identical to applying Q to the model under A.
 const Q=Array.from({length:3},(_,i)=>Array.from({length:3},(_,j)=>A.reduce((s,row,k)=>s+row[i]*B[k][j],0)))
 for(const point of [[0,0,0],[1,2,3],[-2,.3,1]]){
  const moved=Q.map(row=>row.reduce((s,v,j)=>s+v*point[j],0)),left=project(moved,{...a,scale:40,offset:[20,60]}),right=project(point,{...b,scale:40,offset:[20,60]})
  assert.ok(Math.hypot(left[0]-right[0],left[1]-right[1])<1e-10)
 }
 assert.ok(Math.abs(Q[1][1]-1)>.1,'equivalent image does not preserve world up')
})
test('empty and nonfinite experimental inputs are rejected',()=>{
 assert.throws(()=>fitCameraSilhouette(new Float32Array(),{width:1,height:1,data:new Uint8ClampedArray(4)}))
 assert.throws(()=>fitCameraLandmarks([]))
 const positions=shape('portal'),target=reference(positions,35,60)
 assert.throws(()=>fitCameraSilhouette(positions,target.pixels,{pitchRange:[80,0]}))
})
