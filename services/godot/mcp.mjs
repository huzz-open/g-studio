import {createInterface} from 'node:readline';
import {GodotService,definitions} from './service.mjs';
const service=new GodotService();
const respond=value=>process.stdout.write(JSON.stringify(value)+'\n');
for await(const line of createInterface({input:process.stdin})){
 let request;
 try{
  request=JSON.parse(line);if(request.id===undefined)continue;
  let result;
  if(request.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'g-studio-godot',version:'1.0.0'}};
  else if(request.method==='ping')result={};
  else if(request.method==='tools/list')result={tools:definitions};
  else if(request.method==='tools/call'){
   try{const value=await service.call(request.params.name,request.params.arguments??{});result={content:[{type:'text',text:JSON.stringify(value)}]}}catch(e){result={isError:true,content:[{type:'text',text:e.message}]}}
  }else{respond({jsonrpc:'2.0',id:request.id,error:{code:-32601,message:'Method not found'}});continue}
  respond({jsonrpc:'2.0',id:request.id,result});
 }catch(e){respond({jsonrpc:'2.0',id:request?.id??null,error:{code:-32700,message:e.message}})}
}
