const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
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


(async()=>{
 const browser=await chromium.launch({channel:process.env.G_STUDIO_TEST_BROWSER_CHANNEL||'chrome',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>{window.mod=path=>import(performance.getEntriesByType('resource').find(e=>e.name.includes(path))?.name||path)});
 await page.goto(process.env.G_STUDIO_TEST_URL||'http://127.0.0.1:5173/#/scene-lighting');
 await page.evaluate(async uri=>{
  const {createPart}=await window.mod('/src/shared/parts/schema.ts');
  const {loadPartLibrary,savePart}=await window.mod('/src/shared/parts/library.ts');await loadPartLibrary();
  const canvas=document.createElement('canvas');canvas.width=100;canvas.height=200;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#86a36b';ctx.fillRect(10,30,60,150);
  const part=createPart('Alignment test',{uri:canvas.toDataURL(),width:100,height:200},'alignment-test');
  part.version=2;part.geometry={kind:'mesh',size:[2,2,2],mesh:{uri,sha256:'a'.repeat(64),inputSha256:'b'.repeat(64),providerId:'test',warnings:[]}};
  await savePart(part);const {openPartEditor}=await window.mod('/src/shared/parts/editor-session.ts');openPartEditor({assetId:part.id,origin:'scene'});
 },'data:model/gltf-binary;base64,'+tetrahedron().toString('base64'));
 const align=page.getByRole('button',{name:'自动对齐图片',exact:true});await align.waitFor({timeout:60000}).catch(async e=>{console.log(errors);console.log(await page.locator('body').innerText());throw e});
 await page.waitForFunction(()=>!document.querySelector('.part-properties').disabled);
 await page.locator('.part-editor .part-preview canvas').waitFor();
 await align.click();await page.waitForFunction(()=>!document.querySelector('.part-properties').disabled);
 await page.getByRole('button',{name:'按原图修复几何',exact:true}).click();
 await page.getByRole('switch',{name:'启用几何修复',exact:true}).waitFor();
 await page.waitForFunction(()=>!document.querySelector('.part-properties').disabled);
 assert.equal(await page.getByRole('switch',{name:'启用几何修复',exact:true}).isChecked(),true);
 await page.getByRole('button',{name:'保存并返回',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.part-editor'));
 await page.waitForFunction(()=>!document.querySelector('.part-editor'));
 const saved=await page.evaluate(async()=>{const {partLibrary}=await window.mod('/src/shared/parts/library.ts');return JSON.parse(JSON.stringify(partLibrary['alignment-test']))});
 assert.ok(saved.geometry.imageFit);assert.ok(saved.alignment.height>0);assert.ok(saved.geometry.repair.enabled);const sourceMesh=saved.geometry.mesh.uri;
 const repairChecks=await page.evaluate(async()=>{
   const {partLibrary}=await window.mod('/src/shared/parts/library.ts'),{buildPartGeometry,alignedBounds}=await window.mod('/src/modules/scene-lighting/part-geometry.ts'),{repairKey,repairSpec}=await window.mod('/src/modules/scene-lighting/geometry-repair.ts');
   const p=JSON.parse(JSON.stringify(partLibrary['alignment-test'])),data={width:0,height:0,data:new Uint8ClampedArray()};const repaired=buildPartGeometry(p,data).triangles.length;p.geometry.repair.enabled=false;const disabled=buildPartGeometry(p,data).triangles.length;delete p.geometry.repair;const original=buildPartGeometry(p,data).triangles.length;
   const {createBuiltinParts}=await window.mod('/src/shared/parts/builtins.ts'),{portablePart,partPixels}=await window.mod('/src/shared/parts/images.ts');const builtin=createBuiltinParts()[0];builtin.version=2;builtin.geometry=JSON.parse(JSON.stringify(p.geometry));const {pixels}=await partPixels(builtin),mesh=buildPartGeometry(builtin,pixels),b=alignedBounds(builtin,mesh);builtin.geometry.repair=repairSpec(builtin,pixels,[b.left,b.bottom,b.width,b.height]);const portable=await portablePart(builtin);
   return {status:partLibrary['alignment-test'].geometry.repair.status,repaired,disabled,original,portableValid:portable.geometry.repair.key===repairKey(portable),sourceUnchanged:builtin.image.uri.startsWith('builtin:')};
 });
 assert.equal(repairChecks.disabled,repairChecks.original);assert.ok(repairChecks.repaired>0);if(repairChecks.status!=='repaired')assert.equal(repairChecks.repaired,repairChecks.original);assert.ok(repairChecks.portableValid&&repairChecks.sourceUnchanged);

 await page.reload();
 const restored=await page.evaluate(async()=>{const {loadPartLibrary,partLibrary}=await window.mod('/src/shared/parts/library.ts');await loadPartLibrary();const p=partLibrary['alignment-test'];const {openPartEditor}=await window.mod('/src/shared/parts/editor-session.ts');openPartEditor({assetId:p.id,origin:'scene'});return JSON.parse(JSON.stringify(p))});
 assert.deepEqual(restored.geometry.repair,saved.geometry.repair);assert.equal(restored.geometry.mesh.uri,sourceMesh);assert.deepEqual(restored.geometry.imageFit,saved.geometry.imageFit);assert.equal(restored.alignment.height,saved.alignment.height);
 assert.equal(restored.geometry.imageFit.mode,'similarity');assert.equal(restored.geometry.imageFit.orientation.method,'surface-preserving-v2');
 assert.ok(restored.geometry.imageFit.orientation.score>=restored.geometry.imageFit.orientation.initialScore);
 // Hold only the next worker message so cancellation is deterministic on fast CPUs.
 await page.evaluate(()=>{window.NativeWorker=window.Worker;window.Worker=class extends window.NativeWorker{
  constructor(url,options){super(url,options);this.delay=String(url).includes('orientation-fit.worker')}
  postMessage(...args){if(this.delay)this.timer=setTimeout(()=>super.postMessage(...args),1000);else super.postMessage(...args)}
  terminate(){clearTimeout(this.timer);super.terminate()}
 }});
 await page.getByRole('button',{name:'自动对齐图片',exact:true}).click();
 await page.getByRole('button',{name:'取消',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.part-properties').disabled);
 await page.evaluate(()=>{window.Worker=window.NativeWorker});
 assert.equal(await page.locator('.part-editor .editor-error').count(),0);
 assert.ok(!(await page.locator('.part-editor header').innerText()).includes('●'),'cancel must not dirty the saved draft');
 const heading=page.getByRole('slider',{name:'模型朝向',exact:true});await heading.focus();await heading.press('ArrowRight');
 const editedHeading=Number(await heading.inputValue());
 await page.getByText('模型或对齐参数已改变，旧修复已停用，请重新修复。',{exact:true}).waitFor();

 await page.getByRole('button',{name:'保存并返回',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.part-editor'));
 const manual=await page.evaluate(async()=>{const {partLibrary}=await window.mod('/src/shared/parts/library.ts');return partLibrary['alignment-test'].geometry.imageFit.rotation[1]});assert.equal(manual,editedHeading);
 const expected=await page.evaluate(async()=>{
  const {createPart}=await window.mod('/src/shared/parts/schema.ts');const {savePart,partLibrary}=await window.mod('/src/shared/parts/library.ts');
  const existing=partLibrary['alignment-test'];const part=createPart('New selection',existing.image,'selection-test');part.version=2;
  const geometry=JSON.parse(JSON.stringify(existing.geometry));delete geometry.imageFit;delete geometry.repair;part.geometryAlternatives=[geometry];
  const {partPixels}=await window.mod('/src/shared/parts/images.ts');const {buildPartGeometry,alignedBounds}=await window.mod('/src/modules/scene-lighting/part-geometry.ts');
  const {pixels}=await partPixels(part);const bounds=alignedBounds(part,buildPartGeometry(part,pixels));
  await savePart(part);const {openPartEditor}=await window.mod('/src/shared/parts/editor-session.ts');openPartEditor({assetId:part.id,origin:'scene'});return bounds;
 });
 await page.locator('.part-editor .geometry-trigger').click();
 await page.getByRole('menuitemradio',{name:'已生成模型',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.part-editor .geometry-trigger')?.textContent.includes('已生成模型'));
 assert.equal(await page.locator('.part-editor .editor-error').count(),0);
 await page.waitForFunction(()=>!document.querySelector('.part-properties').disabled);
 await page.getByRole('button',{name:'保存并返回',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.part-editor'));
 const selected=await page.evaluate(async()=>{const {partLibrary}=await window.mod('/src/shared/parts/library.ts');const p=partLibrary['selection-test'];const {buildPartGeometry,alignedBounds}=await window.mod('/src/modules/scene-lighting/part-geometry.ts');return {fit:p.geometry.imageFit,bounds:alignedBounds(p,buildPartGeometry(p,{width:0,height:0,data:new Uint8ClampedArray()}))}});
 assert.ok(selected.fit);for(const key of Object.keys(expected))assert.ok(Math.abs(selected.bounds[key]-expected[key])<1e-6);
 await page.evaluate(async()=>{const {openPartEditor}=await window.mod('/src/shared/parts/editor-session.ts');openPartEditor({assetId:'alignment-test',origin:'scene'})});

 await page.locator('.part-editor .part-preview canvas').waitFor();
 await page.waitForTimeout(1500);
 assert.equal(await page.locator('.part-editor .editor-error').count(),0);assert.deepEqual(errors,[]);
 if(process.env.G_STUDIO_SCREENSHOT)await page.screenshot({path:process.env.G_STUDIO_SCREENSHOT});
 console.log('PASS: similarity pose metadata, cancellation leaves draft intact, manual heading persists; legacy mesh auto-fit, manual realignment, selecting a new mesh preserves image dimensions, WebGL preview, save and reload');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
