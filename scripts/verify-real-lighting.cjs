// Production WebGL renderer verification using existing generated GLBs.
// Run against a local Vite server; no production shaders or materials are changed.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = path.resolve(process.argv[3]||'output/lighting-real-20261029'), reportPath=process.argv[2]||'output/alignment-real-20261029/report.json', report = JSON.parse(fs.readFileSync(reportPath,'utf8'))
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
fs.mkdirSync(root,{recursive:true})
const harness='<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#15191e}canvas{width:1120px;height:720px;display:block}</style><canvas id="view"></canvas>'
if(!fs.existsSync(path.join(root,'harness.html'))||fs.readFileSync(path.join(root,'harness.html'),'utf8')!==harness)fs.writeFileSync(path.join(root,'harness.html'),harness)
const runs = report.runs.map(r=>{
  const image=fs.readFileSync(r.source),mesh=fs.readFileSync(r.mesh)
  if(sha(image)!==r.inputSha256||sha(mesh)!==r.meshSha256)throw Error('Source hash mismatch')
  return {...r,imageUri:'data:image/png;base64,'+image.toString('base64'),meshUri:'data:model/gltf-binary;base64,'+mesh.toString('base64')}
})
;(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true})
  try{
    const page=await browser.newPage({viewport:{width:1120,height:720},deviceScaleFactor:1}),errors=[]
    page.on('pageerror',error=>errors.push(String(error)))
    // This is a fixed rendering capture, not an interactive dev session. Vite
    // reload notifications from newly written report files must not interrupt it.
    await page.routeWebSocket(/ws:\/\//,socket=>socket.close())
    await page.goto((process.env.G_STUDIO_TEST_URL||'http://127.0.0.1:5173')+'/'+path.relative(process.cwd(),path.join(root,'harness.html')).split(path.sep).join('/'))
    const results=[]
    for(const input of runs){
      const result=await page.evaluate(async input=>{
        const {createSceneRenderer}=await import('/src/modules/scene-lighting/renderer.ts')
        const {createBuiltinParts}=await import('/src/shared/parts/builtins.ts')
        const {decodeMesh}=await import('/src/shared/parts/mesh.ts')
        const {meshExtents,alignedBounds,buildPartGeometry}=await import('/src/modules/scene-lighting/part-geometry.ts')
        const {createScene,RIGHT,UP}=await import('/src/modules/scene-lighting/model.ts')
        const canvas=document.querySelector('canvas'),renderer=createSceneRenderer(canvas,{selectionOutline:false})
        const part=createBuiltinParts().find(p=>p.id===`example:${input.id}`)
        part.version=2;part.image={uri:input.imageUri,width:input.width,height:input.height}
        part.geometry={kind:'mesh',size:meshExtents(decodeMesh(input.meshUri)).size,mesh:{uri:input.meshUri,sha256:input.meshSha256,inputSha256:input.inputSha256,providerId:input.provider,warnings:[]}}
        const before=JSON.parse(JSON.stringify(part)),after=JSON.parse(JSON.stringify(part))
        after.geometry.imageFit=input.fit;after.alignment.height=input.bounds.height/after.alignment.scale
        if(input.repair){before.geometry.imageFit=input.fit;before.alignment.height=after.alignment.height;after.geometry.repair=input.repair}
        const state={...createScene(),scene:'open',selected:'',showNames:false,zoom:6.8,target:[0,.85,0],ambient:.22,power:24,filtered:true,shadows:true,
          items:[{id:'subject',assetId:part.id,scale:1,x:0,z:0,visible:true,casts:true,receives:true}]}
        const lights=[{id:'point',label:'左前上方点光源',lightKind:'point',light:[-3,4,4],power:24},
          {id:'directional',label:'右侧低角度方向光',lightKind:'directional',sun:{azimuth:70,elevation:28,intensity:1.1}},
          {id:'point-right',label:'右前方点光源',lightKind:'point',light:[3,2.8,3],power:18}]
        const images={},coverage={},captures=[],fieldDiagnostics={}
        const gl=canvas.getContext('webgl2'),nativeRead=gl.readPixels.bind(gl)
        // Observe the production field readback without changing uniforms or output.
        let baked
        gl.readPixels=function(...args){nativeRead(...args);if(args[2]===input.width&&args[3]===input.height)baked=new Uint8Array(args[6])}
        for(const [stage,asset] of [['before',before],['after',after]]){
          await renderer.syncAssets([asset]);coverage[stage]=renderer.coverage()[asset.id]
          const diagnostic=document.createElement('canvas');diagnostic.width=input.width;diagnostic.height=input.height
          const ctx=diagnostic.getContext('2d'),image=await new Promise(resolve=>{const i=new Image();i.onload=()=>resolve(i);i.src=input.imageUri})
          ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,input.width,input.height)
          let opaque=0,coveredOpaque=0,extra=0
          for(let y=0;y<input.height;y++)for(let x=0;x<input.width;x++){
            const i=(y*input.width+x)*4
            const covered=baked[((input.height-1-y)*input.width+x)*4+3]>0
            if(pixels.data[i+3]<21){if(covered){extra++;pixels.data.set([69,196,227,255],i)}else pixels.data[i+3]=0;continue}
            opaque++;if(covered)coveredOpaque++
            pixels.data.set(covered?[77,174,115,255]:[244,150,67,255],i)
          }
          fieldDiagnostics[stage]={opaque,coveredOpaque,missing:opaque-coveredOpaque,extraInsideImage:extra}
          ctx.putImageData(pixels,0,0);images[stage+'-coverage']=diagnostic.toDataURL()
          for(const light of lights){
            Object.assign(state,light);state.mode='sprites';state.shadows=true
            renderer.render(state);images[stage+'-'+light.id+'-lit']=canvas.toDataURL()
            state.shadows=false;renderer.render(state);images[stage+'-'+light.id+'-no-shadow']=canvas.toDataURL()
            state.shadows=true;state.mode='geometry';renderer.render(state);images[stage+'-'+light.id+'-geometry']=canvas.toDataURL()
            state.mode='visibility';renderer.render(state);images[stage+'-'+light.id+'-visibility']=canvas.toDataURL()
            captures.push({stage,light:JSON.parse(JSON.stringify(light)),state:JSON.parse(JSON.stringify({...state,mode:'sprites'}))})
          }
          const bounds=alignedBounds(asset,buildPartGeometry(asset,{width:0,height:0,data:new Uint8ClampedArray()}))
          const location=(x,y)=>renderer.project(RIGHT.map((v,j)=>v*x+UP[j]*y),state)
          const tl=location(bounds.left,bounds.bottom+bounds.height),br=location(bounds.left+bounds.width,bounds.bottom)
          if(stage==='before'){
            const screen=document.createElement('canvas');screen.width=1120;screen.height=720
            screen.getContext('2d').drawImage(image,tl.x,tl.y,br.x-tl.x,br.y-tl.y);images['screen-mask']=screen.toDataURL()
          }
        }
        const ext=gl.getExtension('WEBGL_debug_renderer_info')
        const device=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)
        gl.readPixels=nativeRead;renderer.dispose()
        return {id:input.id,label:input.label,coverage,fieldDiagnostics,images,captures,device,normal:part.normal,inputSha256:input.inputSha256,meshSha256:input.meshSha256,repair:input.repairStats}
      },input)
      for(const [key,url] of Object.entries(result.images))fs.writeFileSync(path.join(root,`${input.id}-${key}.png`),Buffer.from(url.split(',')[1],'base64'))
      delete result.images;results.push(result);console.log(JSON.stringify({id:result.id,coverage:result.coverage,device:result.device}))
    }
    if(errors.length)throw Error(errors.join('\n'))
    fs.writeFileSync(path.join(root,'lighting-report.json'),JSON.stringify({results,errors,productionRenderer:true,sourceAlignmentReport:reportPath},null,2))
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1})
