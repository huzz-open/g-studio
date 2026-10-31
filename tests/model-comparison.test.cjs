const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f)
const {meshBuilder,createScene}=require('../src/modules/scene-lighting/model.ts')
const {meshDataUri,decodeMesh}=require('../src/shared/parts/mesh.ts')
const {createPart,clonePart,validatePart}=require('../src/shared/parts/schema.ts')
const {initializeComparison,originalVersion,optimizedVersion,comparisonCurrent,candidateApplied,storeCandidate,chooseModelVersion,fitModelComparison}=require('../src/shared/parts/model-comparison.ts')
const {buildPartModel}=require('../src/modules/scene-lighting/part-model.ts')
const {generatedModels,resolvePartModels}=require('../src/shared/generation/models.ts')
function model(w=1,h=2,d=1){
 const b=meshBuilder();b.box(0,0,0,w,h,d,[1,1,1]);const mesh=b.build()
 const positions=new Float32Array(mesh.vertices.length/3)
 for(let i=0,j=0;i<mesh.vertices.length;i+=9,j+=3)positions.set(mesh.vertices.slice(i,i+3),j)
 const binary=Buffer.from(positions.buffer)
 const doc={asset:{version:'2.0'},buffers:[{byteLength:binary.length}],bufferViews:[{buffer:0,byteLength:binary.length}],accessors:[{bufferView:0,componentType:5126,count:positions.length/3,type:'VEC3'}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0}
 const text=JSON.stringify(doc),json=Buffer.from(text+' '.repeat((4-text.length%4)%4)),buffer=Buffer.alloc(28+json.length+binary.length)
 buffer.writeUInt32LE(0x46546c67,0);buffer.writeUInt32LE(2,4);buffer.writeUInt32LE(buffer.length,8);buffer.writeUInt32LE(json.length,12);buffer.writeUInt32LE(0x4e4f534a,16);json.copy(buffer,20);buffer.writeUInt32LE(binary.length,20+json.length);buffer.writeUInt32LE(0x004e4942,24+json.length);binary.copy(buffer,28+json.length)
 return {kind:'mesh',size:[w,h,d],mesh:{uri:meshDataUri(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.length)),sha256:'a'.repeat(64),inputSha256:'b'.repeat(64),providerId:'test',warnings:[]}}
}

function part(){const p=createPart('model',{uri:'data:image/png;base64,eA==',width:100,height:200});p.version=2;p.model=model();return initializeComparison(p)}
function candidate(p){const c=clonePart(originalVersion(p));delete c.model.original;c.model.size=[1.2,2.5,.8];return c}
test('new model is original and raw GLB model remains exact',()=>{
 const p=part();assert.equal(p.modelComparison.selected,'original');assert.equal(p.modelComparison.candidate,undefined);validatePart(p)
 assert.deepEqual(buildPartModel(p,{}).vertices,decodeMesh(p.model.mesh.uri).vertices)
})
test('candidate creation and repeated computation never change the adopted version',()=>{
 const p=part(),active=clonePart(p.model);storeCandidate(p,candidate(p));assert.deepEqual(p.model,active);assert.equal(p.modelComparison.selected,'original')
 chooseModelVersion(p,'optimized');assert.equal(candidateApplied(p),true);const adopted=clonePart(p.model)
 const next=candidate(p);next.model.size=[1.6,3,1];storeCandidate(p,next)
 assert.deepEqual(p.model,adopted);assert.equal(candidateApplied(p),false)
 chooseModelVersion(p,'original');assert.equal(p.model.original,true);assert.ok(p.modelComparison.candidate)
 chooseModelVersion(p,'optimized');assert.deepEqual(p.model.size,[1.6,3,1]);validatePart(p)
})
test('selection and both versions survive serialization',()=>{
 const p=part();storeCandidate(p,candidate(p));chooseModelVersion(p,'optimized');const restored=clonePart(p);validatePart(restored)
 assert.equal(candidateApplied(restored),true);chooseModelVersion(restored,'original');assert.equal(restored.model.mesh.uri,p.modelComparison.source.mesh.uri)
 assert.ok(restored.modelComparison.candidate)
})
test('regeneration preserves pinned variants; changed images invalidate matching',()=>{
 const p=part();p.model.mesh.modelId='compare-source';p.modelComparison.source.mesh.modelId='compare-source';storeCandidate(p,candidate(p));chooseModelVersion(p,'optimized');const active=clonePart(p.model)
 generatedModels.set('compare-source',{...model(),mesh:{...model().mesh,sha256:'c'.repeat(64)}})
 assert.equal(comparisonCurrent(p),true);assert.deepEqual(resolvePartModels(p).model,active);chooseModelVersion(p,'optimized')
 generatedModels.delete('compare-source');p.image.uri='data:image/png;base64,bmV3';assert.equal(comparisonCurrent(p),false);assert.deepEqual(p.model,active)
})
test('opening a raw model does not schedule optimization',()=>{
 const p=part();delete p.modelComparison;delete p.model.original;p.model.size=[2,3,1]
 const fresh=initializeComparison(p);assert.equal(fresh.modelComparison.autoOptimize,false);assert.equal(fresh.modelComparison.selected,'original');assert.equal(fresh.modelComparison.candidate,undefined)
 storeCandidate(fresh,candidate(fresh));assert.notEqual(fresh.modelComparison.source.id,fresh.modelComparison.candidate.id)
 assert.equal(fresh.modelComparison.candidate.sourceModelId,fresh.modelComparison.source.id)
})

test('comparison framing is one union frame independent of left/right order',()=>{
 const p=part();storeCandidate(p,candidate(p));const a={...createScene(),items:[{id:'p',assetId:p.id,x:0,z:0,scale:1,visible:true,casts:true,receives:true}]},b=clonePart(a)
 fitModelComparison(a,originalVersion(p),optimizedVersion(p),.7);fitModelComparison(b,optimizedVersion(p),originalVersion(p),.7)
 assert.deepEqual(a.target,b.target);assert.equal(a.zoom,b.zoom)
})

test('comparison schema rejects an unpinned selection or a candidate from another source',()=>{
 const p=part();storeCandidate(p,candidate(p));validatePart(p)
 const unpinned=clonePart(p);unpinned.model.frozen=false;assert.throws(()=>validatePart(unpinned))
 const other=clonePart(p);other.modelComparison.candidate.mesh.sha256='d'.repeat(64);assert.throws(()=>validatePart(other))
 const unstable=clonePart(p);delete unstable.imageFrame.height;assert.throws(()=>validatePart(unstable))
})

test('versions share a single image frame and candidates cannot replace it',()=>{
 const p=part(),frame=clonePart(p.imageFrame),c=candidate(p)
 storeCandidate(p,c)
 for(const version of ['optimized','original','optimized']){chooseModelVersion(p,version);assert.deepEqual(p.imageFrame,frame)}
 assert.deepEqual(originalVersion(p).imageFrame,optimizedVersion(p).imageFrame)
 c.imageFrame.left+=.1;assert.throws(()=>storeCandidate(p,c))
 p.imageFrame.height*=1.1;assert.equal(comparisonCurrent(p),false)
})
