const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename)
const schema=require('../src/shared/parts/schema.ts')
function setup({library={},beforeHydrate=async()=>{}}={}){
  const saved=[],attached=[]
  const api={partLibrary:library,loadPartLibrary:async()=>{},hydrateParts:async parts=>{
    await beforeHydrate()
    await new Promise(resolve=>setImmediate(resolve))
    for(const part of parts)if(!library[part.id]||library[part.id].revision<part.revision){saved.push(part);library[part.id]=part}
  }}
  const code=ts.transpileModule(fs.readFileSync(require.resolve('../src/shared/parts/sprite-assets.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const module={exports:{}};new Function('require','module','exports',code)(name=>name==='./schema'?schema:api,module,module.exports)
  const sprite={id:1,name:'box',rect:{x:0,y:0,w:1,h:1},dataUrl:'data:image/png;base64,pixels'}
  const store={state:{sourceImage:{src:'source'},sourceFileName:'sheet.png',sprites:[sprite]},attachPartAsset:(id,part)=>{attached.push({id,part});store.state.sprites.find(s=>s.id===id).partAsset=part}}
  return {...module.exports,store,sprite,saved,attached,library}
}
test('automatic and explicit registration of one sprite share a single asset',async()=>{
  const x=setup(),a=x.ensureSpritePart(x.store,x.sprite),b=x.ensureSpritePart(x.store,x.sprite)
  assert.equal(a,b);const part=await a;assert.equal(x.saved.length,1);assert.equal(x.attached.length,1)
  assert.equal(part.geometry.kind,'silhouette');assert.equal(part.source.fileName,'sheet.png')
  const again={...x.sprite,partAsset:undefined};x.store.state.sprites=[again]
  assert.equal((await x.ensureSpritePart(x.store,again)).id,part.id);assert.equal(x.saved.length,1)
})
test('changed detection results and disposed registrations cannot publish stale crops',async()=>{
  const x=setup(),work=x.ensureSpritePart(x.store,x.sprite)
  x.store.state.sprites=[{...x.sprite}]
  await assert.rejects(work);assert.equal(x.saved.length,0);assert.equal(x.attached.length,0)
  const y=setup();await assert.rejects(y.ensureSpritePart(y.store,y.sprite,()=>false));assert.equal(y.saved.length,0)
})
test('changing crop pixels creates a new asset and preserves the previous asset',async()=>{
  const x=setup(),first=await x.ensureSpritePart(x.store,x.sprite)
  const second={...x.sprite,partAsset:undefined,dataUrl:'data:image/png;base64,changed'};x.store.state.sprites=[second]
  const next=await x.ensureSpritePart(x.store,second)
  assert.notEqual(first.id,next.id);assert.equal(x.saved.length,2);assert.equal(x.library[first.id].image.uri,first.image.uri)
})

test('identical crops from different sheets, positions and names reuse edited assets',async()=>{
  const x=setup(),first=await x.ensureSpritePart(x.store,x.sprite)
  first.name='edited';first.revision=4;first.normal.normalStrength=3;first.alignment.scale=2
  const y=setup({library:x.library})
  y.store.state.sourceImage={src:'another sheet'};y.store.state.sourceFileName='renamed.png'
  y.sprite.name='another name';y.sprite.rect.x=20;y.sprite.rect.y=30
  const reused=await y.ensureSpritePart(y.store,y.sprite)
  assert.deepEqual(reused,first);assert.equal(y.saved.length,0)
  assert.equal(reused.source.fileName,'sheet.png');assert.equal(y.attached[0].part.id,first.id)
})

test('concurrent independent registrations share one content ID and persisted asset',async()=>{
  const library={},a=setup({library}),b=setup({library})
  b.store.state.sourceImage={src:'different sheet'};b.sprite.rect.x=8
  const [first,second]=await Promise.all([a.ensureSpritePart(a.store,a.sprite),b.ensureSpritePart(b.store,b.sprite)])
  assert.equal(first.id,second.id);assert.equal(Object.keys(library).length,1)
  assert.equal(a.saved.length+b.saved.length,1)
  assert.equal(a.attached[0].part.id,b.attached[0].part.id)
  assert.equal(first.revision,1)
})

test('dimensions distinguish crops and original crops survive arranged previews',async()=>{
  const x=setup(),first=await x.ensureSpritePart(x.store,x.sprite)
  const arranged={...x.sprite,partAsset:undefined,_origRect:{...x.sprite.rect},_origDataUrl:x.sprite.dataUrl,
    rect:{x:5,y:5,w:4,h:4},dataUrl:'data:image/png;base64,preview'}
  x.store.state.sprites=[arranged]
  assert.equal((await x.ensureSpritePart(x.store,arranged)).id,first.id)
  const resized={...x.sprite,partAsset:undefined,rect:{x:0,y:0,w:2,h:1}}
  x.store.state.sprites=[resized]
  assert.notEqual((await x.ensureSpritePart(x.store,resized)).id,first.id)
})

test('failed persistence can be retried without leaving a pending registration',async()=>{
  let fail=true
  const x=setup({beforeHydrate:async()=>{if(fail)throw new Error('write failed')}})
  await assert.rejects(x.ensureSpritePart(x.store,x.sprite),/write failed/)
  assert.equal(x.attached.length,0);assert.equal(x.saved.length,0)
  fail=false
  await x.ensureSpritePart(x.store,x.sprite)
  assert.equal(x.saved.length,1);assert.equal(x.attached.length,1)
})

test('a registration cancelled during persistence does not attach to the current sheet',async()=>{
  let current=true
  const x=setup({beforeHydrate:async()=>{current=false}})
  await assert.rejects(x.ensureSpritePart(x.store,x.sprite,()=>current),/切分结果已变化/)
  assert.equal(x.attached.length,0)
})
