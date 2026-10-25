const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')
;(async () => {
 const browser = await chromium.launch({ executablePath: process.env.NORMAL_TEST_BROWSER || undefined, headless: true, args: ['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader'] })
 try {
 const page = await browser.newPage({ viewport: {width: 1450, height: 980} })
 await page.addInitScript(()=>{
   const NativeWorker=window.Worker
   window.normalJobs=[];window.normalWorkerDelay=0
   window.Worker=class extends NativeWorker {
     constructor(url,options){
       super(url,options)
       if(!String(url).includes('normal.worker'))return
       const job={started:performance.now(),finished:0,cancelled:false,strength:null}
       this.normalJob=job;window.normalJobs.push(job)
       const forwarded=new WeakSet()
       this.addEventListener('message',event=>{
         if(window.normalWorkerDelay&&!forwarded.has(event)){
           event.stopImmediatePropagation()
           setTimeout(()=>{const copy=new MessageEvent('message',{data:event.data});forwarded.add(copy);this.dispatchEvent(copy)},window.normalWorkerDelay)
         }else job.finished=performance.now()
       })
     }
     postMessage(data,...args){if(this.normalJob)this.normalJob.strength=data.settings.normalStrength;return super.postMessage(data,...args)}
     terminate(){if(this.normalJob&&!this.normalJob.finished)this.normalJob.cancelled=true;super.terminate()}
   }
 })
 const errors=[]; page.on('pageerror', e=>errors.push(e.message))
 await page.goto((process.env.NORMAL_TEST_URL || 'http://127.0.0.1:5178/').replace(/\/$/, '') + '/#/sprite-slicer')
 await page.waitForSelector('.sidebar-content')
 await page.evaluate(async () => {
   // Use the mounted instance, including when Vite has hot-reloaded its module URL.
   const inst=document.querySelector('.sidebar-content').__vueParentComponent.props.store
   const cv=document.createElement('canvas'); cv.width=128;cv.height=64;const ctx=cv.getContext('2d')
   const gradient=ctx.createLinearGradient(4,4,55,50);gradient.addColorStop(0,'#a2ce68');gradient.addColorStop(1,'#305a29')
   ctx.fillStyle=gradient;ctx.fillRect(4,4,48,48);ctx.clearRect(15,15,6,6)
   ctx.fillStyle='#d98040';ctx.fillRect(72,10,40,42)
   inst.setPendingRestore([{name:'房屋',rect:[0,0,60,60]},{name:'树木',rect:[64,0,60,60]}])
   await inst.loadFile(new File([await new Promise(r=>cv.toBlob(r))],'test.png',{type:'image/png'}))
   window.testStore=inst
 })
 await page.locator('.grid-rect').first().click()
 assert.equal(await page.locator('.ic-overlay').count(),0,'single click only selects the sprite')
 await page.locator('.grid-rect').first().dblclick()
 await page.locator('.ic-overlay .ic-image').waitFor({state:'visible'})
 assert.equal(await page.locator('.ic-overlay-title').innerText(),'房屋')
 await page.getByTitle('关闭',{exact:true}).last().click()
 await page.locator('.grid-rect').first().hover()
 await page.getByTitle('放大查看',{exact:true}).click()
 const area=page.locator('.ic-overlay .pzv-container'), bulb=page.getByRole('button',{name:'灯光',exact:true})
 await page.locator('.ic-overlay .ic-image').waitFor({state:'visible'})
 const box=await area.boundingBox()
 assert.equal(await page.locator('.normal-canvas').evaluate(c=>c.style.visibility),'hidden')
 assert.equal(await page.locator('.normal-canvas').getAttribute('width'),null,'opening the preview must not initialize the GPU renderer')
 assert.equal(await page.locator('.ic-overlay .ic-image').evaluate(img=>getComputedStyle(img).visibility),'visible')
 await page.mouse.move(box.x+box.width*.3,box.y+box.height*.35)
 await page.mouse.down({button:'right'})
 await page.waitForFunction(()=>document.querySelector('.normal-canvas')?.dataset.mode==='lighting')
 assert.equal(await bulb.getAttribute('aria-pressed'),'true')
 await page.mouse.up({button:'right'})
 assert.equal(await bulb.getAttribute('aria-pressed'),'false')
 assert.equal(await page.locator('.normal-canvas').evaluate(e=>e.dataset.mode),'original')
 await bulb.click()
 await page.mouse.move(box.x+box.width*.4,box.y+box.height*.3)
 assert.equal(await bulb.getAttribute('aria-pressed'),'true')
 await page.mouse.down({button:'right'});await page.mouse.up({button:'right'})
 assert.equal(await bulb.getAttribute('aria-pressed'),'true','shortcut does not disable pinned light')
 assert.equal(await page.locator('.normal-panel').count(),1)
 await page.waitForFunction(()=>!document.querySelector('.normal-status'))
 const drag=await page.evaluate(async()=>{
   window.normalJobs=[];window.normalWorkerDelay=180
   const input=document.querySelector('.normal-panel input[type=range]')
   for(let i=0;i<18;i++){
     input.value=String(0.2+i*0.1);input.dispatchEvent(new Event('input',{bubbles:true}))
     await new Promise(r=>setTimeout(r,40))
   }
   const during=window.normalJobs.filter(j=>j.finished).length
   input.value='2.05';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))
   return {during}
 })
 assert.ok(drag.during>=2,'continuous dragging must publish results before release, even with slow computation')
 await page.waitForFunction(()=>!document.querySelector('.normal-status'))
 const jobs=await page.evaluate(()=>{window.normalWorkerDelay=0;return window.normalJobs})
 assert.equal(jobs.at(-1).strength,2.05,'release must compute the final value')
 assert.ok(jobs.length<19,'intermediate settings must be coalesced')
 assert.ok(jobs.every(j=>j.finished&&!j.cancelled),'dragging must not starve running computations by cancelling them')
 for(let i=1;i<jobs.length;i++)assert.ok(jobs[i].started>=jobs[i-1].finished,'only one generation runs at a time')
 console.log('Live drag previews, coalescing, single-flight scheduling and final-value flush passed')
 await page.getByRole('button',{name:'重置整体强度',exact:true}).click()
 await page.waitForFunction(()=>!document.querySelector('.normal-status'))
 await page.getByRole('spinbutton',{name:'轮廓体积',exact:true}).fill('2')
 await page.getByRole('spinbutton',{name:'轮廓体积',exact:true}).press('Tab')
 await page.getByRole('spinbutton',{name:'整体强度',exact:true}).fill('3')
 await page.getByRole('spinbutton',{name:'整体强度',exact:true}).press('Tab')
 await page.getByRole('button',{name:'重置整体强度',exact:true}).click()
 assert.equal(await page.getByRole('spinbutton',{name:'整体强度',exact:true}).inputValue(),'1.5')
 assert.equal(await page.getByRole('spinbutton',{name:'轮廓体积',exact:true}).inputValue(),'2')
 await page.locator('.normal-panel summary').click()
 await page.getByRole('group',{name:'法线格式',exact:true}).getByRole('button',{name:'DirectX',exact:true}).click()
 await page.getByRole('checkbox',{name:'翻转 X',exact:true}).check()
 await page.getByRole('checkbox',{name:'翻转 Y',exact:true}).check()
 await page.getByRole('button',{name:'重置翻转 X',exact:true}).click()
 assert.equal(await page.getByRole('checkbox',{name:'翻转 X',exact:true}).isChecked(),false)
 assert.equal(await page.getByRole('checkbox',{name:'翻转 Y',exact:true}).isChecked(),true)
 await page.getByRole('button',{name:'重置法线格式',exact:true}).click()
 assert.ok((await page.getByRole('group',{name:'法线格式',exact:true}).getByRole('button',{name:'OpenGL',exact:true}).getAttribute('class')).includes('active'))
 await page.getByRole('slider',{name:'亮度',exact:true}).evaluate(e=>{e.value='2';e.dispatchEvent(new Event('input',{bubbles:true}))})
 await page.getByRole('button',{name:'重置亮度',exact:true}).click()
 assert.equal(await page.getByRole('slider',{name:'亮度',exact:true}).inputValue(),'1')
 if(process.env.NORMAL_TEST_SCREENSHOT)await page.locator('.normal-panel').screenshot({path:process.env.NORMAL_TEST_SCREENSHOT.replace('.png','-panel.png')})
 await page.getByRole('button',{name:'重置轮廓体积',exact:true}).click()
 await page.getByRole('button',{name:'重置翻转 Y',exact:true}).click()
 await page.waitForFunction(()=>!document.querySelector('.normal-status'))
 assert.equal(await page.getByRole('button',{name:'重置整体强度',exact:true}).count(),0,'unchanged properties must hide their reset control')
 console.log('Per-property resets preserve other normal, axis and lighting settings')
 await page.getByRole('spinbutton',{name:'整体强度',exact:true}).fill('2.3')
 await page.getByRole('spinbutton',{name:'整体强度',exact:true}).press('Tab')
 await page.waitForFunction(()=>!document.querySelector('.normal-status'))
 assert.deepEqual(await page.evaluate(()=>testStore.state.sprites.map(s=>s.normalSettings?.normalStrength ?? null)),[2.3,null])
 if (process.env.NORMAL_TEST_SCREENSHOT) await page.screenshot({path:process.env.NORMAL_TEST_SCREENSHOT})
 await bulb.click()
 await page.mouse.move(box.x+box.width*.3,box.y+box.height*.35);await page.mouse.down({button:'right'})
 await page.evaluate(()=>window.dispatchEvent(new Event('blur')))
 assert.equal(await bulb.getAttribute('aria-pressed'),'false')
 await page.mouse.up({button:'right'})
 await page.getByRole('button',{name:'法线',exact:true}).click()
 assert.equal(await page.locator('.normal-canvas').evaluate(e=>e.style.visibility),'visible')
 await page.getByRole('button',{name:'折叠参数'}).click()
 assert.equal(await page.locator('.normal-panel').count(),0)
 await page.getByTitle('关闭',{exact:true}).last().click()
 await page.locator('.grid-rect').first().hover();await page.getByTitle('放大查看',{exact:true}).click()
 await bulb.click()
 assert.equal(await page.getByRole('spinbutton',{name:'整体强度',exact:true}).inputValue(),'2.3')
 await bulb.click()
 assert.equal(await bulb.getAttribute('aria-pressed'),'false')
 const output=await page.evaluate(async()=>{
   const {buildOutput,pairedNames}=await import('/src/modules/sprite-slicer/core/export/output.ts')
   const files=await buildOutput(testStore.state.sprites,testStore.state.imgSize,'test',{composite:true,sprites:true,normals:true,meta:true})
   const zipModule=await import('/node_modules/.vite/deps/jszip.js');const zip=await zipModule.default.loadAsync(await files.find(f=>f.name.endsWith('.zip')).blob.arrayBuffer())
   const sizes=[]
   for(const file of files.filter(f=>f.name.endsWith('.png'))) {const bitmap=await createImageBitmap(file.blob);sizes.push([file.name,bitmap.width,bitmap.height]);bitmap.close()}
   for(const filename of Object.keys(zip.files)) {const bitmap=await createImageBitmap(new Blob([await zip.file(filename).async('arraybuffer')],{type:'image/png'}));sizes.push([filename,bitmap.width,bitmap.height]);bitmap.close()}
   const snapshot=testStore.getSpriteSnapshot();testStore.history.undo();const undo=testStore.state.sprites[0].normalSettings;testStore.history.redo();const redo=testStore.state.sprites[0].normalSettings
   return {files:files.map(f=>f.name),zip:Object.keys(zip.files),sizes,snapshot,undo,redo,names:pairedNames([{name:'a'},{name:'a_normal'},{name:'A.png'}],true)}
 })
 assert.deepEqual(output.files,['test.png','test_normal.png','test.json','test-sprites.zip'])
 assert.deepEqual(output.zip,['房屋.png','房屋_normal.png','树木.png','树木_normal.png'])
 assert.deepEqual(output.sizes.map(s=>s.slice(1)),[[128,64],[128,64],[60,60],[60,60],[60,60],[60,60]])
 assert.equal(output.snapshot[0].normalSettings.normalStrength,2.3)
 assert.equal(output.undo,undefined);assert.equal(output.redo.normalStrength,2.3)
 assert.deepEqual(output.names,['a','a_normal-2','A-2'])
 console.log('UI, worker, per-sprite config, history, paired exports passed',JSON.stringify(output.sizes))
 await page.getByTitle('关闭',{exact:true}).last().click()
 await page.evaluate(async()=>{
   const {openWorkspace}=await import('/src/shared/workspace/workspace-manager.ts')
   await openWorkspace(await navigator.storage.getDirectory())
   const {resolveDir,writeFile}=await import('/src/shared/workspace/fs.ts')
   const {writeGsFile}=await import('/src/shared/gs-format/writer.ts')
   const root=await resolveDir('')
   const cv=document.createElement('canvas');cv.width=128;cv.height=64;cv.getContext('2d').drawImage(testStore.state.sourceImage,0,0)
   await writeFile(root,'source.png',await new Promise(r=>cv.toBlob(r)))
   await writeGsFile({path:'test.gs',type:3,data:{texture:'./source.png',size:[128,64],isComposite:false,sliceConfig:testStore.getSliceConfig(),sprites:testStore.getSpriteSnapshot()}})
   testStore.state.gsPath='test.gs';testStore.state.gsTexturePath='./source.png';testStore.state.gsLastKnownVersion=1
 })
 await page.getByRole('checkbox',{name:'散件 ZIP'}).check()
 await page.getByRole('switch',{name:/同时导出法线/}).check()
 await page.getByRole('button',{name:'保存到工作区',exact:true}).click()
 await page.waitForFunction(()=>!document.querySelector('.output-progress'))
 const persisted=await page.evaluate(async()=>{
   const {resolveDir,readTextFile}=await import('/src/shared/workspace/fs.ts')
   const root=await resolveDir(''),dir=await resolveDir('spritesheets')
   const files=[];for await(const name of dir.keys())files.push(name)
   const data=JSON.parse(await readTextFile(root,'test.gs'))
   const {getSlicerInstance}=await import('/src/modules/sprite-slicer/store.ts')
   const loaded=getSlicerInstance('reload-test');await loaded.loadFromGsFile('test.gs')
   const settings=loaded.state.sprites.map(s=>s.normalSettings?.normalStrength??null)
   loaded.dispose()
   return {files,data,settings}
 })
 assert.deepEqual(persisted.files.sort(),['test.png','test_normal.png','test-sprites.zip','test.json'].sort())
 assert.deepEqual(persisted.settings,[2.3,null]);assert.equal(persisted.data.version,2)
 console.log('Workspace output and saved project reload passed')
 const arranged=await page.evaluate(async()=>{
   const {nextTick}=await import('/node_modules/.vite/deps/vue.js')
   testStore.state.arrangeMode='standardize';await nextTick()
   const before=testStore.state.sprites.map(s=>({rect:{...s.rect},pixels:[...s.imageData.data],settings:s.normalSettings?.normalStrength??null}))
   await testStore.saveToGsFile()
   const {getSlicerInstance}=await import('/src/modules/sprite-slicer/store.ts')
   const loaded=getSlicerInstance('arranged-reload');await loaded.loadFromGsFile('test.gs')
   const after=loaded.state.sprites.map(s=>({rect:{...s.rect},pixels:[...s.imageData.data],settings:s.normalSettings?.normalStrength??null}))
   loaded.dispose();return {before,after}
 })
 assert.deepEqual(arranged.after,arranged.before)
 const shading=await page.evaluate(async()=>{
   const {createLighting,previewLight}=await import('/src/modules/sprite-slicer/core/normal/lighting.ts')
   const canvas=document.createElement('canvas'),color=new ImageData(new Uint8ClampedArray([100,100,100,128]),1,1)
   const renderer=createLighting(canvas,color),gl=canvas.getContext('webgl')
   renderer.update(new ImageData(new Uint8ClampedArray([128,230,204,128]),1,1))
   Object.assign(previewLight,{brightness:1,height:0.6,ambient:0,color:'#ffffff'})
   const sample=y=>{renderer.draw(.5,y,false,false);const p=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p]}
   const above=sample(-1),below=sample(2);renderer.dispose();return {above,below}
 })
 assert.ok(shading.above[0]>shading.below[0]);assert.equal(shading.above[3],128)
 console.log('Arranged project reload, light Y orientation and translucent alpha passed')
 const transparency=await page.evaluate(async()=>{
   const {createLighting,previewLight}=await import('/src/modules/sprite-slicer/core/normal/lighting.ts')
   const alpha=[0,1,8,128,255],color=new ImageData(5,1),normal=new ImageData(5,1)
   alpha.forEach((a,i)=>{color.data.set([255,255,0,a],i*4);normal.data.set([128,128,255,a],i*4)})
   const canvas=document.createElement('canvas'),renderer=createLighting(canvas,color),gl=canvas.getContext('webgl')
   renderer.update(normal);Object.assign(previewLight,{brightness:3,ambient:1,color:'#ffffff'})
   const modes=[]
   for(const map of [false,true]){renderer.draw(2,0,map,false);const pixels=new Uint8Array(20);gl.readPixels(0,0,5,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);modes.push([...pixels])}
   const premultiplied=gl.getContextAttributes().premultipliedAlpha
   renderer.dispose();return {alpha,modes,premultiplied}
 })
 assert.equal(transparency.premultiplied,true)
 for(const pixels of transparency.modes)transparency.alpha.forEach((a,i)=>{
   assert.equal(pixels[i*4+3],a)
   for(let channel=0;channel<3;channel++)assert.ok(pixels[i*4+channel]<=a,'hidden RGB must not leak into the browser compositor')
 })
 console.log('Zero and near-zero alpha stay transparent under maximum brightness and in normal view')
 // A displayed PNG can be replaced while a previous pixel buffer still exists.
 const canonical=await page.evaluate(async()=>{
   const sprite=testStore.state.sprites[0]
   const canvas=document.createElement('canvas');canvas.width=9;canvas.height=7
   const ctx=canvas.getContext('2d');ctx.fillStyle='#dc7633';ctx.fillRect(1,1,2,5);ctx.fillRect(1,4,6,2)
   sprite.dataUrl=canvas.toDataURL();sprite.rect={x:0,y:0,w:9,h:7}
   const {spritePixels}=await import('/src/modules/sprite-slicer/core/normal/source.ts')
   const decoded=await spritePixels(sprite)
   const {buildOutput}=await import('/src/modules/sprite-slicer/core/export/output.ts')
   const files=await buildOutput([sprite],{w:9,h:7},'canonical',{composite:true,sprites:false,normals:true,meta:false})
   const sizes=[]
   for(const file of files){const bitmap=await createImageBitmap(file.blob);sizes.push([bitmap.width,bitmap.height]);bitmap.close()}
   return {decoded:[decoded.width,decoded.height],stale:[sprite.imageData.width,sprite.imageData.height],sizes}
 })
 assert.deepEqual(canonical.decoded,[9,7]);assert.notDeepEqual(canonical.stale,[9,7])
 assert.deepEqual(canonical.sizes,[[9,7],[9,7]])
 await page.locator('.grid-rect').first().dispatchEvent('mouseenter');await page.getByTitle('放大查看',{exact:true}).click()
 await page.getByRole('button',{name:'灯光',exact:true}).click()
 await page.waitForFunction(()=>document.querySelector('.normal-canvas')?.dataset.mode==='lighting')
 assert.deepEqual(await page.locator('.normal-canvas').evaluate(c=>[c.width,c.height]),[9,7])
 // Replace the displayed source while the light is active, including its dimensions.
 await page.evaluate(()=>{const s=testStore.state.sprites[0],c=document.createElement('canvas');c.width=11;c.height=13;c.getContext('2d').fillRect(2,3,4,5);s.dataUrl=c.toDataURL();s.rect={x:0,y:0,w:11,h:13}})
 await page.waitForFunction(()=>{const c=document.querySelector('.normal-canvas');return c?.style.visibility==='visible'&&c.width===11&&c.height===13})
 await page.getByRole('button',{name:'灯光',exact:true}).click()
 assert.equal(await page.locator('.normal-canvas').evaluate(c=>c.dataset.mode),'original')
 if(await page.getByRole('button',{name:'折叠参数'}).count())await page.getByRole('button',{name:'折叠参数'}).click()
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
 const sourceClip=await page.locator('.ic-overlay .ic-image').boundingBox()
 await page.mouse.move(2,2)
 const originalScreenshot=await page.screenshot({clip:sourceClip})
 await page.getByRole('button',{name:'灯光',exact:true}).click()
 assert.equal(await page.locator('.normal-panel').count(),1)
 await page.locator('.normal-panel .normal-row').filter({hasText:/^亮度/}).locator('input').evaluate(e=>{e.value='0';e.dispatchEvent(new Event('input',{bubbles:true}))})
 await page.locator('.normal-panel .normal-row').filter({hasText:/^环境亮度/}).locator('input').evaluate(e=>{e.value='1';e.dispatchEvent(new Event('input',{bubbles:true}))})
 await page.getByRole('button',{name:'折叠参数'}).click();await page.mouse.move(2,2)
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
 await page.getByRole('button',{name:'灯光',exact:true}).click();await page.mouse.move(2,2)
 assert.equal(await page.locator('.normal-canvas').evaluate(c=>c.style.visibility),'hidden')
 assert.equal(await page.locator('.ic-overlay .ic-image').evaluate(img=>getComputedStyle(img).visibility),'visible')
 assert.ok(originalScreenshot.equals(await page.screenshot({clip:sourceClip})),'turning lighting off must restore the unprocessed native image exactly')
 console.log('Displayed PNG remains the source for lighting and export despite stale pixel buffers')
 assert.deepEqual(errors,[])
 console.log('ERRORS',errors)
 } finally { await browser.close() }
})().catch(e=>{console.error(e);process.exit(1)})


