const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename)
const {buildItem,meshBuilder,RIGHT,UP}=require('../src/modules/scene-lighting/model.ts')
const {findOrientation,rasterizeProjection,imageSilhouette,silhouetteIoU,rotateMesh}=require('../src/modules/scene-lighting/orientation-fit.ts')
const {dot,cross,sub,normalize}=require('../src/modules/experiments/umbrella/math.ts')
const {createBuiltinParts}=require('../src/shared/parts/builtins.ts')
const {alignPartGeometry,buildPartGeometry,meshExtents}=require('../src/modules/scene-lighting/part-geometry.ts')
const {visiblePixelBounds,fitMeshProjection}=require('../src/modules/scene-lighting/image-fit.ts')
const {nelderMead}=require('../src/shared/utils/nelder-mead.ts')
const {contourField,symmetricChamfer}=require('../src/modules/scene-lighting/contour-distance.ts')
const {validatePart,clonePart}=require('../src/shared/parts/schema.ts')
const positions=mesh=>{const data=new Float32Array(mesh.vertices.length/3);for(let i=0,j=0;i<mesh.vertices.length;i+=9,j+=3)data.set(mesh.vertices.subarray(i,i+3),j);return data}
// Independent barycentric rasterizer, with padding, to generate known-view inputs.
function referenceImage(mesh,angle,size=192){
 const rotated=rotateMesh(mesh,angle),points=[];let left=Infinity,right=-Infinity,top=-Infinity,bottom=Infinity
 for(let i=0;i<rotated.vertices.length;i+=9){const p=Array.from(rotated.vertices.subarray(i,i+3)),x=dot(p,RIGHT),y=dot(p,UP);points.push([x,y]);left=Math.min(left,x);right=Math.max(right,x);bottom=Math.min(bottom,y);top=Math.max(top,y)}
 const pad=12,scale=size/Math.max(right-left,top-bottom),width=Math.ceil((right-left)*scale)+pad*2,height=Math.ceil((top-bottom)*scale)+pad*2,data=new Uint8ClampedArray(width*height*4)
 const screen=points.map(([x,y])=>[pad+(x-left)*scale,pad+(top-y)*scale])
 const edge=(a,b,x,y)=>(b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0])
 for(let i=0;i<screen.length;i+=3){const [a,b,c]=screen.slice(i,i+3);if(Math.abs(edge(a,b,...c))<1e-8)continue
  for(let y=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1])));y<Math.min(height,Math.ceil(Math.max(a[1],b[1],c[1])));y++)for(let x=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0])));x<Math.min(width,Math.ceil(Math.max(a[0],b[0],c[0])));x++){
   const e=[edge(a,b,x+.5,y+.5),edge(b,c,x+.5,y+.5),edge(c,a,x+.5,y+.5)]
   if(e.every(v=>v>=-1e-7)||e.every(v=>v<=1e-7))data[(y*width+x)*4+3]=255
  }
 }
 return {width,height,data}
}
test('known asymmetric chair pose improves overlap, including internal holes, deterministically',()=>{
 const mesh=buildItem('chair'),source=positions(mesh),image=referenceImage(mesh,[12,65,-8]),before=source.slice(),progress=[]
 const result=findOrientation(source,image,[0,0,0],p=>progress.push(p))
 console.log('chair pose',result)
 assert.ok(result.score>result.initialScore+.12);assert.ok(result.score>.9)
 assert.deepEqual(findOrientation(source,image),result);assert.deepEqual(source,before)
 assert.equal(progress.at(-1),100);assert.ok(progress.every((v,i)=>!i||v>=progress[i-1]))
 const target=imageSilhouette(image,160,.125);assert.ok(target.some(v=>v===0));assert.ok(target.some(v=>v===1))
 const bounds=visiblePixelBounds(image),aspect=bounds.width*image.width/(bounds.height*image.height)
 assert.equal(result.score,silhouetteIoU(rasterizeProjection(source,result.rotation,160,{aspect,projection:result.projection,margin:.125}),target))
})
test('already matching pose is retained and empty images fail',()=>{
 const mesh=buildItem('chair'),initial=[0,45,0],image=referenceImage(mesh,initial,256)
 const result=findOrientation(positions(mesh),image,initial);assert.ok(result.score>=result.initialScore);assert.ok(result.score-result.initialScore<.02)
 assert.throws(()=>findOrientation(positions(mesh),{width:1,height:1,data:new Uint8ClampedArray(4)}))
})
test('rotation and registration transform shaded vertices, shadow triangles and normals together',()=>{
 const part=createBuiltinParts().find(p=>p.id==='example:chair'),image=referenceImage(buildItem('chair'),[10,60,5]);alignPartGeometry(part,image)
 part.geometry.imageFit.rotation=[10,60,5];const mesh=buildPartGeometry(part,image)
 assert.ok(Math.abs(meshExtents(mesh).min[1])<1e-5)
 mesh.triangles.forEach((tri,t)=>{tri.forEach((p,i)=>p.forEach((v,j)=>assert.ok(Math.abs(v-mesh.vertices[t*27+i*9+j])<1e-5)));const n=normalize(cross(sub(tri[1],tri[0]),sub(tri[2],tri[0])));for(let j=0;j<3;j++)assert.ok(Math.abs(n[j]-mesh.vertices[t*27+3+j])<1e-4)})
 const saved=clonePart(part);validatePart(saved);assert.deepEqual(saved.geometry.imageFit.rotation,[10,60,5]);assert.deepEqual(buildPartGeometry(saved,image).vertices,mesh.vertices)
 for(const mutation of [p=>p.geometry.imageFit.rotation=[0,NaN,0],p=>p.geometry.imageFit.rotation=[0,181,0],p=>p.geometry.imageFit.orientation={rotation:[0,0,0],score:2,initialScore:0,meshSha256:'a'.repeat(64)}]){const bad=clonePart(part);mutation(bad);assert.throws(()=>validatePart(bad))}
})
test('triangle rasterization preserves an actual opening instead of filling the bounding box',()=>{
 const b=meshBuilder();b.box(-1,0,0,.2,2,.1,[1,1,1]);b.box(1,0,0,.2,2,.1,[1,1,1]);b.box(0,1.8,0,2,.2,.1,[1,1,1])
 const mask=rasterizeProjection(positions(b.build()),[0,25,0],64)
 assert.equal(mask[32*64+32],0);assert.ok(mask.reduce((s,v)=>s+v,0)>100)
})

test('standard Nelder-Mead minimizes a coupled quadratic independently of mesh fitting',()=>{
 const f=([x,y,z])=>(x+2*y-3)**2+(y-z+2)**2+(z-4)**2
 const result=nelderMead(f,[10,-8,1],[1,1,1],300)
 assert.ok(result.loss<1e-4);assert.ok(Math.abs(result.x[0]+1)<.02);assert.ok(Math.abs(result.x[1]-2)<.02);assert.ok(Math.abs(result.x[2]-4)<.02)
})
test('Chamfer distance is symmetric and includes hole edges',()=>{
 const a=new Uint8Array(32*32),b=new Uint8Array(32*32)
 for(let y=4;y<28;y++)for(let x=4;x<28;x++){a[y*32+x]=1;b[y*32+x]=1}
 for(let y=12;y<20;y++)for(let x=12;x<20;x++)b[y*32+x]=0
 const A=contourField(a,32),B=contourField(b,32)
 assert.equal(symmetricChamfer(A,A),0);assert.ok(symmetricChamfer(A,B)>0);assert.equal(symmetricChamfer(A,B),symmetricChamfer(B,A))
})
test('similarity size fit preserves pairwise distances in all three axes',()=>{
 const b=meshBuilder();b.box(0,0,0,1,2,3,[1,1,1]);const mesh=b.build(),fit=fitMeshProjection(mesh,[.4,.3,4,1],[1,1,1],true,[.1,.05,-.02])
 let ratio
 for(let i=9;i<mesh.vertices.length;i+=9){const distance=(m)=>Math.hypot(...[0,1,2].map(j=>m.vertices[i+j]-m.vertices[j]));const a=distance(mesh),c=distance(fit);if(a<1e-8)continue;if(ratio===undefined)ratio=c/a;assert.ok(Math.abs(c/a-ratio)<1e-5)}
})
test('one algorithm handles sideways, upside-down, branched and rotationally symmetric structures',()=>{
 for(const [id,pose] of [['chair',[72,113,88]],['bonsai',[-35,-96,145]],['umbrella',[160,23,-78]],['barrel',[0,72,0]],['vase',[65,-50,95]]]){
  const mesh=buildItem(id),input=referenceImage(mesh,pose,256),result=findOrientation(positions(mesh),input)
  console.log(id,result.initialScore.toFixed(3),result.score.toFixed(3),result.rotation)
  assert.ok(result.score>=result.initialScore);assert.ok(result.silhouetteCandidate.score>.85,`${id}: candidate ${result.silhouetteCandidate.score}`);assert.ok(result.surfaceRetention>=.65);if(result.score<.85)assert.equal(result.reviewRequired,true)
 }
})

test('unlabelled composite geometry uses the same fit and is invariant to source units and translation',()=>{
 const b=meshBuilder();b.box(-.8,.1,.2,.3,2.4,.35,[1,1,1]);b.box(.4,.3,-.5,.4,1.3,.6,[1,1,1]);b.box(0,1.7,.3,2,.25,.8,[1,1,1]);b.box(.7,.1,.5,.25,.6,.2,[1,1,1])
 const mesh=b.build(),source=positions(mesh),input=referenceImage(mesh,[-55,125,110],256)
 const result=findOrientation(source,input);assert.ok(result.silhouetteCandidate.score>.85);assert.ok(result.surfaceRetention>=.65);assert.ok(result.score>=result.initialScore);if(result.score<.85)assert.equal(result.reviewRequired,true)
 const shifted=source.map((v,i)=>v*7+[8,-4,12][i%3]),same=findOrientation(shifted,input)
 assert.ok(Math.abs(same.score-result.score)<.015)
})

test('visibility prior rejects surface reversal without relying on object identity',()=>{
 const {visibleSurface,surfaceRetention}=require('../src/modules/scene-lighting/surface-visibility.ts')
 const {rotationMatrix}=require('../src/modules/scene-lighting/orientation-fit.ts')
 const b=meshBuilder();b.box(0,0,0,2,.1,2,[1,1,1]);const source=positions(b.build())
 const ref=visibleSurface(source,rotationMatrix([0,0,0]))
 assert.ok(surfaceRetention(ref,ref)>.999)
 assert.ok(surfaceRetention(ref,visibleSurface(source,rotationMatrix([180,0,0])))<.2)
 const shifted=source.map((v,i)=>v*4+[5,8,-3][i%3])
 assert.ok(surfaceRetention(ref,visibleSurface(shifted,rotationMatrix([0,0,0])))>.99)
})
test('migration removes obsolete automatic rotation but preserves manual edits and reference on repeated fits',()=>{
 const {orientationReference,ORIENTATION_METHOD}=require('../src/shared/parts/orientation-reference.ts')
 const g={kind:'mesh',mesh:{sha256:'a'},imageFit:{rotation:[-43,-24,26],orientation:{meshSha256:'a',method:'silhouette-similarity-v1',rotation:[-43,-24,26]}}}
 assert.deepEqual(orientationReference(g),[0,0,0])
 g.imageFit.rotation=[5,2,1];assert.deepEqual(orientationReference(g),[5,2,1])
 g.imageFit.orientation={...g.imageFit.orientation,method:ORIENTATION_METHOD,rotation:[5,2,1],referenceRotation:[0,0,0]}
 assert.deepEqual(orientationReference(g),[0,0,0]);g.mesh.sha256='new';assert.deepEqual(orientationReference(g),[0,0,0])
})
