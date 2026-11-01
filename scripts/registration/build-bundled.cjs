const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),cp=require('node:child_process');require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f)
const {fitCameraSilhouette}=require('../../src/modules/scene-lighting/camera-registration.ts'),{decodeMesh,meshDataUri}=require('../../src/shared/parts/mesh.ts')
const dir='public/scene-lighting/models',manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8')),out={algorithmVersion:'orthographic-camera',models:{}}
for(const record of manifest){
 const id=record.id
 const bytes=fs.readFileSync(path.join(dir,id+'.glb')),mesh=decodeMesh(meshDataUri(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength))),positions=new Float32Array(mesh.vertices.length/3)
 for(let i=0,j=0;i<mesh.vertices.length;i+=9,j+=3)positions.set(mesh.vertices.subarray(i,i+3),j)
 const result=cp.spawnSync('python',['-c','from PIL import Image; import sys; im=Image.open(sys.argv[1]).convert("RGBA"); sys.stdout.buffer.write(im.tobytes())','public/scene-lighting/'+id+'.png'],{maxBuffer:8000000});if(result.status)throw Error(String(result.stderr))
 const dims=JSON.parse(cp.execFileSync('python',['-c','from PIL import Image; import sys,json; print(json.dumps(Image.open(sys.argv[1]).size))','public/scene-lighting/'+id+'.png'],{encoding:'utf8'})),pixels={width:dims[0],height:dims[1],data:new Uint8ClampedArray(result.stdout)}
 const sha=record.result.outputs.find(o=>o.mime==='model/gltf-binary').sha256
 const {meshExtents}=require('../../src/modules/scene-lighting/part-model.ts')
 const model={kind:'mesh',size:meshExtents(mesh).size,frozen:true,id:'registration:'+sha,sourceModelId:'model:'+sha}
 const fit=fitCameraSilhouette(positions,pixels,{pitchRange:[5,80]});delete model.imageFit;delete model.repair;model.registration={method:'orthographic-camera',pitch:fit.pitch,yaw:fit.yaw,scale:fit.frame.scale,offset:fit.frame.offset,width:pixels.width,height:pixels.height};out.models[id]=model;console.log(id,fit.pitch,fit.yaw)
}
fs.writeFileSync(path.join(dir,'optimized.json'),JSON.stringify(out))
