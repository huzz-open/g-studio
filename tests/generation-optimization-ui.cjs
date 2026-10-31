const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const mesh=require('./fixtures/comparison-mesh.cjs').tetrahedron(),hash=createHash('sha256').update(mesh).digest('hex');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage(),tasks=new Map();let serial=0;const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>{window.mod=p=>import(performance.getEntriesByType('resource').find(e=>e.name.includes(p))?.name||p);window.optimizations=0;const W=Worker;window.Worker=class extends W{constructor(url,options){super(url,options);if(String(url).includes('orientation-fit'))window.optimizations++}}});
 await page.route('http://127.0.0.1:18765/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname,headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,OPTIONS'},reply=json=>route.fulfill({headers,json});
  if(req.method()==='OPTIONS')return route.fulfill({headers,status:204});
  if(path.endsWith('/info'))return reply({deviceType:'cpu'});
  if(path.endsWith('/jobs')&&req.method()==='POST'){const request=JSON.parse(req.postDataBuffer().toString().match(/name="request"\r\n\r\n([^\r]+)/)[1]),id='pipeline-'+(++serial);tasks.set(id,request);return reply({id,status:'running',phase:'sample'})}
  const id=path.split('/')[3],request=tasks.get(id);
  if(path.includes('/outputs/'))return route.fulfill({headers,body:mesh,contentType:'model/gltf-binary'});
  return reply({id,status:'succeeded',phase:'complete',result:{protocolVersion:1,jobId:id,providerId:'hunyuan-mini',inputSha256:request.inputSha256,triangles:4,bounds:[[-1,0,-1],[1,2,1]],coordinateSystem:'right-handed-y-up',warnings:[],outputs:[{id:'shadow',mime:'model/gltf-binary',bytes:mesh.length,sha256:hash}]}})
 });
 await page.goto(process.env.G_STUDIO_TEST_URL||'http://127.0.0.1:5186');await page.locator('.module-card').first().waitFor();
 await page.evaluate(async()=>{const {createGenerationJob}=await window.mod('/src/shared/generation/jobs.ts');const canvas=document.createElement('canvas');canvas.width=48;canvas.height=64;canvas.getContext('2d').fillRect(10,8,30,48);window.inputImage=canvas.toDataURL();window.startJob=enabled=>createGenerationJob('Pipeline',window.inputImage,{mode:'direct',baseUrl:'http://127.0.0.1:18765',token:'test',relayUrl:'',relayToken:'',deviceId:'',providerId:'hunyuan-mini',providerName:'Mini',targetFaces:40000,seed:12345,parametersByProvider:{},optimizeModel:enabled},undefined,job=>window.job=job)});
 await page.evaluate(()=>window.startJob(false));await page.waitForFunction(()=>!!window.job.model);
 assert.equal(await page.evaluate(()=>window.optimizations),0);assert.equal(await page.evaluate(()=>window.job.comparison.selected),'original');
 await page.evaluate(()=>window.startJob(true));await page.waitForFunction(()=>window.job.optimizing&&!window.job.model);
 await page.waitForFunction(()=>!!window.job.model,{},{timeout:60000});assert.equal(await page.evaluate(()=>window.optimizations),1);assert.equal(await page.evaluate(()=>window.job.comparison.selected),'optimized');
 const id=await page.evaluate(()=>window.job.localId);await page.evaluate(()=>{const c=document.createElement('canvas');c.width=32;c.height=32;window.inputImage=c.toDataURL();return window.startJob(true)});await page.waitForFunction(()=>window.job.resultRejected);assert.equal(await page.evaluate(()=>!!window.job.model),false);assert.ok(await page.evaluate(()=>window.job.error.includes('visible pixels')));await page.reload();await page.locator('.module-card').first().waitFor();
 const restored=await page.evaluate(async id=>{const {loadGenerationJobs,generationJobs}=await window.mod('/src/shared/generation/jobs.ts');await loadGenerationJobs();return generationJobs.find(j=>j.localId===id)},id);
 assert.equal(restored.comparison.selected,'optimized');assert.equal(await page.evaluate(()=>window.optimizations),0);
 await page.evaluate(async()=>{const {loadPartLibrary,partLibrary}=await window.mod('/src/shared/parts/library.ts');const {openPartEditor}=await window.mod('/src/shared/parts/editor-session.ts');await loadPartLibrary();window.builtins=Object.values(partLibrary).filter(p=>p.id.startsWith('example:'));openPartEditor({assetId:'example:chair',origin:'scene'})});
 await page.locator('.part-editor .model-comparison:not(.hidden-view)').waitFor();
 assert.equal(await page.evaluate(()=>window.builtins.every(p=>p.modelComparison?.candidate&&p.modelComparison?.selected==='optimized')),true);assert.equal(await page.evaluate(()=>window.optimizations),0);assert.deepEqual(errors,[]);
 console.log('PASS: generation opt-out runs no solver; opt-in completes optimization before publication without a viewport; reload and six builtins run no solver');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
