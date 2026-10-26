const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename)
const {createPart,clonePart}=require('../src/shared/parts/schema.ts')
const {changePartGeometry,createPartPreview,fitPartPreview}=require('../src/shared/parts/preview-state.ts')
const image={uri:'data:image/png;base64,pixels',width:1,height:1}
test('shape choices preserve authored size, image alignment and the live preview pose',()=>{
  const part=createPart('prop',image),preview=createPartPreview(part)
  part.geometry.size=[1.3,2.7,.8];part.alignment={anchor:[.4,.9],offset:[.2,-.1],scale:1.3}
  preview.zoom=9;preview.target=[1,2,3];preview.light=[-1,6,4];preview.items[0].x=2;preview.items[0].z=-2
  const before=clonePart(preview),alignment=clonePart(part.alignment)
  for(const kind of ['box','cylinder','template:umbrella','silhouette']){
    changePartGeometry(part,kind)
    assert.deepEqual(part.geometry.size,[1.3,2.7,.8]);assert.deepEqual(part.alignment,alignment)
    assert.deepEqual(preview,before)
  }
})
test('explicit fit only changes the camera, preserving object and light adjustments',()=>{
  const part=createPart('prop',image),preview=createPartPreview(part)
  preview.items[0].x=1.2;preview.items[0].z=-2;preview.light=[2,7,1];preview.scene='corner'
  const items=clonePart(preview.items),light=[...preview.light]
  fitPartPreview(preview,part,.4)
  assert.deepEqual(preview.items,items);assert.deepEqual(preview.light,light)
  assert.deepEqual(preview.target,[1.2,part.geometry.size[1]/2,-2]);assert.equal(preview.scene,'corner')
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
  let load=async()=>({image:{},pixels})
  const images={partPixels:part=>load(part),normalImageUrl:async()=>'',loadImage:async()=>({})}
  const file=require.resolve('../src/modules/scene-lighting/renderer.ts'),localRequire=require('node:module').createRequire(file)
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const module={exports:{}}
  new Function('require','module','exports',code)(name=>name.endsWith('/parts/images')?images:localRequire(name),module,module.exports)
  const renderer=module.exports.createSceneRenderer({getContext:()=>gl})
  return {renderer,deleted,allocations,setLoad:fn=>load=fn,pixels}
}
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
