import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Persistent transfer files. Only an explicit task deletion removes them. */
export class PersistentFiles {
  private entries = new Map<string, { size:number; leases:number; deleted:boolean }>();
  private reserved=0;
  constructor(readonly root:string, readonly limit:number) {
    if(!Number.isFinite(limit)||limit<=0)throw Error('Invalid relay storage limit');
    mkdirSync(root,{recursive:true});
    for(const key of readdirSync(root)) {
      if(!/^[a-zA-Z0-9_-]+\.(input|output)$/.test(key))continue;
      this.entries.set(key,{size:statSync(join(root,key)).size,leases:0,deleted:false});
    }
  }
  private path(key:string){
    if(!/^[a-zA-Z0-9_-]+\.(input|output)$/.test(key))throw Error('Invalid transfer key');
    return join(this.root,key);
  }
  get used(){return [...this.entries.values()].reduce((sum,e)=>sum+e.size,0)}
  reserve(bytes:number){
    if(!Number.isFinite(bytes)||bytes<0)throw Error('Invalid reservation');
    if(this.used+this.reserved+bytes>this.limit)throw Object.assign(Error('Relay storage quota reached; delete unwanted tasks explicitly'),{code:'STORAGE_FULL',status:507});
    this.reserved+=bytes;let released=false;
    return ()=>{if(!released){released=true;this.reserved-=bytes}};
  }
  set(key:string,data:Buffer){
    const path=this.path(key),existing=this.entries.get(key);
    if(existing){
      if(!existing.deleted&&readFileSync(path).equals(data))return;
      throw Object.assign(Error('Transfer already exists'),{code:'TRANSFER_CONFLICT',status:409});
    }
    const release=this.reserve(data.length);
    try{writeFileSync(path+'.tmp',data);renameSync(path+'.tmp',path);this.entries.set(key,{size:data.length,leases:0,deleted:false})}finally{release()}
  }
  has(key:string){return !!this.entries.get(key)&&!this.entries.get(key)!.deleted}
  acquire(key:string){
    if(!this.has(key))return undefined;
    const entry=this.entries.get(key)!,data=readFileSync(this.path(key));entry.leases++;let released=false;
    return {data,release:()=>{if(released)return;released=true;entry.leases--;if(!entry.leases&&entry.deleted)this.entries.delete(key)}};
  }
  delete(key:string){
    const entry=this.entries.get(key);if(!entry||entry.deleted)return;
    unlinkSync(this.path(key));entry.deleted=true;
    if(!entry.leases)this.entries.delete(key);
  }
}
