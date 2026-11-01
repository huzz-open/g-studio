import {readFile,writeFile,mkdir,cp,stat,realpath,readdir} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
function pngSize(bytes){if(bytes.length<24||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('PNG source required');const w=bytes.readUInt32BE(16),h=bytes.readUInt32BE(20);if(!w||!h||w>2048||h>2048||w*h>4000000)throw Error('Image dimensions exceed supported size');return [w,h];}
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export const definitions=[
 ['gs_bind_project','Bind a Godot project root',{project:{type:'string'}}],
 ['gs_list_assets','List registered GS assets',{}],
 ['gs_register_asset','Register source images',{id:{type:'string'},image:{type:'string'},normal:{type:'string'}}],
 ['gs_generate_model','Generate a model for the registered image',{id:{type:'string'},resolution:{type:'integer'},provider:{type:'string'},seed:{type:'integer'}}],
 ['gs_generation_status','Read generation status and attach successful mesh',{id:{type:'string'}}],
 ['gs_install_runtime','Install GS-maintained Godot addon',{}],
 ['gs_prepare_asset','Prepare and freeze the GS model before export',{id:{type:'string'},reset:{type:'boolean'}}],
 ['gs_preview_asset','Read the authoritative GS render snapshot',{id:{type:'string'}}],
 ['gs_set_render_snapshot','Save the exact model and textures shown by GS',{id:{type:'string'},part:{type:'object'},geometryHash:{type:'string'}}],
 ['gs_export_asset','Export calibrated mesh, surface geometry, collision and scene',{id:{type:'string'}}],
 ['gs_cancel_export','Cancel an active export',{jobId:{type:'string'}}],
 ['gs_job_status','Read export job status',{jobId:{type:'string'}}],
].map(([name,description,properties])=>({name,description,inputSchema:{type:'object',properties,additionalProperties:false,required:Object.keys(properties).filter(k=>!['resolution','provider','seed','reset'].includes(k))}}));
export class GodotService {
 project=null; jobs=new Map(); children=new Map(); queue=Promise.resolve();
 call(name,args={}){const result=this.queue.then(()=>this._call(name,args));this.queue=result.catch(()=>{});return result;}
 async bind(project){const root=await realpath(resolve(project));await stat(join(root,'project.godot'));this.project=root;await this.safeDir('.g-studio');try{await writeFile(join(root,'.g-studio/.gdignore'),'',{flag:'wx'})}catch(e){if(e.code!=='EEXIST')throw e}return {project:root};}
 async safeDir(subpath){let current=this.project;for(const part of subpath.split('/')){if(!part||part==='.'||part==='..')throw Error('Invalid output path');current=join(current,part);try{await mkdir(current)}catch(e){if(e.code!=='EEXIST')throw e}const actual=await realpath(current),r=relative(this.project,actual);if(r.startsWith('..')||isAbsolute(r))throw Error('Output directory escapes bound project');}return current;}
 async data(){if(!this.project)throw Error('Bind a Godot project first');try{return JSON.parse(await readFile(join(this.project,'.g-studio/godot-migration.json'),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;return {project:this.project,assets:[]}}}
 async save(data){await writeFile(join(this.project,'.g-studio/godot-migration.json'),JSON.stringify(data,null,2));}
 async contained(file){const p=await realpath(resolve(this.project,file)),r=relative(this.project,p);if(r.startsWith('..')||isAbsolute(r))throw Error('Source must be inside the bound project');return p;}
 async asset(id){if(!/^[a-z0-9_-]+$/.test(id))throw Error('Invalid asset id');const d=await this.data(),a=d.assets.find(a=>a.id===id);if(!a)throw Error('Unknown asset');return {d,a};}
 async generation(path,options={}){const c=JSON.parse(await readFile(join(ROOT,'runtime/generation-data/config.json'),'utf8'));const r=await fetch('http://127.0.0.1:8765'+path,{...options,headers:{Authorization:'Bearer '+c.token,...options.headers}});if(!r.ok)throw Error(`Generation service: ${r.status} ${await r.text()}`);return r.json();}
 async _call(name,args={}){
  const definition=definitions.find(d=>d.name===name);if(!definition)throw Error('Unknown tool');if(!args||typeof args!=='object'||Array.isArray(args))throw Error('Arguments object required');for(const key of definition.inputSchema.required)if(!(key in args))throw Error('Missing '+key);for(const [key,value] of Object.entries(args)){const rule=definition.inputSchema.properties[key];if(!rule||(rule.type==='string'?typeof value!=='string':rule.type==='boolean'?typeof value!=='boolean':rule.type==='object'?(!value||typeof value!=='object'||Array.isArray(value)):!Number.isInteger(value)))throw Error('Invalid argument: '+key);}
  if(name==='gs_bind_project')return this.bind(args.project);
  const data=await this.data();
  if(name==='gs_list_assets'){for(const a of data.assets)if(a.model)a.sourceMeshSha256=createHash('sha256').update(await readFile(a.model)).digest('hex');return data;}
  if(name==='gs_register_asset'){
   if(!/^[a-z0-9_-]+$/.test(args.id))throw Error('Invalid asset id');const image=await this.contained(args.image),normal=await this.contained(args.normal),inputSha256=createHash('sha256').update(await readFile(image)).digest('hex');
   if(JSON.stringify(pngSize(await readFile(image)))!==JSON.stringify(pngSize(await readFile(normal))))throw Error('Normal map dimensions must match source image');if(data.assets.some(a=>a.id===args.id))throw Error('Asset id already registered');data.assets.push({id:args.id,image,normal,inputSha256,model:null});await this.save(data);return data.assets.at(-1);
  }
  if(name==='gs_install_runtime'){const target=await this.safeDir('addons/gstudio_2d');await cp(join(ROOT,'packages/godot/addons/gstudio_2d'),target,{recursive:true});await cp(join(ROOT,'packages/godot/README.md'),join(target,'README.md'));return {installed:target};}
  if(name==='gs_job_status'||name==='gs_cancel_export'){if(!/^[0-9a-f-]{36}$/.test(args.jobId))throw Error('Invalid job id');let job=this.jobs.get(args.jobId);if(!job){try{job=JSON.parse(await readFile(join(this.project,'.g-studio',args.jobId+'-result.json'),'utf8'));if(job.status==='running')job.status='interrupted';this.jobs.set(job.id,job)}catch{throw Error('Unknown export job')}}if(job.project!==this.project)throw Error('Unknown export job');if(name==='gs_cancel_export'&&job.status==='running'){job.cancelRequested=true;this.children.get(job.id)?.kill()}return job;}
  const {d,a}=await this.asset(args.id);
  if(name==='gs_generate_model'){
   const image=await readFile(await this.contained(a.image)),hash=createHash('sha256').update(image).digest('hex');if(hash!==a.inputSha256)throw Error('Registered source changed');
   const body=new FormData();body.set('request',JSON.stringify({protocolVersion:1,clientRequestId:'gs-godot-'+randomUUID(),providerId:args.provider??'hunyuan-mini',inputSha256:hash,targetFaces:12000,seed:args.seed??12345,parameters:{steps:5,resolution:args.resolution??256}}));body.set('image',new Blob([image],{type:'image/png'}),'input.png');
   const job=await this.generation('/v1/jobs',{method:'POST',body});a.generationJob=job.id;a.model=null;a.snapshot=null;await this.save(d);return job;
  }
  if(name==='gs_generation_status'){
   if(!a.generationJob)return {status:a.model?'succeeded':'not-generated'};const job=await this.generation('/v1/jobs/'+encodeURIComponent(a.generationJob));
   if(job.status==='succeeded'){const source=join(ROOT,'runtime/generation-data/jobs',job.id,'shadow.glb');await stat(source);const folder=await this.safeDir('.g-studio/models');a.model=join(folder,a.inputSha256+'-'+job.id+'.glb');await cp(source,a.model);await this.save(d)}return job;
  }
  if(name==='gs_preview_asset'){if(!a.snapshot)throw Error('Prepare the GS model first');const snapshot=JSON.parse(await readFile(a.snapshot,'utf8'));if(snapshot.format!=='gs-render-snapshot-1')throw Error('Unsupported snapshot');return {part:snapshot.part,geometryHash:snapshot.geometryHash,snapshotHash:snapshot.snapshotHash};}
  if(name==='gs_prepare_asset'||name==='gs_set_render_snapshot'){
   if(!a.model)throw Error('Generate model first');
   if(name==='gs_prepare_asset'&&a.snapshot&&!args.reset){const snapshot=JSON.parse(await readFile(a.snapshot,'utf8'));return {snapshot:a.snapshot,geometryHash:snapshot.geometryHash};}
   const folder=await this.safeDir('.g-studio/source-images');
   if(relative(join(this.project,'assets/gstudio',a.id),a.image).split(/[\\/]/)[0]!=='..'){
    const image=join(folder,a.id+'.png'),normal=join(folder,a.id+'-normal.png');await cp(a.image,image);await cp(a.normal,normal);a.image=image;a.normal=normal;
   }
   const config=join(this.project,'.g-studio','prepare-'+randomUUID()+'.json');await writeFile(config,JSON.stringify({...a,project:this.project,part:args.part,expectedGeometryHash:args.geometryHash}));
   const {stdout}=await execute(process.execPath,[join(ROOT,'scripts/registration/prepare-snapshot.cjs'),config],{cwd:ROOT,windowsHide:true,maxBuffer:16000000});
   const result=JSON.parse(stdout);a.snapshot=result.snapshot;await this.save(d);return result;
  }
  if(name==='gs_export_asset'){
   if(!a.snapshot)throw Error('Prepare/save the GS model before exporting');
   if(!a.model)throw Error('Generate model first');if(createHash('sha256').update(await readFile(await this.contained(a.image))).digest('hex')!==a.inputSha256)throw Error('Source image changed; regenerate the model');
   for(const job of this.jobs.values())if(job.project===this.project&&job.asset===a.id&&job.status==='running')return job;
   await this._call('gs_install_runtime');await this.safeDir('assets/gstudio');await this.safeDir('.g-studio/export-staging');await this.safeDir('.g-studio/export-backups');const job={id:randomUUID(),project:this.project,asset:a.id,status:'running',startedAt:new Date().toISOString()};this.jobs.set(job.id,job);
   const config=join(this.project,'.g-studio',job.id+'.json');await writeFile(config,JSON.stringify({...a,project:this.project}));await writeFile(join(job.project,'.g-studio',job.id+'-result.json'),JSON.stringify(job));
   const child=spawn(process.execPath,[join(ROOT,'scripts/registration/export-godot-2d.cjs'),config],{cwd:ROOT,windowsHide:true});this.children.set(job.id,child);let log='';child.stdout.on('data',b=>{log=(log+b).slice(-12000)});child.stderr.on('data',b=>{log=(log+b).slice(-12000)});
   const finish=async(code)=>{if(job.finishedAt)return;job.status=job.cancelRequested?'cancelled':code===0?'succeeded':'failed';this.children.delete(job.id);job.log=log;job.finishedAt=new Date().toISOString();await writeFile(join(job.project,'.g-studio',job.id+'-result.json'),JSON.stringify(job,null,2))};child.on('error',e=>{log+=e.message;void finish(-1).catch(e=>{job.persistenceError=e.message})});child.on('close',code=>{void finish(code).catch(e=>{job.persistenceError=e.message})});return job;
  }
 }
}
