const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f)
const {groundSection,simplifyLoop}=require('../src/shared/godot/ground-footprint.ts'),{meshBuilder}=require('../src/modules/scene-lighting/model.ts')
test('ground slices preserve separated supports, never the suspended upper surface',()=>{
 const b=meshBuilder();for(const x of [-1,1])for(const z of [-1,1])b.box(x,0,z,.2,2,.2,[1,1,1]);b.box(0,2,0,3,.2,3,[1,1,1]);const mesh=b.build(),before=mesh.vertices.slice(),loops=groundSection(mesh.vertices,.04)
 assert.equal(loops.length,4);for(const loop of loops){const p=simplifyLoop(loop,.001);assert.equal(p.length,4);assert.ok(Math.max(...p.map(v=>v[0]))-Math.min(...p.map(v=>v[0]))<.21)}assert.deepEqual(mesh.vertices,before)
})
test('empty and open cuts never fabricate a convex contact polygon',()=>{
 const b=meshBuilder();b.tri([0,0,0],[1,1,0],[0,1,0],[1,1,1]);assert.throws(()=>groundSection(b.build().vertices,.5));assert.throws(()=>groundSection(b.build().vertices,2))
})
