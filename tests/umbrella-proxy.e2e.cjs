const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)
const { buildUmbrella } = require('../src/modules/experiments/umbrella/geometry.ts')
const subtract = (a,b) => a.map((v,i)=>v-b[i]), dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0)
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
function occluded(light, target, triangles) {
  const ray = subtract(target,light), distance = Math.hypot(...ray), direction = ray.map(v=>v/distance)
  for(const [a,b,c] of triangles) {
    const e1=subtract(b,a),e2=subtract(c,a),p=cross(direction,e2),det=dot(e1,p)
    if(Math.abs(det)<1e-9)continue
    const tvec=subtract(light,a),u=dot(tvec,p)/det
    if(u<0||u>1)continue
    const q=cross(tvec,e1),v=dot(direction,q)/det
    if(v<0||u+v>1)continue
    const t=dot(e2,q)/det
    if(t>1e-5&&t<distance-0.015)return true
  }
  return false
}
;(async()=>{
  const browser=await chromium.launch({executablePath:process.env.NORMAL_TEST_BROWSER||undefined,headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}})
    page.setDefaultTimeout(15000)
    const errors=[];page.on('pageerror',e=>errors.push(e.message))
    await page.goto((process.env.UMBRELLA_TEST_URL||'http://127.0.0.1:5188/')+'#/experiments/umbrella-shadow')
    await page.locator('.umbrella-demo canvas').waitFor()
    await page.waitForFunction(()=>document.querySelector('.umbrella-demo canvas').width>300 || document.querySelector('.demo-error'))
    assert.deepEqual(await page.locator('.demo-error').allTextContents(),[])
    if(process.env.UMBRELLA_SCREENSHOT)await page.screenshot({path:process.env.UMBRELLA_SCREENSHOT})
    const points=[];for(let z=-4.75;z<=4.75;z+=0.25)for(let x=-4.75;x<=4.75;x+=0.25)points.push([x,0,z])
    const report=[]
    for(const height of [4,7,0.8]){
      await page.getByRole('slider',{name:'灯光高度',exact:true}).fill(String(height))
      const state=await page.locator('.umbrella-demo').evaluate(el=>el.__vueParentComponent.exposed.getState())
      const samples=await page.locator('.umbrella-demo').evaluate((el,points)=>el.__vueParentComponent.exposed.probeShadow(points),points)
      const triangles=buildUmbrella(state.shape).casterTriangles
      let mismatch=0,shadow=0
      for(let i=0;i<points.length;i++){
        const expected=occluded(state.frame.light,points[i],triangles)
        if(expected!==samples[i].shadow)mismatch++
        if(samples[i].shadow)shadow++
      }
      report.push({height,mismatch,total:points.length,shadow})
      assert.ok(mismatch/points.length<0.025,'cubemap shadow disagrees with independent ray/triangle reference: '+JSON.stringify(report.at(-1)))
    }
    assert.ok(report[0].shadow>report[1].shadow,'raising an above-canopy light should reduce the sampled ground shadow')
    assert.ok(report[2].shadow<report[1].shadow/4,'a light below the canopy should not project the roof onto the ground')
    await page.getByRole('slider',{name:'灯光高度',exact:true}).fill('4')
    const poleCheck=await page.locator('.umbrella-demo').evaluate(el=>{
      const api=el.__vueParentComponent.exposed,state=api.getState(),l=state.frame.light,r=Math.hypot(l[0],l[2])
      const n=[l[0]/r,0,l[2]/r],points=[0.2,1.9].map(y=>[n[0]*0.035,y,n[2]*0.035])
      return api.probeShadow(points,[n,n]).map(s=>s.shadow)
    })
    assert.deepEqual(poleCheck,[false,true],'the canopy must shade the upper pole while the lower pole remains directly lit')
    const before=await page.locator('.umbrella-demo').evaluate((el,p)=>el.__vueParentComponent.exposed.probeShadow(p).map(s=>s.shadow),points)
    await page.getByRole('group',{name:'投影方式',exact:true}).getByRole('button',{name:'透视',exact:true}).click()
    await page.getByRole('slider',{name:'观察方位',exact:true}).fill('-45')
    const after=await page.locator('.umbrella-demo').evaluate((el,p)=>el.__vueParentComponent.exposed.probeShadow(p).map(s=>s.shadow),points)
    assert.deepEqual(after,before,'camera changes must not change world-space shadows')
    await page.getByRole('switch',{name:'显示线框',exact:true}).check()
    await page.getByRole('switch',{name:'仅看地面阴影',exact:true}).check()
    await page.getByRole('slider',{name:'伞沿高度',exact:true}).fill('1.5')
    await page.getByRole('button',{name:'重置验证场景',exact:true}).click()
    const reset=await page.locator('.umbrella-demo').evaluate(el=>el.__vueParentComponent.exposed.getState())
    assert.equal(reset.shape.rimHeight,2.1);assert.equal(reset.frame.camera.projection,'orthographic')
    assert.deepEqual(errors,[])
    console.log('Umbrella cubemap vs independent ray/triangle intersection:',report)
    console.log('Perspective, camera invariance, model controls and reset passed')
  } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)})
