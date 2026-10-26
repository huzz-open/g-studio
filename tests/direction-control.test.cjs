const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename)
const {sunSphereFrame,sunSphereGrid,spherePoint,pickSunSphere,pickSunAzimuth,wrapAzimuth}=require('../src/modules/scene-lighting/direction-control.ts')
const direction=(az,el)=>{const a=az*Math.PI/180,e=el*Math.PI/180;return [Math.sin(a)*Math.cos(e),Math.sin(e),Math.cos(a)*Math.cos(e)]}
const frame={x:200,y:250,radius:140}
test('sphere picking retains either depth branch without jumping on pointer down',()=>{
  for(const az of [-170,-90,-30,0,60,130,179])for(const el of [5,15,45,75,85]){
    const v=direction(az,el),p=spherePoint(v,frame),result=pickSunSphere(p.x,p.y,frame,v)
    assert.ok(Math.abs(wrapAzimuth(result.azimuth-az))<1e-5,JSON.stringify({az,el,result}))
    assert.ok(Math.abs(result.elevation-el)<1e-5)
  }
})
test('a pointer motion on the sphere follows the screen projection, not raw angle deltas',()=>{
  const v=direction(40,45),p=spherePoint(v,frame),result=pickSunSphere(p.x+5,p.y-3,frame,v)
  const next=spherePoint(direction(result.azimuth,result.elevation),frame)
  assert.ok(Math.abs(next.x-p.x-5)<1e-6);assert.ok(Math.abs(next.y-p.y+3)<1e-6)
})
test('equator control covers every azimuth including front and back',()=>{
  for(let az=-180;az<=180;az+=5){
    const p=spherePoint(direction(az,0),frame),result=pickSunAzimuth(p.x,p.y,frame,0)
    assert.ok(Math.abs(wrapAzimuth(result-az))<1e-6)
  }
  assert.equal(pickSunAzimuth(frame.x,frame.y,frame,71),71)
})
test('gizmo is docked at bottom left and stays within small and large viewports',()=>{
  for(const [width,height] of [[343,500],[720,640],[220,220]]){
    const f=sunSphereFrame(width,height)
    assert.equal(f.x-f.radius,24)
    assert.ok(f.x+f.radius<=width-20)
    for(let az=-180;az<=180;az+=10)for(let el=0;el<=85;el+=5){
      const p=spherePoint(direction(az,el),f)
      assert.ok(p.x>=20&&p.x<=width-20&&p.y>=20&&p.y<=height-20)
    }
    assert.ok(f.radius<=92)
  }
  const result=pickSunSphere(10000,-10000,frame,direction(30,45))
  assert.ok(Number.isFinite(result.azimuth));assert.ok(result.elevation>=5&&result.elevation<=85)
})
test('sphere grid includes fixed meridians/latitudes and only its active meridian rotates',()=>{
  const a=sunSphereGrid(frame,0),b=sunSphereGrid(frame,90)
  assert.deepEqual(a.filter(p=>p.kind!=='direction'),b.filter(p=>p.kind!=='direction'))
  assert.notEqual(a.find(p=>p.kind==='direction').d,b.find(p=>p.kind==='direction').d)
  assert.ok(a.every(p=>!p.d.includes('NaN')&&!p.d.includes('Infinity')))
})

test('dragging just below the horizon clamps elevation instead of flipping hemisphere',()=>{
  for(const az of [-120,-40,0,40,120]){
    const v=direction(az,5),p=spherePoint(v,frame),result=pickSunSphere(p.x,p.y+1,frame,v)
    assert.ok(Math.abs(wrapAzimuth(result.azimuth-az))<10)
    assert.ok(result.elevation>=5)
  }
})
