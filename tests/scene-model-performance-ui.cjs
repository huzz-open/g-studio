const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(()=>{window.mod=p=>import(performance.getEntriesByType('resource').find(e=>e.name.includes(p))?.name||p);window.uploads=0;const upload=WebGL2RenderingContext.prototype.bufferData;WebGL2RenderingContext.prototype.bufferData=function(...args){window.uploads++;return upload.apply(this,args)}});
  await page.goto(process.env.G_STUDIO_TEST_URL||'http://127.0.0.1:5186/#/scene-lighting');
  await page.locator('.part-tile[data-asset-id]').first().waitFor();
  await page.waitForFunction(async()=>{const {useSceneTabs}=await window.mod('/src/modules/scene-lighting/store.ts');window.sceneState=useSceneTabs().activeInstance.value?.state;return window.sceneState?.items.length===6});
  await page.locator('.viewport-stage[aria-busy="false"]').waitFor();
  const points=await page.evaluate(async()=>{
   const {partLibrary}=await window.mod('/src/shared/parts/library.ts'),{partPixels}=await window.mod('/src/shared/parts/images.ts');
   const {imageBounds}=await window.mod('/src/modules/scene-lighting/part-model.ts'),{sceneCamera}=await window.mod('/src/modules/scene-lighting/scene-camera.ts');
   const {RIGHT,UP}=await window.mod('/src/modules/scene-lighting/model.ts'),{transform}=await window.mod('/src/modules/experiments/umbrella/math.ts');
   const rect=document.querySelector('.viewport-stage canvas').getBoundingClientRect(),state=window.sceneState,matrix=sceneCamera(state,rect.width/rect.height).matrix,result=[];
   for(const item of state.items){const p=partLibrary[item.assetId],{pixels}=await partPixels(p),b=imageBounds(p);let best=Infinity,px=0,py=0;
    for(let y=0;y<pixels.height;y+=3)for(let x=0;x<pixels.width;x+=3)if(pixels.data[(y*pixels.width+x)*4+3]>200){const d=(x/pixels.width-.5)**2+(y/pixels.height-.5)**2;if(d<best){best=d;px=x;py=y}}
    const x=b.left+(px+.5)/pixels.width*b.width,y=b.bottom+(1-(py+.5)/pixels.height)*b.height;
    const position=RIGHT.map((v,i)=>(i===0?item.x:i===2?item.z:0)+(v*x+UP[i]*y)*item.scale),clip=transform(matrix,position);
    result.push({x:rect.left+(clip[0]/clip[3]*.5+.5)*rect.width,y:rect.top+(.5-clip[1]/clip[3]*.5)*rect.height})
   }return result
  });
  const uploads=await page.evaluate(()=>window.uploads),selected=new Set(),latencies=[];
  for(const point of [...points,...points]){const start=Date.now();await page.mouse.click(point.x,point.y);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));latencies.push(Date.now()-start);selected.add(await page.evaluate(()=>window.sceneState.selected))}
  assert.ok(selected.size>=4,'actual canvas clicks must select distinct objects');
  const point=points[points.length-1],before=await page.evaluate(()=>JSON.stringify(window.sceneState.items));
  await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+25,point.y+15,{steps:8});await page.mouse.up();
  assert.notEqual(await page.evaluate(()=>JSON.stringify(window.sceneState.items)),before,'drag must still move the model');
  assert.equal(await page.evaluate(()=>window.uploads),uploads,'selection and drag must not upload meshes again');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({clickToFrameMs:latencies,selectedObjects:selected.size,newMeshUploads:0}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
