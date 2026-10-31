const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename)
const {createPart,clonePart}=require('../src/shared/parts/schema.ts')
const {createBuiltinParts}=require('../src/shared/parts/builtins.ts')
const {partParameterDefaults}=require('../src/shared/parts/parameter-defaults.ts')
const {parameterValuesEqual}=require('../src/shared/utils/parameter-values.ts')
const {partModelOptions,selectPartModel,matchingModelJobs}=require('../src/shared/parts/model-options.ts')
const image={uri:'data:image/png;base64,cGl4ZWxz',width:54,height:102}
test('imported part defaults remain factory values after edits, saves and an empty draft name',()=>{
  const part=createPart('part',image),original=clonePart(part)
  part.name='';part.model.size=[4,5,6];part.imageFrame={left:1,bottom:2,height:4};part.normal.alphaThreshold=.5
  const defaults=partParameterDefaults(part)
  assert.deepEqual(defaults.model,original.model);assert.deepEqual(defaults.imageFrame,original.imageFrame)
  assert.deepEqual(defaults.normal,original.normal);assert.equal(part.normal.alphaThreshold,.5)
})
test('bundled part defaults retain the curated normal and template alignment settings',()=>{
  for(const original of createBuiltinParts()){
    const edited=clonePart(original);edited.normal.detailStrength=7;edited.imageFrame.left=.1;edited.imageFrame.bottom=.2;edited.model.size=[3,4,5]
    const defaults=partParameterDefaults(edited)
    assert.deepEqual(defaults.normal,original.normal);assert.deepEqual(defaults.imageFrame,original.imageFrame);assert.deepEqual(defaults.model,original.model)
    defaults.imageFrame.left=0;assert.deepEqual(partParameterDefaults(edited).imageFrame,original.imageFrame)
  }
})
test('numeric reset indicators ignore float representation noise, but not a slider step',()=>{
  assert.equal(parameterValuesEqual(2.43,2.430000066757202),true)
  assert.equal(parameterValuesEqual(.32,.3199999928474426),true)
  assert.equal(parameterValuesEqual(.50,.03),false);assert.equal(parameterValuesEqual(2.43,2.44),false)
  assert.equal(parameterValuesEqual('1',1),false);assert.equal(parameterValuesEqual(false,0),false)
})

test('only AI mesh choices are exposed; images without models have no synthetic fallback',()=>{
 assert.deepEqual(partModelOptions(createPart('part',image)),[])
 for(const part of createBuiltinParts())assert.deepEqual(partModelOptions(part).map(m=>m.kind),['mesh'])
})

test('available models match image hashes, ignore pending or rejected results, and prefer newest completion',()=>{
  const model=(id,createdAt,hash='a')=>({localId:id,createdAt,request:{inputSha256:hash},model:{kind:'mesh',size:[1,2,1],mesh:{inputSha256:hash,sha256:id}}})
  const old=model('old',1),latest=model('latest',3),other=model('other',4,'b'),rejected={...model('bad',5),resultRejected:true}
  const pending={localId:'pending',createdAt:9,request:{inputSha256:'a'},source:{assetId:'part'}}
  const jobs=[old,other,pending,rejected,latest]
  assert.deepEqual(matchingModelJobs(jobs,'a'),[latest,old])
  assert.deepEqual(matchingModelJobs(jobs,''),[])
  const part=createPart('part',image)
  assert.deepEqual(partModelOptions(part,matchingModelJobs(jobs,'a')).map(g=>g.kind),['mesh','mesh'])
})

require('node:test').before(()=>require('./fixtures/builtin-models.cjs').install())
