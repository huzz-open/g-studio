const fs=require('node:fs'),assert=require('node:assert/strict')
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright')
const {tetrahedron}=require('./fixtures/comparison-mesh.cjs')
const reportPath=process.env.G_STUDIO_COMPARISON_FIXTURE||'output/alignment-surface-20261029/report.json'
const fixture=fs.existsSync(reportPath)?JSON.parse(fs.readFileSync(reportPath,'utf8')).runs.find(r=>r.id==='chair'):undefined
const input=fixture?{...fixture,real:true,imageUri:'data:image/png;base64,'+fs.readFileSync(fixture.source).toString('base64'),meshUri:'data:model/gltf-binary;base64,'+fs.readFileSync(fixture.mesh).toString('base64')}:{real:false,width:100,height:200,provider:'test',meshSha256:'a'.repeat(64),inputSha256:'b'.repeat(64),meshUri:'data:model/gltf-binary;base64,'+tetrahedron().toString('base64')}
;(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true})
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1}),errors=[]
  page.on('pageerror',e=>errors.push(String(e)));await page.routeWebSocket(/ws:\/\//,s=>s.close())
  await page.addInitScript(()=>{window.mod=path=>import(performance.getEntriesByType('resource').find(e=>e.name.includes(path))?.name||path);window.optimizers=0;const Native=window.Worker;window.Worker=class extends Native{constructor(url,options){super(url,options);if(String(url).includes('orientation-fit.worker'))window.optimizers++}}})
  await page.goto(process.env.G_STUDIO_TEST_URL||'http://127.0.0.1:5182/#/scene-lighting')
  await page.evaluate(async r=>{
    const {createPart}=await window.mod('/src/shared/parts/schema.ts'),{decodeMesh}=await window.mod('/src/shared/parts/mesh.ts'),{meshExtents}=await window.mod('/src/modules/scene-lighting/part-model.ts')
    const {loadPartLibrary,savePart}=await window.mod('/src/shared/parts/library.ts');await loadPartLibrary()
    if(!r.imageUri){const canvas=document.createElement('canvas');canvas.width=r.width;canvas.height=r.height;const ctx=canvas.getContext('2d');ctx.fillStyle='#86a36b';ctx.fillRect(10,30,60,150);r.imageUri=canvas.toDataURL()}
    const p=createPart(r.real?'真实椅子 · 版本对比':'模型版本对比测试',{uri:r.imageUri,width:r.width,height:r.height},'comparison-chair');p.version=2;p.model={kind:'mesh',size:meshExtents(decodeMesh(r.meshUri)).size,mesh:{uri:r.meshUri,sha256:r.meshSha256,inputSha256:r.inputSha256,providerId:r.provider,modelId:'comparison-source',modelRevision:1,warnings:[]}}
    await savePart(p);const {openPartEditor}=await window.mod('/src/shared/parts/editor-session.ts');openPartEditor({assetId:p.id,origin:'scene'})
  },input)
  const editor=page.locator('.part-editor'),original=editor.getByRole('button',{name:'使用原始模型',exact:true}),optimized=editor.getByRole('button',{name:'使用优化结果',exact:true})
  await original.waitFor();assert.equal(await original.getAttribute('aria-pressed'),'true');assert.ok(await optimized.isDisabled());assert.equal(await page.evaluate(()=>window.optimizers),0)
  await editor.getByRole('button',{name:'生成优化候选',exact:true}).click()
  await page.locator('.model-comparison').waitFor({timeout:60000});await page.locator('.comparison-loading').waitFor({state:'detached',timeout:60000})
  assert.equal(await original.getAttribute('aria-pressed'),'true');assert.equal(await optimized.getAttribute('aria-pressed'),'false')
  if(input.real){await editor.getByRole('button',{name:'按原图修复模型',exact:true}).click();await editor.getByText('输入网格或切口无法确认实体内部，本次保留原模型，未应用裁剪和封口。',{exact:true}).waitFor();assert.equal(await original.getAttribute('aria-pressed'),'true')}
  const canvases=page.locator('.model-comparison canvas'),boxes=await canvases.evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));assert.equal(boxes.length,2);assert.deepEqual(boxes[0],boxes[1])
  const buffers=()=>canvases.evaluateAll(nodes=>nodes.map(n=>n.toDataURL()))
  const pixels=await buffers(),divider=page.getByRole('slider',{name:'前后对比分隔线',exact:true}),handle=await divider.boundingBox(),view=await page.locator('.model-comparison').boundingBox()
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(view.x+view.width*.72,view.y+view.height*.5,{steps:8});await page.mouse.up()
  assert.ok(Number(await divider.getAttribute('aria-valuenow'))>=70);assert.deepEqual(await buffers(),pixels);assert.equal(await original.getAttribute('aria-pressed'),'true')
  const line=await page.locator('.comparison-line').boundingBox();await page.mouse.move(line.x+line.width/2,line.y+80);await page.mouse.down();await page.mouse.move(view.x+view.width*.35,line.y+80,{steps:5});await page.mouse.up();assert.ok(Number(await divider.getAttribute('aria-valuenow'))<40);assert.deepEqual(await buffers(),pixels);
  await divider.focus();await divider.press('Home');assert.equal(await divider.getAttribute('aria-valuenow'),'0');await divider.press('End');assert.equal(await divider.getAttribute('aria-valuenow'),'100');for(let i=0;i<5;i++)await divider.press('PageDown')
  await editor.getByRole('button',{name:'模型',exact:true}).click();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
  if(process.env.G_STUDIO_SCREENSHOT)await page.screenshot({path:process.env.G_STUDIO_SCREENSHOT.replace('.png','-model.png')});
  const modelPixels=await buffers();await page.mouse.move(view.x+view.width*.22,view.y+view.height*.5);await page.mouse.down();await page.mouse.move(view.x+view.width*.30,view.y+view.height*.54,{steps:8});await page.mouse.up();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
  const orbited=await buffers();assert.ok(orbited[0]!==modelPixels[0]&&orbited[1]!==modelPixels[1])
  await editor.getByRole('button',{name:'像素素材',exact:true}).click();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
  if(process.env.G_STUDIO_SCREENSHOT)await page.screenshot({path:process.env.G_STUDIO_SCREENSHOT})
  await editor.getByRole('button',{name:'保存并返回',exact:true}).click();await editor.waitFor({state:'detached'})
  const read=()=>page.evaluate(async()=>{const {partLibrary}=await window.mod('/src/shared/parts/library.ts');return JSON.parse(JSON.stringify(partLibrary['comparison-chair']))})
  const saved=await read();assert.equal(saved.model.original,true);assert.equal(saved.modelComparison.selected,'original');assert.ok(saved.modelComparison.candidate)
  await page.reload();await page.evaluate(async()=>{const {loadPartLibrary}=await window.mod('/src/shared/parts/library.ts');await loadPartLibrary();const {openPartEditor}=await window.mod('/src/shared/parts/editor-session.ts');openPartEditor({assetId:'comparison-chair',origin:'scene'})})
  await original.waitFor();await page.locator('.comparison-loading').waitFor({state:'detached'});assert.equal(await original.getAttribute('aria-pressed'),'true');assert.equal(await page.evaluate(()=>window.optimizers),0)
  await optimized.click();await editor.getByRole('button',{name:'保存并返回',exact:true}).click();await editor.waitFor({state:'detached'});const adopted=await read();assert.equal(adopted.modelComparison.selected,'optimized');assert.equal(adopted.model.original,undefined)
  await page.evaluate(async()=>{const {openPartEditor}=await window.mod('/src/shared/parts/editor-session.ts');openPartEditor({assetId:'comparison-chair',origin:'scene'})});await optimized.waitFor()
  await page.evaluate(()=>{window.RealWorker=window.Worker;window.Worker=class extends window.RealWorker{constructor(url,options){super(url,options);this.delay=String(url).includes('orientation-fit.worker')}postMessage(...args){if(this.delay)this.timer=setTimeout(()=>super.postMessage(...args),1000);else super.postMessage(...args)}terminate(){clearTimeout(this.timer);super.terminate()}}})
  await editor.getByRole('button',{name:'生成优化候选',exact:true}).click();await editor.getByRole('button',{name:'取消',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.part-properties').disabled);assert.equal(await optimized.getAttribute('aria-pressed'),'true')
  await page.evaluate(()=>{window.Worker=class extends window.RealWorker{constructor(url,options){super(url,options);this.fail=String(url).includes('orientation-fit.worker')}postMessage(...args){if(this.fail)queueMicrotask(()=>this.onmessage?.({data:{error:'simulated optimization failure'}}));else super.postMessage(...args)}}})
  await editor.getByRole('button',{name:'生成优化候选',exact:true}).click();await editor.locator('.editor-error').filter({hasText:'simulated optimization failure'}).waitFor();assert.equal(await optimized.getAttribute('aria-pressed'),'true');await page.evaluate(()=>{window.Worker=window.RealWorker})
  const portable=await page.evaluate(async()=>{const {partLibrary}=await window.mod('/src/shared/parts/library.ts'),{initializeComparison,comparisonCurrent}=await window.mod('/src/shared/parts/model-comparison.ts'),{portablePart}=await window.mod('/src/shared/parts/images.ts');const p=JSON.parse(JSON.stringify(partLibrary['comparison-chair']));p.image.uri='builtin:chair';p.image.width=367;p.image.height=522;delete p.modelComparison;const migrated=initializeComparison(p),copy=await portablePart(migrated);return {current:comparisonCurrent(copy),original:copy.modelComparison.source.mesh.uri===p.model.mesh.uri,candidate:!!copy.modelComparison.candidate}});assert.ok(portable.current&&portable.original&&portable.candidate);
  await page.evaluate(async()=>{const {generatedModels}=await window.mod('/src/shared/generation/models.ts'),{partLibrary}=await window.mod('/src/shared/parts/library.ts');const model=JSON.parse(JSON.stringify(partLibrary['comparison-chair'].model));model.mesh.sha256='c'.repeat(64);model.mesh.modelRevision=2;generatedModels.set('comparison-source',model)})
  await page.waitForFunction(()=>[...document.querySelectorAll('.version-choices button')][1]?.disabled);const unchanged=await read();assert.deepEqual(unchanged.model,adopted.model)
  const workersBefore=await page.evaluate(()=>window.optimizers);await editor.locator('.model-trigger').click();await page.getByRole('menuitemradio',{name:'已生成模型',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.part-properties').disabled);await page.waitForFunction(()=>document.querySelector('.version-choices button')?.getAttribute('aria-pressed')==='true');assert.ok(await optimized.isDisabled());assert.equal(await page.evaluate(()=>window.optimizers),workersBefore);
  assert.deepEqual(errors,[]);console.log('PASS: original default, opt-in adoption, split drag/keyboard, equal viewports, synchronized orbit, persistence, cancellation, stale-source safety; '+(input.real?'real generated chair fixture':'synthetic UI fixture'))
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
