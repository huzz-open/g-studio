const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename)
const {createPart,clonePart}=require('../src/shared/parts/schema.ts')
const {createBuiltinParts}=require('../src/shared/parts/builtins.ts')
const {partParameterDefaults}=require('../src/shared/parts/parameter-defaults.ts')
const {parameterValuesEqual}=require('../src/shared/utils/parameter-values.ts')
const {changePartGeometry}=require('../src/shared/parts/preview-state.ts')
const {partGeometryOptions,selectPartGeometry,matchingModelJobs}=require('../src/shared/parts/geometry-options.ts')
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

test('switching shapes retains the reset baseline and only manual size edits remain changed',()=>{
  for(const part of [createPart('part',image),...createBuiltinParts()]){
    const original=partParameterDefaults(part),size=[...part.geometry.size]
    const choices=part.geometry.kind==='template'?['silhouette','template:'+part.geometry.template,'silhouette']:['silhouette']
    for(const choice of choices){
      changePartGeometry(part,choice)
      assert.deepEqual(part.geometry.size,size)
      assert.deepEqual(partParameterDefaults(part).geometry.size,original.geometry.size)
      assert.deepEqual(partParameterDefaults(part).alignment,original.alignment)
    }
    part.geometry.size[0]+=.1
    changePartGeometry(part,'silhouette')
    const restored=clonePart(part)
    assert.deepEqual(partParameterDefaults(restored).geometry.size,original.geometry.size)
    assert.equal(parameterValuesEqual(restored.geometry.size[0],original.geometry.size[0]),false)
  }
})

test('new parts have no primitive or unrelated template choices and builtins offer only their own template',()=>{
  assert.deepEqual(partGeometryOptions(createPart('part',image)).map(g=>g.kind),['silhouette'])
  for(const part of createBuiltinParts()){
    const template=part.geometry.template
    assert.deepEqual(partGeometryOptions(part).filter(g=>g.kind==='template').map(g=>g.template),[template])
    selectPartGeometry(part,partGeometryOptions(part).find(g=>g.kind==='silhouette'))
    assert.deepEqual(partGeometryOptions(part).filter(g=>g.kind==='template').map(g=>g.template),[template])
    assert.deepEqual(part.geometry.size,partParameterDefaults(part).geometry.size)
  }
})

test('available models match image hashes, ignore pending or rejected results, and prefer newest completion',()=>{
  const model=(id,createdAt,hash='a')=>({localId:id,createdAt,request:{inputSha256:hash},geometry:{kind:'mesh',size:[1,2,1],mesh:{inputSha256:hash,sha256:id}}})
  const old=model('old',1),latest=model('latest',3),other=model('other',4,'b'),rejected={...model('bad',5),resultRejected:true}
  const pending={localId:'pending',createdAt:9,request:{inputSha256:'a'},source:{assetId:'part'}}
  const jobs=[old,other,pending,rejected,latest]
  assert.deepEqual(matchingModelJobs(jobs,'a'),[latest,old])
  assert.deepEqual(matchingModelJobs(jobs,''),[])
  const part=createPart('part',image)
  assert.deepEqual(partGeometryOptions(part,matchingModelJobs(jobs,'a')).map(g=>g.kind),['mesh','mesh','silhouette'])
})
