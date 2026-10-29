const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename)
const {createPart,validatePart,clonePart}=require('../src/shared/parts/schema.ts')
const {meshBuilder,RIGHT,UP}=require('../src/modules/scene-lighting/model.ts')
const {meshDataUri}=require('../src/shared/parts/mesh.ts')
const {buildPartGeometry,alignedBounds,alignPartGeometry,meshExtents,partMovementLimits}=require('../src/modules/scene-lighting/part-geometry.ts')
const {visiblePixelBounds}=require('../src/modules/scene-lighting/image-fit.ts')
const {dot,cross,sub,normalize}=require('../src/modules/experiments/umbrella/math.ts')
const {selectPartGeometry}=require('../src/shared/parts/geometry-options.ts')
const {fitPartPreview,createPartPreview}=require('../src/shared/parts/preview-state.ts')
function model(w=1,h=2,d=1){
 const b=meshBuilder();b.box(0,0,0,w,h,d,[1,1,1]);const mesh=b.build()
 const positions=new Float32Array(mesh.vertices.length/3)
 for(let i=0,j=0;i<mesh.vertices.length;i+=9,j+=3)positions.set(mesh.vertices.slice(i,i+3),j)
 const binary=Buffer.from(positions.buffer)
 const doc={asset:{version:'2.0'},buffers:[{byteLength:binary.length}],bufferViews:[{buffer:0,byteLength:binary.length}],accessors:[{bufferView:0,componentType:5126,count:positions.length/3,type:'VEC3'}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0}
 const text=JSON.stringify(doc),json=Buffer.from(text+' '.repeat((4-text.length%4)%4)),buffer=Buffer.alloc(28+json.length+binary.length)
 buffer.writeUInt32LE(0x46546c67,0);buffer.writeUInt32LE(2,4);buffer.writeUInt32LE(buffer.length,8);buffer.writeUInt32LE(json.length,12);buffer.writeUInt32LE(0x4e4f534a,16);json.copy(buffer,20);buffer.writeUInt32LE(binary.length,20+json.length);buffer.writeUInt32LE(0x004e4942,24+json.length);binary.copy(buffer,28+json.length)
 return {kind:'mesh',size:[w,h,d],mesh:{uri:meshDataUri(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.length)),sha256:'a'.repeat(64),inputSha256:'b'.repeat(64),providerId:'test',warnings:[]}}
}
function fixture(){
 const pixels={width:100,height:200,data:new Uint8ClampedArray(100*200*4)}
 for(let y=30;y<180;y++)for(let x=10;x<70;x++)pixels.data[(y*100+x)*4+3]=255
 const part=createPart('registration',{uri:'data:image/png;base64,eA==',width:100,height:200})
 part.alignment.height=2.5;part.alignment.anchor=[.4,.95];part.alignment.offset=[.1,.2]
 selectPartGeometry(part,model());return {part,pixels}
}
function projected(mesh){const xs=[],ys=[];for(let i=0;i<mesh.vertices.length;i+=9){const p=Array.from(mesh.vertices.slice(i,i+3));xs.push(dot(p,RIGHT));ys.push(dot(p,UP))}return [Math.min(...xs),Math.min(...ys),Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)]}
function contained(rect,target){near(rect[0]+rect[2]/2,target[0]+target[2]/2);near(rect[1]+rect[3]/2,target[1]+target[3]/2);assert.ok(rect[2]<=target[2]+2e-5&&rect[3]<=target[3]+2e-5);assert.ok(Math.abs(rect[2]-target[2])<2e-5||Math.abs(rect[3]-target[3])<2e-5)}
const near=(a,b)=>assert.ok(Math.abs(a-b)<2e-5,`${a} != ${b}`)
test('transparent padding and offset anchors fit proportionally inside visible bounds, with ground contact and no source mutation',()=>{
 const {part,pixels}=fixture(),source=part.geometry.mesh.uri,before=alignedBounds(part,buildPartGeometry(part,pixels))
 alignPartGeometry(part,pixels);const mesh=buildPartGeometry(part,pixels),rect=projected(mesh)
 contained(rect,part.geometry.imageFit.target);near(meshExtents(mesh).min[1],0)
 assert.deepEqual(alignedBounds(part,mesh),before);assert.equal(part.geometry.mesh.uri,source)
 const target=part.geometry.imageFit.target;near(target[0],before.left+.1*before.width);near(target[1],before.bottom+.1*before.height);near(target[2],.6*before.width);near(target[3],.75*before.height)
})
test('visible geometry and shadow triangles share positions and inverse-transpose normals',()=>{
 const {part,pixels}=fixture();alignPartGeometry(part,pixels);part.geometry.size=[1.3,2.2,.7]
 const mesh=buildPartGeometry(part,pixels)
 mesh.triangles.forEach((tri,t)=>{tri.forEach((p,i)=>p.forEach((v,j)=>near(v,mesh.vertices[t*27+i*9+j])));const n=normalize(cross(sub(tri[1],tri[0]),sub(tri[2],tri[0])));for(let j=0;j<3;j++)near(n[j],mesh.vertices[t*27+3+j])})
})
test('manual dimensions remain effective while image size is fixed; realignment is repeatable',()=>{
 const {part,pixels}=fixture();alignPartGeometry(part,pixels);const original=buildPartGeometry(part,pixels),image=alignedBounds(part,original),width=meshExtents(original).size[0]
 part.geometry.size[0]*=1.5;near(meshExtents(buildPartGeometry(part,pixels)).size[0],width*1.5)
 assert.deepEqual(alignedBounds(part,buildPartGeometry(part,pixels)),image)
 alignPartGeometry(part,pixels);const once=projected(buildPartGeometry(part,pixels));alignPartGeometry(part,pixels);projected(buildPartGeometry(part,pixels)).forEach((v,i)=>near(v,once[i]))
})
test('fit survives export, shape switching and replacement with differently proportioned geometry',()=>{
 const {part,pixels}=fixture();alignPartGeometry(part,pixels);const target=[...part.geometry.imageFit.target]
 const restored=clonePart(part);validatePart(restored)
 selectPartGeometry(restored,{kind:'silhouette',size:[1,2,.08]});selectPartGeometry(restored,restored.geometryAlternatives[0]);validatePart(restored)
 restored.geometry.mesh=model(2,1,3).mesh
 contained(projected(buildPartGeometry(restored,pixels)),target)
})
test('empty image fails without modifying part, and metadata rejects invalid fit dimensions',()=>{
 const {part,pixels}=fixture(),before=clonePart(part);pixels.data.fill(0)
 assert.throws(()=>alignPartGeometry(part,pixels));assert.deepEqual(part,before)
 for(const mutate of [p=>p.alignment.height=Infinity,p=>p.geometry.imageFit={size:[1,2,1],target:[0,0,0,1]},p=>p.geometry.imageFit={size:[0,2,1],target:[0,0,1,1]}]){const p=clonePart(part);mutate(p);assert.throws(()=>validatePart(p))}
})
test('alpha threshold agrees with visible sprite pixels',()=>{
 const p={width:3,height:1,data:new Uint8ClampedArray(12)};p.data[3]=20;p.data[7]=21
 assert.deepEqual(visiblePixelBounds(p),{left:1/3,bottom:0,width:1/3,height:1})
})
test('preview fits calibrated geometry and movement limits account for shifted footprint',()=>{
 const {part,pixels}=fixture();alignPartGeometry(part,pixels)
 const mesh=buildPartGeometry(part,pixels),bounds=meshExtents(mesh),limits=partMovementLimits(part)
 assert.ok(limits.minX+bounds.min[0]>=-5.5);assert.ok(limits.maxX+bounds.max[0]<=5.5)
 assert.ok(limits.minZ+bounds.min[2]>=-4);assert.ok(limits.maxZ+bounds.max[2]<=5)
 const state=createPartPreview(part);fitPartPreview(state,part,.5);assert.ok(state.target.every(Number.isFinite))
})
