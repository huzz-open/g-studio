const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename)
const {createPart,clonePart}=require('../src/shared/parts/schema.ts')
const {changePartGeometry,createPartPreview,fitPartPreview}=require('../src/shared/parts/preview-state.ts')
const image={uri:'data:image/png;base64,pixels',width:1,height:1}
test('shape choices preserve authored size, image alignment and the live preview pose',()=>{
  const part=require('../src/shared/parts/builtins.ts').createBuiltinParts()[0],preview=createPartPreview(part)
  part.geometry.size=[1.3,2.7,.8];part.alignment={anchor:[.4,.9],offset:[.2,-.1],scale:1.3}
  preview.zoom=9;preview.target=[1,2,3];preview.light=[-1,6,4];preview.items[0].x=2;preview.items[0].z=-2
  const before=clonePart(preview),alignment=clonePart(part.alignment)
  for(const kind of ['silhouette','template:umbrella','silhouette']){
    changePartGeometry(part,kind)
    assert.deepEqual(part.geometry.size,[1.3,2.7,.8]);assert.deepEqual(part.alignment,alignment)
    assert.deepEqual(preview,before)
  }
})
test('shape changes accept only silhouette or the built-in part own template',()=>{
  const part=createPart('prop',image)
  for(const choice of ['box','cylinder','compound','template:umbrella'])assert.throws(()=>changePartGeometry(part,choice))
  const barrel=require('../src/shared/parts/builtins.ts').createBuiltinParts().find(p=>p.id==='example:barrel')
  assert.throws(()=>changePartGeometry(barrel,'template:umbrella'))
})
test('explicit fit only changes the camera, preserving object and light adjustments',()=>{
  const part=createPart('prop',image),preview=createPartPreview(part)
  preview.items[0].x=1.2;preview.items[0].z=-2;preview.light=[2,7,1];preview.scene='corner'
  const items=clonePart(preview.items),light=[...preview.light]
  fitPartPreview(preview,part,.4)
  assert.deepEqual(preview.items,items);assert.deepEqual(preview.light,light)
  assert.equal(preview.scene,'corner')
  assert.ok(preview.target.every(Number.isFinite));assert.ok(preview.zoom>=4&&preview.zoom<=40)
})

test('fit keeps every built-in part, aligned image and point-light handles inside portrait and landscape viewports',()=>{
  const {createBuiltinParts}=require('../src/shared/parts/builtins.ts')
  const {buildPartGeometry,alignedBounds}=require('../src/modules/scene-lighting/part-geometry.ts')
  const {camera,transform,add,scale}=require('../src/modules/experiments/umbrella/math.ts')
  const {PITCH,YAW,RIGHT,UP}=require('../src/modules/scene-lighting/model.ts')
  for(const part of createBuiltinParts())for(const aspect of [.4,.9,1.8,3]){
    const state=createPartPreview(part),mesh=buildPartGeometry(part,{width:1,height:1,data:new Uint8ClampedArray([255,255,255,255])})
    fitPartPreview(state,part,aspect)
    const matrix=camera({yaw:YAW,pitch:PITCH,distance:state.zoom,projection:'orthographic'},aspect,state.target).matrix
    const points=[state.light,[state.light[0],0,state.light[2]]]
    for(let i=0;i<mesh.vertices.length;i+=9)points.push(Array.from(mesh.vertices.slice(i,i+3)))
    const bounds=alignedBounds(part,mesh)
    for(const x of [bounds.left,bounds.left+bounds.width])for(const y of [bounds.bottom,bounds.bottom+bounds.height])points.push(add(scale(RIGHT,x),scale(UP,y)))
    for(const point of points){
      const clip=transform(matrix,point)
      assert.ok(Math.abs(clip[0]/clip[3])<.9&&Math.abs(clip[1]/clip[3])<.9,`${part.id} at aspect ${aspect}: ${point}`)
    }
  }
})

test('directional-light framing ignores its unused point-light coordinates',()=>{
  const part=createPart('prop',image),state=createPartPreview(part)
  state.lightKind='directional';fitPartPreview(state,part,.8)
  const camera=clonePart({zoom:state.zoom,target:state.target})
  state.light=[-5,12,5];fitPartPreview(state,part,.8)
  assert.deepEqual({zoom:state.zoom,target:state.target},camera)
})

function rendererFixture(){
  const deleted=new Set(),allocations=[]
  const gl=new Proxy({}, {get(_,key){
    if(typeof key==='string'&&/^[A-Z_0-9]+$/.test(key))return 1
    if(String(key).startsWith('create'))return ()=>{const id={type:key};allocations.push(id);return id}
    if(String(key).startsWith('delete'))return id=>deleted.add(id)
    if(key==='getShaderParameter'||key==='getProgramParameter')return ()=>true
    if(key==='checkFramebufferStatus')return ()=>1
    return ()=>{}
  }})
  const pixels={width:1,height:1,data:new Uint8ClampedArray([255,255,255,255])}
  let load=async()=>({image:{},pixels}),loadNormal=async()=>''
  const images={partPixels:part=>load(part),normalImageUrl:part=>loadNormal(part),loadImage:async()=>({})}
  const file=require.resolve('../src/modules/scene-lighting/renderer.ts'),localRequire=require('node:module').createRequire(file)
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const module={exports:{}}
  new Function('require','module','exports',code)(name=>name.endsWith('/parts/images')?images:localRequire(name),module,module.exports)
  const renderer=module.exports.createSceneRenderer({getContext:()=>gl})
  return {renderer,deleted,allocations,setLoad:fn=>load=fn,setNormalLoad:fn=>loadNormal=fn,pixels}
}

test('normal-only edits replace one texture without decoding color or rebuilding surface geometry',async()=>{
  const f=rendererFixture(),part=createPart('prop',image,'prop');await f.renderer.syncAssets([part])
  const previous=[...f.allocations],count=previous.length,coverage=f.renderer.coverage()
  f.setLoad(async()=>{throw new Error('unchanged color must not be decoded')})
  const updated=clonePart(part);updated.normal.normalStrength=8;updated.normal.normalFormat='directx'
  assert.equal(await f.renderer.syncAssets([updated]),true)
  assert.deepEqual(f.allocations.slice(count).map(r=>r.type),['createTexture'])
  assert.equal(previous.filter(r=>f.deleted.has(r)).length,1)
  assert.deepEqual(f.renderer.coverage(),coverage)
  const stableCount=f.allocations.length;await f.renderer.syncAssets([updated])
  assert.equal(f.allocations.length,stableCount)
  f.renderer.dispose();assert.ok(f.allocations.every(r=>f.deleted.has(r)))
})

test('superseded multi-part normal updates release only staged textures and preserve the visible frame',async()=>{
  const f=rendererFixture(),a=createPart('a',image,'a'),b=createPart('b',image,'b')
  await f.renderer.syncAssets([a,b]);const previous=[...f.allocations]
  a.normal.normalStrength=8;b.normal.normalStrength=8
  let entered,release;const reached=new Promise(r=>entered=r),blocked=new Promise(r=>release=r)
  f.setNormalLoad(async part=>{if(part.id==='b'){entered();await blocked}return ''})
  let current=true;const work=f.renderer.syncAssets([a,b],()=>current)
  await reached;current=false;release();assert.equal(await work,false)
  assert.ok(previous.every(r=>!f.deleted.has(r)))
  assert.ok(f.allocations.slice(previous.length).every(r=>f.deleted.has(r)))
  f.renderer.dispose();assert.ok(f.allocations.every(r=>f.deleted.has(r)))
})
test('a superseded multi-asset update keeps the old frame until a complete replacement is ready',async()=>{
  const f=rendererFixture(),old=createPart('old',image,'old');await f.renderer.syncAssets([old])
  const oldResources=[...f.allocations],a=createPart('a',image,'a'),b=createPart('b',image,'b')
  let release,entered;const reached=new Promise(r=>entered=r),blocked=new Promise(r=>release=r)
  f.setLoad(async part=>{if(part.id==='b'){entered();await blocked}return {image:{},pixels:f.pixels}})
  let current=true;const work=f.renderer.syncAssets([a,b],()=>current)
  await reached
  assert.deepEqual(Object.keys(f.renderer.coverage()),['old'])
  current=false;release();assert.equal(await work,false)
  assert.deepEqual(Object.keys(f.renderer.coverage()),['old'])
  assert.ok(oldResources.every(resource=>!f.deleted.has(resource)))
  assert.equal(await f.renderer.syncAssets([a,b]),true)
  assert.deepEqual(Object.keys(f.renderer.coverage()),['a','b'])
  f.renderer.dispose()
})
test('a failed update leaves previously displayed assets intact',async()=>{
  const f=rendererFixture(),old=createPart('old',image,'old');await f.renderer.syncAssets([old])
  f.setLoad(async()=>{throw new Error('decode failed')})
  await assert.rejects(f.renderer.syncAssets([createPart('new',image,'new')]))
  assert.deepEqual(Object.keys(f.renderer.coverage()),['old']);f.renderer.dispose()
})
