import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';

test('a ten-character code grants access once without terminal confirmation; grants remain isolated', { timeout: 30000 }, async t => {
  const socket = createServer().listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const home = await mkdtemp(join(tmpdir(), 'relay-sharing-'));
  const child = spawn(process.execPath, ['--import', 'tsx', 'services/generation-relay/server.ts'], {
    env: { ...process.env, RELAY_HOME: home, RELAY_HOST: '127.0.0.1', RELAY_PORT: String(port) }, windowsHide:true, stdio:'pipe',
  });
  let ws: WebSocket | undefined;
  t.after(async () => {
    ws?.terminate();
    const exited = once(child, 'exit'); child.kill(); await exited;
    await rm(home, { recursive:true, force:true });
  });
  const base=`http://127.0.0.1:${port}`;
  for (let i=0;i<100;i++) {
    try { if ((await fetch(base+'/health')).ok) break; } catch {}
    await delay(50);
  }
  ws = new WebSocket(`ws://127.0.0.1:${port}/generation/worker`);
  await once(ws, 'open');
  ws.on('message', raw => {
    const message=JSON.parse(String(raw));
    if(message.type==='rpc') ws!.send(JSON.stringify({type:'rpc.result',id:message.id,result:{deviceType:'cpu'}}));
  });
  const send = (message: object, type: string) => new Promise<void>((resolve, reject) => {
    const timer=setTimeout(()=>reject(Error('Missing '+type)),3000);
    const listener = (raw: unknown) => { if(JSON.parse(String(raw)).type===type) {clearTimeout(timer);ws!.off('message',listener);resolve();} };
    ws!.on('message',listener);ws!.send(JSON.stringify(message));
  });
  const device='a'.repeat(32);
  await send({type:'auth',deviceId:device,secret:'b'.repeat(40)},'authenticated');
  async function pair(code: string) {
    await send({type:'pair.code',code},'pair.ready');
    const claim = () => fetch(base+'/v1/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
    const results = await Promise.all([claim(), claim()]);
    assert.deepEqual(results.map(r=>r.status).sort(), [200,404]);
    const granted = await results.find(r=>r.status===200)!.json();
    assert.equal(granted.state, 'approved');
    assert.equal(granted.deviceId, device);
    assert.equal(typeof granted.token, 'string');
    // The worker cannot republish a consumed code during its validity window.
    await send({type:'pair.code',code},'error');
    return { token: granted.token as string };
  }
  await send({type:'pair.code',code:'TOOSHORT'},'error');
  const first=await pair('FIRST12345'),second=await pair('SECOND1234');
  const path=base+`/v1/devices/${device}`;
  assert.equal((await fetch(path,{method:'DELETE',headers:{Authorization:'Bearer '+first.token}})).status,200);
  assert.equal((await fetch(path+'/info',{headers:{Authorization:'Bearer '+first.token}})).status,401);
  assert.equal((await fetch(path+'/info',{headers:{Authorization:'Bearer '+second.token}})).status,200);
});
