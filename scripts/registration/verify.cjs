const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f)
const {fitCameraSilhouette,fitCameraLandmarks,cameraAxes,boundsFrame,renderMask,project}=require('../../src/modules/experiments/registration/camera-registration.ts')
const {findOrientation,rotationMatrix,silhouetteIoU}=require('../../src/modules/scene-lighting/orientation-fit.ts')
const {RIGHT,UP}=require('../../src/modules/scene-lighting/model.ts')
const {cases,reference}=require('./fixtures.cjs')
const folder=path.resolve(process.argv[2]||'output/registration-validation-20261031');fs.mkdirSync(folder,{recursive:true})
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),aboveOnly=process.argv.includes('--above-only'),report=aboveOnly?JSON.parse(fs.readFileSync(path.join(folder,'report.json'),'utf8')):{version:1,assumptions:'fixed mesh/up axis, orthographic, zero camera roll; oracle correspondences supplied by synthetic ground truth, NOT automatic matching',runs:[]}
const rms=(landmarks,frame)=>Math.sqrt(landmarks.reduce((s,l)=>{const p=project(l.point,frame);return s+(p[0]-l.pixel[0])**2+(p[1]-l.pixel[1])**2},0)/landmarks.length)
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
const viewError=(a,b)=>{const A=[a.right,a.up,cross(a.right,a.up)],B=[b.right,b.up,cross(b.right,b.up)],trace=A.reduce((s,row,i)=>s+row.reduce((t,v,j)=>t+v*B[i][j],0),0);return Math.acos(Math.max(-1,Math.min(1,(trace-1)/2)))*180/Math.PI}
function run(c){
 const start=performance.now(),hash=sha(c.positions),target=c.target??reference(c.targetPositions??c.positions,c.pitch,c.yaw,c.options),pixels=target.pixels
 // Training correspondences and independent validation landmarks are disjoint.
 const train=target.landmarks?.filter((_,i)=>i%3===0),heldout=target.landmarks?.filter((_,i)=>i%3!==0)
 if(aboveOnly){
  const existing=report.runs.find(r=>r.id===c.id);assert.equal(existing.sourceHash,hash)
  const value=fitCameraSilhouette(c.positions,pixels,{pitchRange:[0,85]}),rendered=renderMask(c.positions,value.frame,pixels.width,pixels.height),mask=target.mask??Uint8Array.from({length:pixels.width*pixels.height},(_,i)=>+(pixels.data[i*4+3]>=21))
  existing.methods.cameraAbove={...value,iou:silhouetteIoU(mask,rendered),heldoutRMSE:heldout&&c.assumption!=='shape-mismatch'?rms(heldout,value.frame):null,indexedViewErrorDegrees:c.pitch===undefined?null:viewError(value.frame,cameraAxes(c.pitch,c.yaw))}
  existing.rotationalSymmetry=c.kind==='symmetric';delete existing.continuousYawSymmetry
  fs.writeFileSync(path.join(folder,`${c.id}-cameraAbove.mask`),rendered);fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({id:c.id,above:existing.methods.cameraAbove.iou,pitch:value.pitch,rms:existing.methods.cameraAbove.heldoutRMSE}));return
 }
 const camera=fitCameraSilhouette(c.positions,pixels);console.log(c.id+': camera complete')
 const legacy=findOrientation(c.positions,pixels),m=rotationMatrix(legacy.rotation)
 const axis=a=>[0,1,2].map(i=>a[0]*m[i]+a[1]*m[3+i]+a[2]*m[6+i])
 const legacyFrame=boundsFrame(c.positions,pixels,{right:axis(RIGHT),up:axis(UP)},legacy.projection)
 const methods={initial:{frame:boundsFrame(c.positions,pixels,cameraAxes(20,25))},legacy:{frame:legacyFrame,rotation:legacy.rotation,internalIoU:legacy.score},camera,cameraAbove:fitCameraSilhouette(c.positions,pixels,{pitchRange:[0,85]})}
 if(train?.length>=4&&c.assumption!=='shape-mismatch')methods.oracle=fitCameraLandmarks(train)
 const result={id:c.id,assumption:c.assumption,rotationalSymmetry:c.kind==='symmetric',source:c.source??null,truth:c.pitch===undefined?null:{pitch:c.pitch,yaw:c.yaw,scale:target.scale,offset:target.offset},width:pixels.width,height:pixels.height,triangles:c.positions.length/9,sourceHash:hash,methods:{}}
 fs.writeFileSync(path.join(folder,c.id+'-target.rgba'),pixels.data)
 const mask=target.mask??Uint8Array.from({length:pixels.width*pixels.height},(_,i)=>+(pixels.data[i*4+3]>=21))
 for(const [name,value] of Object.entries(methods)){
  const rendered=renderMask(c.positions,value.frame,pixels.width,pixels.height)
  const measurements={iou:silhouetteIoU(mask,rendered),heldoutRMSE:heldout&&c.assumption!=='shape-mismatch'?rms(heldout,value.frame):null,indexedViewErrorDegrees:c.pitch===undefined?null:viewError(value.frame,cameraAxes(c.pitch,c.yaw))}
  result.methods[name]={...value,...measurements};fs.writeFileSync(path.join(folder,`${c.id}-${name}.mask`),rendered)
 }
 assert.equal(sha(c.positions),hash,'registration must not mutate geometry')
 if(c.assumption==='exact-orthographic')assert.ok(result.methods.oracle.heldoutRMSE<.1,`${c.id}: oracle reprojection failed`)
 result.elapsedMs=performance.now()-start;report.runs.push(result);fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify(report,null,2))
 console.log(JSON.stringify({id:c.id,seconds:Math.round(result.elapsedMs/1000),metrics:Object.fromEntries(Object.entries(result.methods).map(([k,v])=>[k,{iou:+v.iou.toFixed(3),rms:v.heldoutRMSE===null?null:+v.heldoutRMSE.toFixed(2)}]))}))
}
for(const c of cases())run(c)
// Real generated assets: no known source camera/correspondences, so never report pose accuracy.
if(!process.argv.includes('--synthetic-only')){
 const {decodeMesh,meshDataUri}=require('../../src/shared/parts/mesh.ts')
 const manifest=JSON.parse(fs.readFileSync('public/scene-lighting/models/manifest.json','utf8'))
 for(const id of ['umbrella','barrel','chair','bonsai']){
  const file=path.resolve(`public/scene-lighting/models/${id}.glb`),image=path.resolve(`public/scene-lighting/${id}.png`)
  if(!fs.existsSync(file)||!fs.existsSync(image))continue
  assert.equal(sha(fs.readFileSync(image)),manifest.find(entry=>entry.id===id)?.request.inputSha256,'real image must match recorded generation input')
  const bytes=fs.readFileSync(file),mesh=decodeMesh(meshDataUri(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength))),positions=new Float32Array(mesh.vertices.length/3)
  for(let i=0,j=0;i<mesh.vertices.length;i+=9,j+=3)positions.set(mesh.vertices.subarray(i,i+3),j)
  const rgba=path.join(folder,`real-${id}-input.rgba`),converted=spawnSync('python',['-c','from PIL import Image; import sys,json; im=Image.open(sys.argv[1]).convert("RGBA"); im.thumbnail((256,256)); open(sys.argv[2],"wb").write(im.tobytes()); print(json.dumps(im.size))',image,rgba],{encoding:'utf8'})
  if(converted.status)throw Error(converted.stderr)
  const [width,height]=JSON.parse(converted.stdout)
  run({id:`real-${id}`,positions,assumption:'real-no-ground-truth',source:{mesh:file,image,meshSha256:sha(bytes),imageSha256:sha(fs.readFileSync(image))},target:{pixels:{width,height,data:new Uint8ClampedArray(fs.readFileSync(rgba))}}})
 }
}
console.log('Report: '+path.join(folder,'report.json'))
