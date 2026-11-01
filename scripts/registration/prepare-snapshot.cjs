const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),ts=require('typescript');require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f)
const {renderSnapshot}=require('../../src/shared/godot/render-snapshot.ts'),{createPart,clonePart}=require('../../src/shared/parts/schema.ts'),{decodeMesh,meshDataUri}=require('../../src/shared/parts/mesh.ts'),{meshExtents}=require('../../src/modules/scene-lighting/part-model.ts'),{initializeComparison,storeCandidate,chooseModelVersion}=require('../../src/shared/parts/model-comparison.ts'),{fitCameraSilhouette}=require('../../src/modules/scene-lighting/camera-registration.ts')
const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),sha=b=>crypto.createHash('sha256').update(b).digest('hex');let part
if(c.part){part=c.part}else{
 const bytes=fs.readFileSync(c.model),image=fs.readFileSync(c.image),hash=sha(bytes),[width,height]=JSON.parse(cp.execFileSync(process.env.GS_PYTHON||'python',['-c','from PIL import Image; import sys,json; print(json.dumps(Image.open(sys.argv[1]).size))',c.image],{encoding:'utf8'})),uri=meshDataUri(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)),mesh=decodeMesh(uri)
 part=createPart(c.id,{uri:'data:image/png;base64,'+image.toString('base64'),width,height},c.id);part.version=2;part.model={kind:'mesh',size:meshExtents(mesh).size,mesh:{uri,sha256:hash,inputSha256:sha(image),providerId:'gs',warnings:[]}};part=initializeComparison(part)
 const recipes=JSON.parse(fs.readFileSync('public/scene-lighting/models/optimized.json','utf8')).models
 const manifest=JSON.parse(fs.readFileSync('public/scene-lighting/models/manifest.json','utf8'))
 const known=Object.entries(recipes).find(([id,m])=>m.sourceModelId==='model:'+hash&&manifest.find(record=>record.id===id)?.request.inputSha256===sha(image))?.[1]
 const candidate=clonePart(part);delete candidate.model.original
 if(known){candidate.model={...clonePart(known),mesh:clonePart(part.model.mesh)}}else{
  const rgba=cp.execFileSync(process.env.GS_PYTHON||'python',['-c','from PIL import Image; import sys; sys.stdout.buffer.write(Image.open(sys.argv[1]).convert("RGBA").tobytes())',c.image],{maxBuffer:16000000}),positions=new Float32Array(mesh.vertices.length/3);for(let i=0,j=0;i<mesh.vertices.length;i+=9,j+=3)positions.set(mesh.vertices.subarray(i,i+3),j)
  const result=fitCameraSilhouette(positions,{width,height,data:new Uint8ClampedArray(rgba)},{pitchRange:[5,80]});candidate.model.registration={method:'orthographic-camera',pitch:result.pitch,yaw:result.yaw,scale:result.frame.scale,offset:result.frame.offset,width,height}
 }
 storeCandidate(part,candidate);chooseModelVersion(part,'optimized')
}
if(!part.normalImage)part.normalImage={uri:'data:image/png;base64,'+fs.readFileSync(c.normal).toString('base64'),width:part.image.width,height:part.image.height}
const normalBytes=Buffer.from(part.normalImage.uri.split(',')[1],'base64');if(normalBytes.readUInt32BE(16)!==part.image.width||normalBytes.readUInt32BE(20)!==part.image.height)throw Error('Snapshot normal image size mismatch')
const inputImage=Buffer.from(part.image.uri.split(',')[1],'base64'),originalImage=fs.readFileSync(c.image)
if(originalImage.readUInt32BE(16)!==part.image.width||originalImage.readUInt32BE(20)!==part.image.height)throw Error('Snapshot image size mismatch')
if(sha(inputImage)!==sha(originalImage)){
 const decode=bytes=>cp.execFileSync(process.env.GS_PYTHON||'python',['-c','from PIL import Image; import sys,io; sys.stdout.buffer.write(Image.open(io.BytesIO(sys.stdin.buffer.read())).convert("RGBA").tobytes())'],{input:bytes,maxBuffer:16000000})
 if(!decode(inputImage).equals(decode(originalImage)))throw Error('Snapshot image pixels do not match registered image')
}
if(sha(Buffer.from(part.model.mesh.uri.split(',')[1],'base64'))!==part.model.mesh.sha256)throw Error('Snapshot source URI hash mismatch')
if(sha(fs.readFileSync(c.model))!==part.model.mesh.sha256)throw Error('Snapshot model does not match source')
const snapshot=renderSnapshot(part),binary=Buffer.from(snapshot.vertices.buffer),geometryHash=sha(binary)
if(c.expectedGeometryHash&&c.expectedGeometryHash!==geometryHash)throw Error('Frontend/backend geometry mismatch')
const metadata={part:snapshot.part,scenePitch:20,pixelsPerUnit:100},snapshotHash=sha(Buffer.concat([Buffer.from(JSON.stringify(metadata)),binary]))
const folder=path.join(c.project,'.g-studio/render-snapshots');fs.mkdirSync(folder,{recursive:true});const file=path.join(folder,c.id+'-'+snapshotHash+'.json'),vertexFile=path.join(folder,geometryHash+'.f32')
fs.writeFileSync(vertexFile,binary);fs.writeFileSync(file,JSON.stringify({format:'gs-render-snapshot-1',snapshotHash,geometryHash,vertexFile,...metadata}))
console.log(JSON.stringify({snapshot:file,geometryHash,part:snapshot.part.model.registration}))
