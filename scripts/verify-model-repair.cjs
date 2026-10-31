const fs=require('node:fs'),path=require('node:path'),ts=require('typescript')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f)
const {createBuiltinParts}=require('../src/shared/parts/builtins.ts')
const {decodeMesh,meshDataUri}=require('../src/shared/parts/mesh.ts')
const {buildPartModel,meshExtents,imageBounds}=require('../src/modules/scene-lighting/part-model.ts')
const {repairSpec,repairModel}=require('../src/modules/scene-lighting/model-repair.ts')
const {validatePart}=require('../src/shared/parts/schema.ts')
const report=JSON.parse(fs.readFileSync(process.argv[2]||'output/alignment-surface-20261029/report.json','utf8'))
const folder=process.argv[3]||'output/model-repair-20261029';fs.mkdirSync(folder,{recursive:true})
for(const r of report.runs){
  const bytes=fs.readFileSync(r.mesh),uri=meshDataUri(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)),p=createBuiltinParts().find(p=>p.id==='example:'+r.id)
  p.version=2;p.image.uri='data:image/png;base64,'+fs.readFileSync(r.source).toString('base64');p.model={kind:'mesh',size:meshExtents(decodeMesh(uri)).size,mesh:{uri,sha256:r.meshSha256,inputSha256:r.inputSha256,providerId:r.provider,warnings:[]},imageFit:r.fit};p.imageFrame={left:r.bounds.left,bottom:r.bounds.bottom,height:r.bounds.height}
  const pixels={width:r.width,height:r.height,data:new Uint8ClampedArray(fs.readFileSync(r.rgba))},mesh=buildPartModel(p,pixels),b=imageBounds(p)
  const spec=repairSpec(p,pixels,[b.left,b.bottom,b.width,b.height]),start=performance.now(),result=repairModel(mesh,spec)
  spec.status=result.stats.status;p.model.repair=spec;validatePart(p)
  r.repair=spec;r.repairStats=result.stats;r.repairElapsedMs=performance.now()-start
  console.log(JSON.stringify({id:r.id,...result.stats,rejected:result.stats.rejected.length,elapsedMs:r.repairElapsedMs}))
}
fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify(report,null,2))
