const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename)
const {createPart,clonePart}=require('../src/shared/parts/schema.ts')
const {createBuiltinParts}=require('../src/shared/parts/builtins.ts')
const {partParameterDefaults}=require('../src/shared/parts/parameter-defaults.ts')
const {parameterValuesEqual}=require('../src/shared/utils/parameter-values.ts')
const image={uri:'data:image/png;base64,cGl4ZWxz',width:54,height:102}
test('imported part defaults remain factory values after edits, saves and an empty draft name',()=>{
  const part=createPart('part',image),original=clonePart(part)
  part.name='';part.geometry.size=[4,5,6];part.alignment={anchor:[.1,.2],offset:[1,2],scale:2};part.normal.alphaThreshold=.5
  const defaults=partParameterDefaults(part)
  assert.deepEqual(defaults.geometry,original.geometry);assert.deepEqual(defaults.alignment,original.alignment)
  assert.deepEqual(defaults.normal,original.normal);assert.equal(part.normal.alphaThreshold,.5)
})
test('bundled part defaults retain the curated normal and template alignment settings',()=>{
  for(const original of createBuiltinParts()){
    const edited=clonePart(original);edited.normal.detailStrength=7;edited.alignment.anchor=[.1,.2];edited.geometry.size=[3,4,5]
    const defaults=partParameterDefaults(edited)
    assert.deepEqual(defaults.normal,original.normal);assert.deepEqual(defaults.alignment,original.alignment);assert.deepEqual(defaults.geometry,original.geometry)
    defaults.alignment.anchor[0]=0;assert.deepEqual(partParameterDefaults(edited).alignment,original.alignment)
  }
})
test('numeric reset indicators ignore float representation noise, but not a slider step',()=>{
  assert.equal(parameterValuesEqual(2.43,2.430000066757202),true)
  assert.equal(parameterValuesEqual(.32,.3199999928474426),true)
  assert.equal(parameterValuesEqual(.50,.03),false);assert.equal(parameterValuesEqual(2.43,2.44),false)
  assert.equal(parameterValuesEqual('1',1),false);assert.equal(parameterValuesEqual(false,0),false)
})
