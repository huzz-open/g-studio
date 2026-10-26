const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename)
const schema=require('../src/shared/parts/schema.ts')
function setup(){
  const library={},saved=[],attached=[]
  const api={partLibrary:library,loadPartLibrary:async()=>{},hydrateParts:async parts=>parts.forEach(p=>library[p.id]=p),findSourcePart:source=>Object.values(library).find(p=>schema.sameSource(p,source)),savePart:async part=>{saved.push(part);library[part.id]=part;return part}}
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
