const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');const {createHash}=require('node:crypto');
function tetrahedron(height = 2) {
  const vertices = new Float32Array([-1,0,-1, 1,0,-1, 0,height,0, 1,0,-1, 0,0,1, 0,height,0, 0,0,1, -1,0,-1, 0,height,0, -1,0,-1, 0,0,1, 1,0,-1])
  const binary = Buffer.from(vertices.buffer)
  const doc = { asset:{ version:'2.0' }, buffers:[{byteLength:binary.length}], bufferViews:[{buffer:0,byteLength:binary.length}], accessors:[{bufferView:0,componentType:5126,count:12,type:'VEC3'}], meshes:[{primitives:[{attributes:{POSITION:0}}]}], nodes:[{mesh:0}], scenes:[{nodes:[0]}], scene:0 }
  const jsonText = JSON.stringify(doc), json = Buffer.from(jsonText + ' '.repeat((4-jsonText.length%4)%4))
  const data = Buffer.alloc(28+json.length+binary.length)
  data.writeUInt32LE(0x46546c67,0); data.writeUInt32LE(2,4); data.writeUInt32LE(data.length,8)
  data.writeUInt32LE(json.length,12); data.writeUInt32LE(0x4e4f534a,16); json.copy(data,20)
  data.writeUInt32LE(binary.length,20+json.length); data.writeUInt32LE(0x004e4942,24+json.length); binary.copy(data,28+json.length)
  return data
}

(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
let serial=0,autoFinish=true,failNext=false;const remote=new Map();
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,OPTIONS'};
const caps={protocolVersion:1,providers:[{providerId:'hunyuan-mini',name:'Hunyuan',state:'ready',parameters:{steps:{min:1,max:10,default:5,integer:true}}}],limits:{inputBytes:10485760,inputDimension:2048,outputBytes:134217728,concurrency:1,queue:8},targetFaces:{min:1000,max:40000,default:12000}};
await page.route('**/__generation/connection',r=>r.fulfill({json:{baseUrl:'http://127.0.0.1:8765',token:'test'}}));
await page.route('http://127.0.0.1:8765/**',async r=>{const req=r.request(),path=new URL(req.url()).pathname,reply=json=>r.fulfill({headers,json});if(req.method()==='OPTIONS')return r.fulfill({headers,status:204});if(path.endsWith('/capabilities'))return reply(caps);if(path.endsWith('/info'))return reply({deviceType:'gpu',backend:'cuda'});
if(path==='/v1/jobs'&&req.method()==='POST'){const text=req.postDataBuffer().toString(),request=JSON.parse(text.match(/name="request"\r\n\r\n([^\r]+)/)[1]),id='regen-'+(++serial),bytes=tetrahedron(2+serial*.1);remote.set(id,{request,bytes,hash:createHash('sha256').update(bytes).digest('hex'),status:failNext?'failed':autoFinish?'succeeded':'running'});failNext=false;return reply({id,status:'running',phase:'sample'})}
const id=path.split('/')[3],job=remote.get(id);if(path.endsWith('/ack'))return reply({ok:true});if(path.includes('/outputs/'))return r.fulfill({headers,body:job.bytes,contentType:'model/gltf-binary'});if(path.endsWith('/cancel')){job.status='cancelled';return reply({id,status:'cancelled',phase:'cancelled'})}
return reply({id,status:job.status,phase:job.status==='succeeded'?'complete':'sample',...(job.status==='succeeded'?{result:{protocolVersion:1,jobId:id,providerId:'hunyuan-mini',inputSha256:job.request.inputSha256,triangles:4,bounds:[[-1,0,-1],[1,3,1]],coordinateSystem:'right-handed-y-up',warnings:[],outputs:[{id:'shadow',mime:'model/gltf-binary',bytes:job.bytes.length,sha256:job.hash}]}}:{})})});
await page.addInitScript(()=>{const key='g-studio-generation-device-v1';if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({mode:'direct',baseUrl:'http://127.0.0.1:8765',token:'ui-test'}))});
const url=process.env.G_STUDIO_TEST_URL||'http://localhost:5173';await page.goto(url);
const init=()=>page.evaluate(async()=>{window.mod=async path=>import(performance.getEntriesByType('resource').find(e=>e.name.includes(path))?.name || path);window.regenJobs=await window.mod('/src/shared/generation/jobs.ts');window.genConnection=await window.mod('/src/shared/generation/connection.ts')});await init();
await page.waitForFunction(()=>window.genConnection.canGenerateModels.value);
await page.locator('.module-card').filter({hasText:'模型生成'}).click();await page.locator('.generation-sidebar').waitFor();
const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=64;c.height=96;c.getContext('2d').fillRect(5,5,50,80);return c.toDataURL('image/png')});
await page.locator('.generation-sidebar input[type=file]').setInputFiles({name:'original.png',mimeType:'image/png',buffer:Buffer.from(data.split(',')[1],'base64')});await page.getByRole('button',{name:'生成模型',exact:true}).click();await page.getByRole('button',{name:'覆盖当前模型',exact:true}).waitFor({timeout:15000});
assert.equal(await page.locator('#generation-properties .action-btn.default').count(),2);assert.equal(await page.locator('#generation-properties .action-btn.primary').count(),0);
const original=await page.evaluate(async()=>{const {generationJobs}=await window.mod('/src/shared/generation/jobs.ts');const j=generationJobs[0];window.original=j.localId;const {createPart}=await window.mod('/src/shared/parts/schema.ts'),{savePart}=await window.mod('/src/shared/parts/library.ts');for(const [id,size] of [['linked-a',[1,2,1]],['linked-b',[3,4,2]]]){const p=createPart(id,{uri:j.image,width:64,height:96},id);p.version=2;p.geometry=structuredClone(JSON.parse(JSON.stringify(j.geometry)));p.geometry.size=size;await savePart(p)}return {id:j.localId,modelId:j.modelId,hash:j.geometry.mesh.sha256}});
await page.getByRole('spinbutton',{name:'目标三角面数'}).fill('15000');await page.getByRole('spinbutton',{name:'目标三角面数'}).blur();await page.getByRole('spinbutton',{name:'随机种子'}).fill('99');await page.getByRole('spinbutton',{name:'随机种子'}).blur();autoFinish=false;
await page.getByRole('button',{name:'覆盖当前模型',exact:true}).click();await page.waitForFunction(()=>window.regenJobs.generationJobs.some(j=>j.replaces && j.remote));
assert.equal(remote.get('regen-2').request.targetFaces,15000);assert.equal(remote.get('regen-2').request.seed,99);
assert.equal(await page.evaluate(()=>window.regenJobs.findGenerationJob(window.original).geometry.mesh.sha256),original.hash);
assert.equal(await page.getByRole('button',{name:'覆盖当前模型',exact:true}).isDisabled(),true);
remote.get('regen-2').status='succeeded';await page.waitForFunction(()=>window.regenJobs.findGenerationJob(window.original)?.modelRevision===2,null,{timeout:15000});
const replaced=await page.evaluate(async()=>{const {findGenerationJob}=await window.mod('/src/shared/generation/jobs.ts'),{partLibrary}=await window.mod('/src/shared/parts/library.ts');return {job:JSON.parse(JSON.stringify(findGenerationJob(window.original))),parts:['linked-a','linked-b'].map(id=>JSON.parse(JSON.stringify(partLibrary[id])))}});
assert.equal(replaced.job.localId,original.id);assert.equal(replaced.job.modelId,original.modelId);assert.notEqual(replaced.job.geometry.mesh.sha256,original.hash);assert.deepEqual(replaced.parts.map(p=>p.id),['linked-a','linked-b']);assert.deepEqual(replaced.parts.map(p=>p.geometry.size),[[1,2,1],[3,4,2]]);assert.ok(replaced.parts.every(p=>p.geometry.mesh.modelId===original.modelId&&p.geometry.mesh.sha256===replaced.job.geometry.mesh.sha256));
autoFinish=true;await page.getByRole('spinbutton',{name:'随机种子'}).fill('123');await page.getByRole('spinbutton',{name:'随机种子'}).blur();await page.getByRole('button',{name:'生成新模型',exact:true}).click();await page.waitForFunction(()=>window.regenJobs.generationJobs.filter(j=>j.geometry).length===2,null,{timeout:15000});
const fork=await page.evaluate(async()=>{const {generationJobs}=await window.mod('/src/shared/generation/jobs.ts');return JSON.parse(JSON.stringify(generationJobs.find(j=>j.localId!==window.original)))});assert.notEqual(fork.modelId,original.modelId);assert.equal(fork.request.seed,123);
await page.locator('[data-tab-id]').first().click();assert.equal(await page.getByRole('spinbutton',{name:'随机种子'}).inputValue(),'123');
failNext=true;await page.getByRole('button',{name:'覆盖当前模型',exact:true}).click();await page.waitForFunction(()=>window.regenJobs.generationJobs.some(j=>j.replaces&&j.remote?.status==='failed'),null,{timeout:10000});
assert.equal(await page.evaluate(()=>window.regenJobs.findGenerationJob(window.original).geometry.mesh.sha256),replaced.job.geometry.mesh.sha256);
autoFinish=false;await page.getByRole('button',{name:'覆盖当前模型',exact:true}).click();await page.waitForFunction(()=>window.regenJobs.generationJobs.some(j=>j.replaces&&j.remote?.status==='running'));
await page.evaluate(async()=>{const {generationJobs,cancelJob}=await window.mod('/src/shared/generation/jobs.ts');await cancelJob(generationJobs.find(j=>j.replaces&&j.remote?.status==='running'))});
// An IndexedDB failure must roll back both the model and its task replacement.
await page.evaluate(id=>{const put=IDBObjectStore.prototype.put;let once=true;IDBObjectStore.prototype.put=function(value,...args){const request=put.call(this,value,...args);if(once && this.name==='models' && value.modelId===id && value.modelRevision===3){once=false;queueMicrotask(()=>this.transaction.abort())}return request}},original.modelId);
autoFinish=true;await page.getByRole('button',{name:'覆盖当前模型',exact:true}).click();await page.waitForFunction(()=>window.regenJobs.generationJobs.some(j=>j.replaces&&j.resultRejected),null,{timeout:15000});
assert.equal(await page.evaluate(()=>window.regenJobs.findGenerationJob(window.original).geometry.mesh.sha256),replaced.job.geometry.mesh.sha256);
await page.reload();await init();await page.evaluate(async()=>{const {loadPartLibrary}=await window.mod('/src/shared/parts/library.ts');await loadPartLibrary()});
const persisted=await page.evaluate(async()=>{const {partLibrary}=await window.mod('/src/shared/parts/library.ts');return ['linked-a','linked-b'].map(id=>partLibrary[id].geometry.mesh)});assert.ok(persisted.every(m=>m.modelId===original.modelId&&m.sha256===replaced.job.geometry.mesh.sha256));
// Removing task history must not erase a shared model or break imported copies.
await page.evaluate(async id=>{const {loadGenerationJobs,findGenerationJob,removeJob}=await window.mod('/src/shared/generation/jobs.ts');await loadGenerationJobs();await removeJob(findGenerationJob(id))},original.id);
await page.reload();await init();await page.evaluate(async()=>{const {loadPartLibrary,partLibrary}=await window.mod('/src/shared/parts/library.ts');await loadPartLibrary();const {openPartEditor}=await window.mod('/src/shared/parts/editor-session.ts');openPartEditor({assetId:'linked-a',origin:'scene'})});
await page.locator('.part-editor .geometry-trigger').click();await page.locator('.geometry-create:visible').click();await page.locator('.generation-overlay').getByRole('button',{name:'覆盖当前模型',exact:true}).waitFor();
assert.equal(await page.locator('.generation-overlay .action-btn.default').count(),2);
const restored=await page.evaluate(async()=>{const {partLibrary}=await window.mod('/src/shared/parts/library.ts');return partLibrary['linked-a'].geometry.mesh});assert.equal(restored.modelId,original.modelId);assert.equal(restored.sha256,replaced.job.geometry.mesh.sha256);
assert.deepEqual(errors,[]);console.log('PASS: shared dual actions, current inputs, stable-ID overwrite, linked parts refresh without resize, independent new ID, failure/cancellation preserve old model, persistent references');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
