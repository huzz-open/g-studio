const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f)
const {referenceProjection,alignmentColors}=require('../src/shared/parts/reference-projection.ts')
const {createScene,RIGHT,UP}=require('../src/modules/scene-lighting/model.ts')
const {sceneCamera}=require('../src/modules/scene-lighting/scene-camera.ts')
const {transform}=require('../src/modules/experiments/umbrella/math.ts')
test('reference image corners share the model camera and instance transform through pan, zoom and orbit',()=>{
 const bounds={left:-.7,bottom:.2,width:1.6,height:2.4}
 for(const [yaw,pitch,zoom] of [[25,20,5],[70,-15,12],[-120,65,4]]){
  const state={...createScene(),mode:'model',inspectionYaw:yaw,inspectionPitch:pitch,zoom,target:[1,2,-1],items:[{assetId:'part',x:2,z:-3,scale:1.7}]}
  const projection=referenceProjection(state,'part',960,640,bounds)
  const world=(x,y)=>RIGHT.map((v,i)=>(v*x+UP[i]*y)*1.7+[2,0,-3][i])
  const screen=p=>{const c=transform(sceneCamera(state,1.5).matrix,p);return [(c[0]/c[3]*.5+.5)*960,(.5-c[1]/c[3]*.5)*640]}
  for(const [actual,x,y] of [[projection.topLeft,-.7,2.6],[projection.topRight,.9,2.6],[projection.bottomLeft,-.7,.2]]){
   const expected=screen(world(x,y));actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1e-9))
  }
 }
})
test('alignment colors preserve image holes and distinguish excess, missing and overlapping model',()=>{
 const pixels=alpha=>new Uint8ClampedArray(alpha.flatMap(a=>[255,255,255,a]))
 const colors=alignmentColors(pixels([255,0,255,0,20,21]),pixels([255,255,0,0,255,255]))
 assert.deepEqual([...colors.slice(0,4)],[72,210,135,145])
 assert.deepEqual([...colors.slice(4,8)],[255,170,65,200])
 assert.deepEqual([...colors.slice(8,12)],[211,110,241,200])
 assert.equal(colors[15],0)
 assert.deepEqual([...colors.slice(16,20)],[255,170,65,200])
 assert.deepEqual([...colors.slice(20,24)],[72,210,135,145])
 assert.throws(()=>alignmentColors(pixels([255]),pixels([])))
})
