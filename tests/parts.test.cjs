const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)
const { createPart, clonePart, validatePart, validateInstances, partRenderKey, nextPartRevision } = require('../src/shared/parts/schema.ts')
const { buildPartGeometry, meshExtents, alignedBounds } = require('../src/modules/scene-lighting/part-geometry.ts')
const { createBuiltinParts, isBuiltinPart } = require('../src/shared/parts/builtins.ts')
const { validateGsFile, validateSpriteData } = require('../src/shared/gs-format/schema.ts')
const image = { uri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', width: 1, height: 1 }
const make = () => createPart('custom seventh prop', image, 'custom:test')

test('six built-in assets are defined in code and classified by stable IDs',()=>{
  const parts=createBuiltinParts();assert.equal(parts.length,6)
  assert.equal(new Set(parts.map(p=>p.id)).size,6)
  assert.ok(parts.every(isBuiltinPart));assert.ok(parts.every(p=>p.image.uri.startsWith('builtin:')))
  assert.equal(isBuiltinPart({...parts[0],id:'example:unknown'}),false)
  parts[0].name='changed';assert.notEqual(createBuiltinParts()[0].name,'changed')
})

test('restoring an exported asset preserves its revision; edits advance the current revision',()=>{
  assert.equal(nextPartRevision(7),7);assert.equal(nextPartRevision(7,9),10)
  assert.throws(()=>nextPartRevision(1,Number.MAX_SAFE_INTEGER))
})

test('a new arbitrary sprite is a standard part, not a guessed built-in object', () => {
  const part=make();validatePart(part)
  assert.equal(part.geometry.kind,'silhouette');assert.equal(part.id,'custom:test')
  assert.deepEqual(JSON.parse(JSON.stringify(part)),part)
})
test('asset validation rejects invalid versions, unsafe image sources and malformed geometry', () => {
  const mutations=[p=>p.version=9,p=>p.id='__proto__',p=>p.image.uri='https://example.com/private.png',p=>p.normal.normalStrength=Infinity,p=>delete p.normal.invertX,p=>p.geometry.size[1]=-2,p=>p.geometry.kind='unknown',p=>p.geometry={kind:'template',template:'unknown',size:[1,1,1]},p=>p.alignment.anchor[0]=2,p=>p.geometry={kind:'compound',size:[1,1,1],parts:[]},p=>p.source={sheetHash:'bad'}]
  for(const mutate of mutations){const p=make();mutate(p);assert.throws(()=>validatePart(p))}
})
test('source metadata is preserved independently of asset names', () => {
  const part=make(),source={sheetHash:'a'.repeat(64),pixelHash:'b'.repeat(64),fileName:'sheet.png',rect:[4,8,1,1]}
  part.source=source;validatePart(part);part.name='renamed'
  assert.deepEqual(clonePart(part).source,source)
})
test('asset revisions and names do not invalidate geometry; normal and alignment changes do', () => {
  const p=make(),key=partRenderKey(p);p.name='new name';p.revision++
  assert.equal(partRenderKey(p),key);p.normal.detailStrength=2;assert.notEqual(partRenderKey(p),key)
  const normalKey=partRenderKey(p);p.alignment.offset[0]=.2;assert.notEqual(partRenderKey(p),normalKey)
})
test('two instances reference one asset while retaining separate transforms and shadow flags', () => {
  const a={id:'instance-a',assetId:'custom:test',x:0,z:0,scale:1,visible:true,casts:true,receives:true}
  const b={...a,id:'instance-b',x:3,receives:false};validateInstances([a,b])
  assert.equal(a.assetId,b.assetId);assert.notEqual(a.x,b.x);assert.equal(a.receives,true)
  assert.throws(()=>validateInstances([a,a]));assert.throws(()=>validateInstances([{...a,scale:0}]))
  assert.throws(()=>validateInstances([{...a,assetId:'constructor'}]))
})
test('unsupported geometry is rejected in current shapes, alternatives and rendering', () => {
  const {partGeometryOptions,selectPartGeometry}=require('../src/shared/parts/geometry-options.ts')
  const unsupported=['box','cylinder','compound'].map(kind=>({kind,size:[1,2,1]}))
  unsupported.push({kind:'template',template:'umbrella',size:[1,2,1]})
  for(const geometry of unsupported){
    const part=make();part.geometry=geometry
    assert.throws(()=>validatePart(part))
    assert.throws(()=>buildPartGeometry(part,{width:1,height:1,data:new Uint8ClampedArray([255,255,255,255])}))
    assert.deepEqual(partGeometryOptions(part).map(g=>g.kind),['silhouette'])
    const clean=make();clean.geometryAlternatives=[geometry]
    assert.throws(()=>validatePart(clean))
    assert.deepEqual(partGeometryOptions(clean).map(g=>g.kind),['silhouette'])
    assert.throws(()=>selectPartGeometry(make(),geometry))
  }
  const barrel=createBuiltinParts().find(p=>p.id==='example:barrel')
  barrel.geometry={kind:'template',template:'umbrella',size:[1,2,1]}
  assert.throws(()=>validatePart(barrel))
  assert.deepEqual(partGeometryOptions(barrel).filter(g=>g.kind==='template').map(g=>g.template),['barrel'])
})
test('silhouette geometry follows arbitrary alpha and never substitutes a bonsai', () => {
  const p=make(),pixels={width:3,height:3,data:new Uint8ClampedArray(3*3*4)}
  pixels.data[3]=255;pixels.data[4*2+3]=255;pixels.data[4*6+3]=255;pixels.data[4*8+3]=255
  const mesh=buildPartGeometry(p,pixels)
  assert.equal(mesh.triangles.length,48)
  assert.ok(mesh.vertices.every(Number.isFinite))
  assert.throws(()=>buildPartGeometry(p,{...pixels,data:new Uint8ClampedArray(pixels.data.length)}))
})
test('all bundled examples use the same asset schema and size controls', () => {
  for(const part of createBuiltinParts()){
    validatePart(part);const m=buildPartGeometry(part,{width:1,height:1,data:new Uint8ClampedArray(4)})
    const extents=meshExtents(m);extents.size.forEach((v,i)=>assert.ok(Math.abs(v-part.geometry.size[i])<1e-5))
    const a=alignedBounds(part,m);part.alignment.offset[0]+=.4;const b=alignedBounds(part,m)
    assert.ok(Math.abs(b.left-a.left-.4)<1e-6)
  }
})
test('legacy .gs sheets still validate; linked parts round-trip with full source metadata', () => {
  const sheet={gs:1,type:3,gen:'g-studio/test',version:1,data:{texture:'./sheet.png',size:[8,8],isComposite:false,sliceConfig:{detectionMode:'auto'},sprites:[{name:'sprite',rect:[0,0,1,1]}]}}
  validateGsFile(sheet);validateSpriteData(sheet.data)
  sheet.data.sprites[0].partAsset=make();sheet.data.sprites[0].normalSettings=make().normal
  const restored=JSON.parse(JSON.stringify(sheet));validateSpriteData(restored.data)
  assert.deepEqual(restored.data.sprites[0].partAsset,sheet.data.sprites[0].partAsset)
  restored.data.sprites[0].partAsset.version=99;assert.throws(()=>validateSpriteData(restored.data))
})
