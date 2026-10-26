const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename)
const {createScene,buildRoom,roomBounds,DEFAULT_ROOM}=require('../src/modules/scene-lighting/model.ts')
const {parseScene}=require('../src/modules/scene-lighting/scene-state.ts')
const {sunDirection,directionalShadowCamera,cornerCoordinates,worldCoordinates}=require('../src/modules/scene-lighting/lighting-math.ts')
const {transform}=require('../src/modules/experiments/umbrella/math.ts')
const {partMovementLimits}=require('../src/modules/scene-lighting/part-geometry.ts')
test('old scenes migrate without changing instance or point-light placement',()=>{
  const old=createScene();delete old.room;delete old.sun;delete old.lightKind
  const result=parseScene(old)
  assert.deepEqual(result.items,old.items);assert.deepEqual(result.light,old.light)
  assert.deepEqual(result.room,DEFAULT_ROOM);assert.equal(result.lightKind,'point')
})
test('room dimensions and independent light settings round-trip through scene data',()=>{
  const scene=createScene();scene.room={width:18,depth:20,height:8};scene.light=[10,10,14]
  scene.lightKind='directional';scene.sun={azimuth:130,elevation:25,intensity:2.3};scene.zoom=30
  assert.deepEqual(parseScene(JSON.parse(JSON.stringify(scene))),scene)
  for(const change of [s=>s.room.width=0,s=>s.sun.elevation=0,s=>s.sun.intensity=Infinity,s=>s.lightKind='spot']){
    const invalid=JSON.parse(JSON.stringify(scene));change(invalid);assert.throws(()=>parseScene(invalid))
  }
})
test('resizing keeps the corner fixed and updates floor, both walls and movement limits',()=>{
  const size={width:16,depth:12,height:6},b=roomBounds(size),mesh=buildRoom('corner',size)
  const points=mesh.triangles.flat();assert.equal(Math.max(...points.map(p=>p[0])),b.maxX)
  assert.equal(Math.max(...points.map(p=>p[2])),b.maxZ);assert.equal(Math.max(...points.map(p=>p[1])),6)
  assert.deepEqual(cornerCoordinates([b.minX,0,b.minZ]),[0,0,0])
  const p=[2,3,7];assert.deepEqual(cornerCoordinates(worldCoordinates(p)),p)
  const limits=partMovementLimits(undefined,1,size);assert.ok(limits.maxX>b.maxX-1&&limits.maxZ>b.maxZ-1)
})
test('parallel-light direction is normalized and independent of point-light position',()=>{
  const scene=createScene(),a=sunDirection(scene),matrix=directionalShadowCamera(scene).matrix
  assert.ok(Math.abs(Math.hypot(...a)-1)<1e-9)
  scene.light=[10,8,-3];assert.deepEqual(directionalShadowCamera(scene).matrix,matrix)
  scene.sun.azimuth=90;assert.ok(sunDirection(scene)[0]>.5);assert.ok(Math.abs(sunDirection(scene)[2])<1e-9)
})
test('orthographic shadow frustum covers resized room corners across sun angles',()=>{
  for(const azimuth of [-180,-90,0,90,180])for(const elevation of [5,45,85]){
    const scene=createScene();scene.room={width:24,depth:24,height:12};scene.sun={azimuth,elevation,intensity:1}
    const b=roomBounds(scene.room),matrix=directionalShadowCamera(scene).matrix
    for(const x of [b.minX,b.maxX])for(const y of [0,b.height])for(const z of [b.minZ,b.maxZ]){
      const q=transform(matrix,[x,y,z]);assert.ok(q.slice(0,3).every(v=>Math.abs(v/q[3])<=1.001))
    }
  }
})
