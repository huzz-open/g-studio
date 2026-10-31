const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {createPart,clonePart}=require('../src/shared/parts/schema.ts');
const {buildPartModel,partMovementLimits}=require('../src/modules/scene-lighting/part-model.ts');
const {model}=require('./fixtures/builtin-models.cjs');
const pixels={width:0,height:0,data:new Uint8ClampedArray()};
function part(){const p=createPart('cache',{uri:'data:image/png;base64,eA==',width:1,height:1});p.version=2;p.model=model();p.model.imageFit={size:[2,2,2],target:[-1,0,2,2],mode:'similarity',rotation:[10,20,0],projection:[0,0,0]};return p}
test('render snapshots, selection and dragging reuse the same processed mesh',()=>{
 const p=part(),mesh=buildPartModel(p,pixels),limits=partMovementLimits(p);
 for(let i=0;i<10;i++){const snapshot=clonePart(p);snapshot.name='renamed';snapshot.normal.normalStrength=i;assert.equal(buildPartModel(snapshot,pixels),mesh);assert.deepEqual(partMovementLimits(snapshot),limits)}
 assert.notDeepEqual(partMovementLimits(p,2),limits);assert.equal(buildPartModel(p,pixels),mesh);
});
test('shape edits and source replacement invalidate processed mesh and movement bounds',()=>{
 const p=part(),mesh=buildPartModel(p,pixels),limits=partMovementLimits(p);
 for(const edit of [p=>p.model.size[0]*=2,p=>p.model.imageFit.rotation[1]+=30,p=>p.model.imageFit.projection[1]+=.4,p=>p.model.imageFit.target[0]+=1]){
  const next=clonePart(p);edit(next);assert.notEqual(buildPartModel(next,pixels),mesh);assert.notDeepEqual(partMovementLimits(next),limits)
 }
 const next=clonePart(p);next.model.mesh.uri=model(3).mesh.uri;assert.notEqual(buildPartModel(next,pixels),mesh,'do not trust a reused metadata hash for changed bytes');
 const native=clonePart(p);delete native.model.imageFit;native.model.original=true;assert.notEqual(buildPartModel(native,pixels),mesh);
});
