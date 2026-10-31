const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename)
const {createPart,validatePart,clonePart}=require('../src/shared/parts/schema.ts')
const {meshBuilder,RIGHT,UP}=require('../src/modules/scene-lighting/model.ts')
const {meshDataUri}=require('../src/shared/parts/mesh.ts')
const {buildPartModel,imageBounds,alignPartModel,meshExtents,partMovementLimits}=require('../src/modules/scene-lighting/part-model.ts')
const {visiblePixelBounds}=require('../src/modules/scene-lighting/image-fit.ts')
const {dot,cross,sub,normalize}=require('../src/modules/experiments/umbrella/math.ts')
const {selectPartModel}=require('../src/shared/parts/model-options.ts')
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
 part.imageFrame={left:-.4,bottom:.075,height:2.5}
 selectPartModel(part,model());return {part,pixels}
}
function projected(mesh){const xs=[],ys=[];for(let i=0;i<mesh.vertices.length;i+=9){const p=Array.from(mesh.vertices.slice(i,i+3));xs.push(dot(p,RIGHT));ys.push(dot(p,UP))}return [Math.min(...xs),Math.min(...ys),Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)]}
function contained(rect,target){near(rect[0]+rect[2]/2,target[0]+target[2]/2);near(rect[1]+rect[3]/2,target[1]+target[3]/2);assert.ok(rect[2]<=target[2]+2e-5&&rect[3]<=target[3]+2e-5);assert.ok(Math.abs(rect[2]-target[2])<2e-5||Math.abs(rect[3]-target[3])<2e-5)}
const near=(a,b)=>assert.ok(Math.abs(a-b)<2e-5,`${a} != ${b}`)
test('transparent padding and fixed image frames fit proportionally inside visible bounds, with ground contact and no source mutation',()=>{
 const {part,pixels}=fixture(),source=part.model.mesh.uri,before=imageBounds(part)
 alignPartModel(part,pixels);const mesh=buildPartModel(part,pixels),rect=projected(mesh)
 contained(rect,part.model.imageFit.target);near(meshExtents(mesh).min[1],0)
 assert.deepEqual(imageBounds(part),before);assert.equal(part.model.mesh.uri,source)
 const target=part.model.imageFit.target;near(target[0],before.left+.1*before.width);near(target[1],before.bottom+.1*before.height);near(target[2],.6*before.width);near(target[3],.75*before.height)
})
test('visible model and shadow triangles share positions and inverse-transpose normals',()=>{
 const {part,pixels}=fixture();alignPartModel(part,pixels);part.model.size=[1.3,2.2,.7]
 const mesh=buildPartModel(part,pixels)
 mesh.triangles.forEach((tri,t)=>{tri.forEach((p,i)=>p.forEach((v,j)=>near(v,mesh.vertices[t*27+i*9+j])));const n=normalize(cross(sub(tri[1],tri[0]),sub(tri[2],tri[0])));for(let j=0;j<3;j++)near(n[j],mesh.vertices[t*27+3+j])})
})
test('manual dimensions remain effective while image size is fixed; realignment is repeatable',()=>{
 const {part,pixels}=fixture();alignPartModel(part,pixels);const original=buildPartModel(part,pixels),image=imageBounds(part),width=meshExtents(original).size[0]
 part.model.size[0]*=1.5;near(meshExtents(buildPartModel(part,pixels)).size[0],width*1.5)
 assert.deepEqual(imageBounds(part),image)
 alignPartModel(part,pixels);const once=projected(buildPartModel(part,pixels));alignPartModel(part,pixels);projected(buildPartModel(part,pixels)).forEach((v,i)=>near(v,once[i]))
})
test('fit survives export, shape switching and replacement with differently proportioned model',()=>{
 const {part,pixels}=fixture();alignPartModel(part,pixels);const target=[...part.model.imageFit.target]
 const restored=clonePart(part);validatePart(restored)
 selectPartModel(restored,{kind:'none',size:[1,2,.08]});selectPartModel(restored,restored.modelAlternatives[0]);validatePart(restored)
 restored.model.mesh=model(2,1,3).mesh
 contained(projected(buildPartModel(restored,pixels)),target)
})
test('empty image fails without modifying part, and metadata rejects invalid fit dimensions',()=>{
 const {part,pixels}=fixture(),before=clonePart(part);pixels.data.fill(0)
 assert.throws(()=>alignPartModel(part,pixels));assert.deepEqual(part,before)
 for(const mutate of [p=>p.imageFrame.height=Infinity,p=>p.model.imageFit={size:[1,2,1],target:[0,0,0,1]},p=>p.model.imageFit={size:[0,2,1],target:[0,0,1,1]}]){const p=clonePart(part);mutate(p);assert.throws(()=>validatePart(p))}
})
test('alpha threshold agrees with visible sprite pixels',()=>{
 const p={width:3,height:1,data:new Uint8ClampedArray(12)};p.data[3]=20;p.data[7]=21
 assert.deepEqual(visiblePixelBounds(p),{left:1/3,bottom:0,width:1/3,height:1})
})
test('preview fits calibrated model and movement limits account for shifted footprint',()=>{
 const {part,pixels}=fixture();alignPartModel(part,pixels)
 const mesh=buildPartModel(part,pixels),bounds=meshExtents(mesh),limits=partMovementLimits(part)
 assert.ok(limits.minX+bounds.min[0]>=-5.5);assert.ok(limits.maxX+bounds.max[0]<=5.5)
 assert.ok(limits.minZ+bounds.min[2]>=-4);assert.ok(limits.maxZ+bounds.max[2]<=5)
 const state=createPartPreview(part);fitPartPreview(state,part,.5);assert.ok(state.target.every(Number.isFinite))
})

test('image frame is independent of model dimensions and shape selection',()=>{
 const {part,pixels}=fixture(),frame=clonePart(part.imageFrame),bounds=imageBounds(part)
 part.model.size=[7,1,.1]
 assert.deepEqual(imageBounds(part),bounds)
 alignPartModel(part,pixels)
 part.model.imageFit.rotation=[32,70,-11];part.model.imageFit.projection=[.2,.15,-.12]
 buildPartModel(part,pixels)
 assert.deepEqual(part.imageFrame,frame);assert.deepEqual(imageBounds(part),bounds)
 selectPartModel(part,{kind:'none',size:[1,2,.08]})
 assert.deepEqual(imageBounds(part),bounds)
})

test('manual projection moves and uniformly scales model without moving its image',()=>{
 const {part,pixels}=fixture();alignPartModel(part,pixels)
 const before=projected(buildPartModel(part,pixels)),frame=clonePart(part.imageFrame),target=part.model.imageFit.target
 part.model.imageFit.projection=[Math.log(1.2),.15,-.1]
 const after=projected(buildPartModel(part,pixels))
 near(after[2],before[2]*1.2);near(after[3],before[3]*1.2)
 near(after[0]+after[2]/2,before[0]+before[2]/2+target[2]*.15)
 near(after[1]+after[3]/2,before[1]+before[3]/2-target[3]*.1)
 assert.deepEqual(part.imageFrame,frame)
})

test('new data rejects anchor-based assets and bounds extreme image aspect ratios',()=>{
 const {part}=fixture();const old=clonePart(part);delete old.imageFrame;old.alignment={anchor:[.5,1],offset:[0,0],scale:1}
 assert.throws(()=>validatePart(old))
 for(const [width,height] of [[2048,1],[1,2048],[1024,1024]]){
  const p=createPart('image',{uri:'data:image/png;base64,eA==',width,height}),b=imageBounds(p)
  validatePart(p);assert.ok(b.width<=2&&b.height<=2);near(b.width/b.height,width/height)
 }
})
