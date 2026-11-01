import {spawn} from 'node:child_process';import {createInterface} from 'node:readline';import {writeFile} from 'node:fs/promises';
const child=spawn(process.execPath,['services/godot/mcp.mjs'],{stdio:['pipe','pipe','inherit'],windowsHide:true});let n=0;const pending=new Map();createInterface({input:child.stdout}).on('line',l=>{const m=JSON.parse(l);pending.get(m.id)?.(m);pending.delete(m.id)});
const call=async(method,params={})=>{const id=++n,result=await new Promise(r=>{pending.set(id,r);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')});if(result.error)throw Error(result.error.message);return result.result};
const tool=async(name,args={})=>{const r=await call('tools/call',{name,arguments:args});if(r.isError)throw Error(r.content[0].text);return JSON.parse(r.content[0].text)};
try{
 await call('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'gs-migration',version:'1'}});console.log((await call('tools/list')).tools.map(x=>x.name).join(', '));
 await tool('gs_bind_project',{project:process.argv[2]});await tool('gs_install_runtime');const assets=(await tool('gs_list_assets')).assets;const results=[];
 for(const asset of assets){
  if(asset.generationJob){let status=await tool('gs_generation_status',{id:asset.id});while(!['succeeded','failed','cancelled'].includes(status.status)){console.log(asset.id,status.phase);await new Promise(r=>setTimeout(r,5000));status=await tool('gs_generation_status',{id:asset.id})}if(status.status!=='succeeded'){results.push({id:asset.id,error:status.error});console.log(asset.id,'generation failed');continue}}
  await tool('gs_prepare_asset',{id:asset.id,reset:process.argv.includes('--refresh-snapshots')});
  const start=await tool('gs_export_asset',{id:asset.id});let job=start;while(job.status==='running'){await new Promise(r=>setTimeout(r,1000));job=await tool('gs_job_status',{jobId:start.id})}results.push(job);console.log(asset.id,job.status,job.status==='failed'?job.log:'');
 }
 await writeFile(process.argv[2]+'/.g-studio/migration-results.json',JSON.stringify(results,null,2));console.log('MIGRATION',results.map(j=>[j.asset??j.id,j.status??'failed']));
}finally{child.stdin.end()}
