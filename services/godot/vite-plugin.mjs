import {GodotService,definitions} from './service.mjs';
export function godotBridge(){const service=new GodotService();return {name:'gs-godot-tools',configureServer(server){server.middlewares.use('/api/godot',async(req,res,next)=>{
 try{
  const host=req.headers.host,origin=req.headers.origin;if(!['localhost','127.0.0.1','[::1]'].includes(new URL('http://'+host).hostname)){res.statusCode=403;res.end('Host rejected');return}
  if(origin&&new URL(origin).host!==host){res.statusCode=403;res.end('Origin rejected');return}
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)){res.statusCode=403;res.end('Local access only');return}
  res.setHeader('Content-Type','application/json');
  if(req.method==='GET'){res.end(JSON.stringify({tools:definitions,project:service.project}));return}
  if(req.method!=='POST'){res.statusCode=405;res.end('{}');return}
  let body='';for await(const b of req){body+=b;if(body.length>67108864)throw Error('Request too large')}
  const {name,arguments:args}=JSON.parse(body);res.end(JSON.stringify(await service.call(name,args)));
 }catch(e){res.statusCode=400;res.end(JSON.stringify({error:e.message}))}
 })}}}
