const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f)
const {previewLayers}=require('../src/modules/scene-lighting/preview-display.ts')
test('review tasks produce exactly one surface output and isolate raw references from lighting',()=>{
 for(const mode of ['effect','model','shadow','source','alignment']){
  const p=previewLayers({mode:'sprites',shadows:true},{mode})
  assert.notEqual(p.image,p.model)
  if(mode==='source'||mode==='alignment'){assert.equal(p.room,false);assert.equal(p.shadows,false)}
  assert.equal(p.sourceOnly,mode==='source');assert.equal(p.shadowInspection,mode==='shadow')
 }
})
test('explicit shadow inspection works independently of final-effect shadows without changing scene state',()=>{
 const state={mode:'sprites',shadows:false},snapshot={...state}
 assert.equal(previewLayers(state,{mode:'effect'}).shadows,false)
 assert.equal(previewLayers(state,{mode:'shadow'}).shadows,true)
 assert.deepEqual(state,snapshot)
 assert.equal(previewLayers({...state,mode:'visibility'}).shadows,false)
})
