const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f)
const {registeredModel,registrationBasis}=require('../src/modules/scene-lighting/registered-model.ts'),{meshBuilder}=require('../src/modules/scene-lighting/model.ts'),{reference}=require('../scripts/registration/fixtures.cjs')
test('registered geometry preserves up, uniform scale, triangle positions and source-camera projection',()=>{
 const b=meshBuilder();b.box(.2,0,.3,1,2,.6,[1,1,1]);const mesh=b.build(),positions=new Float32Array(mesh.vertices.length/3);for(let i=0,j=0;i<mesh.vertices.length;i+=9,j+=3)positions.set(mesh.vertices.subarray(i,i+3),j)
 const target=reference(positions,37,65),r={method:'orthographic-camera',pitch:37,yaw:65,scale:target.scale,offset:target.offset,width:224,height:224},part={imageFrame:{left:-1,bottom:0,height:2},model:{registration:r}},before=mesh.vertices.slice(),result=registeredModel(mesh,part),basis=registrationBasis(37),scale=r.scale*2/224,dot=(p,a)=>p.reduce((s,v,i)=>s+v*a[i],0)
 let ground=Infinity
 for(let i=0;i<result.vertices.length;i+=9){const p=Array.from(result.vertices.subarray(i,i+3)),source=Array.from(positions.subarray(i/3,i/3+3)),k=i/9,expected=target.landmarks.find(l=>l.point.every((v,j)=>v===source[j])).pixel
 assert.ok(Math.abs(dot(p,basis.right)-(-1+expected[0]*2/224))<1e-5);assert.ok(Math.abs(dot(p,basis.up)-(2-expected[1]*2/224))<1e-5)
 ground=Math.min(ground,p[1]);assert.ok(Math.abs((p[1]-result.vertices[1])-(mesh.vertices[i+1]-mesh.vertices[1])*scale)<1e-5)
 result.triangles[Math.floor(k/3)][k%3].forEach((v,j)=>assert.ok(Math.abs(v-p[j])<1e-5))
 }
 assert.ok(Math.abs(ground)<1e-5);assert.deepEqual(mesh.vertices,before)
})
const {createScene}=require('../src/modules/scene-lighting/model.ts'),{parseScene}=require('../src/modules/scene-lighting/scene-state.ts')
test('shared scene camera survives serialization and rejects unsupported angles',()=>{
 const scene=createScene();scene.cameraPitch=37
 assert.equal(parseScene(JSON.parse(JSON.stringify(scene))).cameraPitch,37)
 for(const angle of [NaN,0,81])assert.throws(()=>parseScene({...scene,cameraPitch:angle}))
})
