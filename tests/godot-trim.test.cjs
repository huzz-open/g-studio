const {test}=require('node:test')
const assert=require('node:assert/strict')
const {trimExport}=require('../scripts/registration/trim-export.cjs')
const pixels=(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)})
const frame={left:-2,bottom:0.3,height:3}
test('export trim ignores invisible fringe, retains visible threshold pixels and holes',()=>{
  const p=pixels(8,6)
  p.data[3]=20
  for(const [x,y,a] of [[2,1,21],[5,4,255]])p.data.set([10,20,30,a],(y*8+x)*4)
  const t=trimExport(p,frame)
  assert.deepEqual(t.crop,{x:2,y:1,width:4,height:4})
  assert.deepEqual(Array.from(t.pixels.data.slice(0,4)),[10,20,30,21])
  assert.equal(t.pixels.data[7],0)
  assert.equal(p.width,8)
  assert.deepEqual(trimExport(t.pixels,t.frame).crop,{x:0,y:0,width:4,height:4})
})
test('cropping preserves world coordinates and units per pixel for every retained pixel',()=>{
  const p=pixels(8,6)
  p.data[(1*8+2)*4+3]=255;p.data[(4*8+5)*4+3]=255
  const t=trimExport(p,frame),unit=frame.height/p.height
  assert.equal(t.frame.height/t.pixels.height,unit)
  for(let y=0;y<t.pixels.height;y++)for(let x=0;x<t.pixels.width;x++){
    assert.ok(Math.abs((frame.left+(x+t.crop.x+.5)*unit)-(t.frame.left+(x+.5)*unit))<1e-12)
    assert.ok(Math.abs((frame.bottom+(p.height-y-t.crop.y-.5)*unit)-(t.frame.bottom+(t.pixels.height-y-.5)*unit))<1e-12)
  }
})
test('one visible pixel remains a valid image; empty exports fail explicitly',()=>{
  const p=pixels(4,4)
  assert.throws(()=>trimExport(p,frame),/without visible pixels/)
  p.data[(2*4+3)*4+3]=255
  assert.deepEqual(trimExport(p,frame).crop,{x:3,y:2,width:1,height:1})
})
test('baked surface positions and normals survive the crop without geometric changes',()=>{
  const fs=require('node:fs'),ts=require('typescript')
  require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f)
  const {registrationBasis}=require('../src/modules/scene-lighting/registered-model.ts')
  const {bakeFields}=require('../scripts/registration/snapshot-fields.cjs')
  const p=pixels(8,6),basis=registrationBasis(20)
  for(let y=1;y<5;y++)for(let x=2;x<6;x++)p.data[(y*8+x)*4+3]=255
  const v=(x,y)=>[...basis.right.map((r,i)=>r*x+basis.up[i]*y),0,1,0,0,0,0]
  const mesh={vertices:new Float32Array([...v(-10,-10),...v(10,-10),...v(0,15)])}
  const t=trimExport(p,frame),before=bakeFields(mesh,frame,p,20,v=>v),after=bakeFields(mesh,t.frame,t.pixels,20,v=>v)
  assert.equal(after.coverage,before.coverage)
  for(const name of ['positions','normals']){
    const values=r=>r.text.match(new RegExp(name+' = PackedFloat32Array\\(([^)]*)\\)'))[1].split(',').map(Number)
    const a=values(before),b=values(after)
    for(let y=0;y<t.pixels.height;y++)for(let x=0;x<t.pixels.width;x++)for(let c=0;c<4;c++)
      assert.ok(Math.abs(a[((y+t.crop.y)*p.width+x+t.crop.x)*4+c]-b[(y*t.pixels.width+x)*4+c])<1e-6)
  }
})
