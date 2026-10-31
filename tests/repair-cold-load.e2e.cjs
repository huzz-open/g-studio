const fs=require('node:fs'),assert=require('node:assert/strict')
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright')
const r=JSON.parse(fs.readFileSync('output/repair-reviewed-20261029/report.json','utf8')).runs[0]
const input={...r,imageUri:'data:image/png;base64,'+fs.readFileSync(r.source).toString('base64'),meshUri:'data:model/gltf-binary;base64,'+fs.readFileSync(r.mesh).toString('base64')}
;(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true})
 try{
  const page=await browser.newPage();await page.routeWebSocket(/ws:\/\//,s=>s.close())
  await page.route('**/repair-cold-test.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>repair test</title>'}))
  await page.addInitScript(()=>{window.mod=path=>import(performance.getEntriesByType('resource').find(e=>e.name.includes(path))?.name||path);window.repairWorkers=0;const Native=window.Worker;window.Worker=class extends Native{constructor(url,options){super(url,options);if(String(url).includes('model-repair.worker'))window.repairWorkers++}}})
  await page.goto((process.env.G_STUDIO_TEST_URL||'http://127.0.0.1:5181')+'/repair-cold-test.html')
  const run=()=>page.evaluate(async r=>{
   const {createBuiltinParts}=await window.mod('/src/shared/parts/builtins.ts'),{decodeMesh}=await window.mod('/src/shared/parts/mesh.ts'),{buildPartModel,meshExtents}=await window.mod('/src/modules/scene-lighting/part-model.ts')
   const {buildPartModelAsync}=await window.mod('/src/modules/scene-lighting/part-model-async.ts'),{cachedRepair,repairKey}=await window.mod('/src/modules/scene-lighting/model-repair.ts')
   const part=createBuiltinParts().find(p=>p.id==='example:'+r.id);part.version=2;part.image={uri:r.imageUri,width:r.width,height:r.height};part.imageFrame.height=r.bounds.height
   part.model={kind:'mesh',size:meshExtents(decodeMesh(r.meshUri)).size,mesh:{uri:r.meshUri,sha256:r.meshSha256},imageFit:r.fit,repair:r.repair}
   const data={width:0,height:0,data:new Uint8ClampedArray()},controller=new AbortController()
   const {fitPartPreview,createPartPreview}=await window.mod('/src/shared/parts/preview-state.ts'),{partMovementLimits}=await window.mod('/src/modules/scene-lighting/part-model.ts')
   const wasCold=!cachedRepair(part.model.repair),start=performance.now();fitPartPreview(createPartPreview(part),part,1);partMovementLimits(part);const syncBoundsMs=performance.now()-start,stillCold=!cachedRepair(part.model.repair)
   let ticks=0;const timer=setInterval(()=>ticks++,1)
   await buildPartModelAsync(part,data,controller.signal);clearInterval(timer)
   const status=cachedRepair(part.model.repair).stats.status
   for(let i=0;i<7;i++){const copy=JSON.parse(JSON.stringify(part));copy.model.size[0]+=(i+1)*.001;copy.model.repair.key=repairKey(copy);await buildPartModelAsync(copy,data,controller.signal)}
   const evicted=!cachedRepair(part.model.repair),before=window.repairWorkers
   await buildPartModelAsync(part,data,controller.signal)
   const recomputed=window.repairWorkers===before+1
   const copy=JSON.parse(JSON.stringify(part));copy.model.size[0]+=.1;copy.model.repair.key=repairKey(copy)
   const abort=new AbortController(),work=buildPartModelAsync(copy,data,abort.signal);abort.abort()
   let cancelled=false;try{await work}catch(e){cancelled=e.name==='AbortError'}
   return {wasCold,stillCold,syncBoundsMs,ticks,status,evicted,recomputed,cancelled,workers:window.repairWorkers}
  },input)
  for(let i=0;i<2;i++){
   const result=await run();assert.ok(result.wasCold&&result.stillCold&&result.evicted&&result.recomputed&&result.cancelled);assert.ok(result.ticks>0);assert.equal(result.status,'unsupported-topology');console.log(JSON.stringify({reload:i,...result}));if(!i)await page.reload()
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
