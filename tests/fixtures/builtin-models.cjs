const fs=require('node:fs'),path=require('node:path')
function install(){
 const previousFetch=global.fetch,previousDocument=global.document
 global.document={baseURI:'http://builtin-test/'}
 global.fetch=async url=>{const file=path.join(process.cwd(),'public',new URL(url).pathname);const bytes=fs.readFileSync(file);return {ok:true,json:async()=>JSON.parse(bytes),arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)}}
 return require('../../src/shared/parts/builtins.ts').loadBuiltinModels().finally(()=>{global.fetch=previousFetch;global.document=previousDocument})
}
function model(height=2){const bytes=require('./comparison-mesh.cjs').tetrahedron(height);return {kind:'mesh',size:[2,height,2],mesh:{uri:'data:model/gltf-binary;base64,'+bytes.toString('base64'),sha256:require('node:crypto').createHash('sha256').update(bytes).digest('hex'),inputSha256:'b'.repeat(64),providerId:'test',warnings:[]}}}
module.exports={install,model}
