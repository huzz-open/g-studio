import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, home, run } from './bootstrap.mjs';
import { platformInfo, runtimePaths } from './paths.mjs';
import { installUv } from './uv-download.mjs';
import { downloadFile } from './download-file.mjs';
import { torchIndexArgs } from './mirrors.mjs';
import { downloadTorchWheels } from './torch-download.mjs';
import { downloadDependencies } from './dependency-download.mjs';

function arm64MachO(path) {
  if (!existsSync(path)) return false;
  const bytes = readFileSync(path);
  return bytes.length > 8 && bytes.readUInt32LE(0) === 0xfeedfacf && bytes.readUInt32LE(4) === 0x0100000c;
}
export async function buildMacPackage(hostPython) {
  const target = platformInfo('darwin','arm64'), layout = runtimePaths(home,'mps',target);
  const native = runtimePaths(home,'base');
  let uv = native.uv;
  if (!existsSync(uv)) uv = await installUv({info:platformInfo(), home, destination:uv, run, validate:p=>spawnSync(p,['--version'],{windowsHide:true}).status===0});
  const env = {...process.env, UV_CACHE_DIR:join(home,'cache','darwin-arm64'), RUST_LOG:'error'};
  const uvRun = (args,label,torch=false,timeout) => {
    const childEnv = {...env};
    if(torch) for(const name of ['UV_DEFAULT_INDEX','UV_INDEX_URL','UV_INDEX','UV_EXTRA_INDEX_URL']) delete childEnv[name];
    return run(uv,['--no-config',...(process.env.GEN_OFFLINE==='1'?['--offline']:[]),...args],{env:childEnv,progressLabel:label,...(timeout?{timeout}:{})});
  };
  mkdirSync(layout.pythonRoot,{recursive:true});
  const pythonRoot=join(layout.pythonRoot,'cpython-3.12.12-macos-aarch64-none');
  if(!arm64MachO(join(pythonRoot,'bin/python3.12'))) await uvRun(['python','install','cpython-3.12.12-macos-aarch64-none','--install-dir',layout.pythonRoot,'--no-bin','--no-registry'],'Preparing Mac ARM64 Python');
  if(!arm64MachO(join(pythonRoot,'bin/python3.12'))) throw Error('Invalid Mac ARM64 Python executable');
  // uv deliberately skips Unix symlinks when unpacking on Windows. The backend
  // calls python3 only; a regular copy keeps the package portable across ZIP tools.
  if(!existsSync(join(pythonRoot,'bin/python3'))) copyFileSync(join(pythonRoot,'bin/python3.12'),join(pythonRoot,'bin/python3'));
  const site=join(pythonRoot,'lib/python3.12/site-packages'), requirements=join(root,'services/generation-python/requirements-model.lock');
  const validation=()=>spawnSync(hostPython,[join(root,'scripts/generation/check_foreign.py'),site,requirements],{encoding:'utf8',windowsHide:true,timeout:30000});
  const install=['pip','install','--target',site,'--python-version','3.12','--python-platform','aarch64-apple-darwin','--only-binary',':all:'];
  if(validation().status!==0){
    const indexes = torchIndexArgs(root, 'mps');
    console.log(`[generation] Mac PyTorch index: ${indexes[1]}; dependency fallback: ${indexes[3]}`);
    const wheels = process.env.GEN_OFFLINE === '1' ? ['torch==2.6.0','torchvision==0.21.0'] : await downloadTorchWheels(indexes[1], home, target.tag, 'mps');
    if (process.env.GEN_OFFLINE !== '1') {
      const dependencies = await downloadDependencies({ root, home, python: hostPython, platform: target.tag, requirements, torchWheels: wheels, uvRun });
      await uvRun([...install, '--offline', '--no-index', '--no-deps', ...wheels, ...dependencies], 'Installing verified Mac dependencies');
    } else {
      await uvRun([...install,...wheels,...indexes],'Preparing Mac ARM64 PyTorch',true);
      await uvRun([...install,'-r',requirements,'torch==2.6.0','torchvision==0.21.0'],'Preparing Mac ARM64 dependencies');
    }
  }
  const result=validation();
  if(result.status!==0) throw Error(result.stdout||result.stderr||'Mac dependency validation failed');
  console.log('[generation] Mac static validation: '+result.stdout.trim());
  if(!arm64MachO(layout.node)){
    if(process.env.GEN_OFFLINE==='1') throw Error('Offline: Mac Node runtime missing');
    const version='22.14.0', name=`node-v${version}-darwin-arm64`, url=`https://nodejs.org/dist/v${version}/`;
    const response=await fetch(url+'SHASUMS256.txt',{signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error('Node checksum manifest unavailable');
    const hash=(await response.text()).split('\n').find(line=>line.trim().endsWith(name+'.tar.gz'))?.trim().split(/\s+/)[0];
    if(!hash)throw Error('Mac Node checksum missing');
    const archive=join(home,'downloads',name+'.tar.gz');
    await downloadFile(url+name+'.tar.gz',archive,hash);
    await run(hostPython,[join(root,'scripts/generation/extract_node.py'),archive,name,dirname(layout.node)]);
    writeFileSync(join(dirname(layout.node),'license-version.txt'),'v'+version);
  }
  if(!arm64MachO(layout.node))throw Error('Invalid Mac ARM64 Node executable');
  if(!arm64MachO(layout.uv)) await installUv({info:target,home,destination:layout.uv,run,validate:arm64MachO});
  await run(hostPython,['-u',join(root,'services/generation-python/download.py')]);
  writeFileSync(layout.marker,JSON.stringify({version:1,platform:target.tag,variant:'mps',python:'python/cpython-3.12.12-macos-aarch64-none/bin/python3',validation:'cross-platform-static',minimumMacOS:'14.0'},null,2));
  const output=join(root,'runtime/bundles/g-studio-generation-darwin-arm64-mps.zip');
  await run(hostPython,[join(root,'scripts/generation/pack_runtime.py'),root,home,target.tag,'mps',output],{env:{...process.env,GEN_BUNDLE_DEVICE:'mps'},progressLabel:'Packing Mac ARM64 backend (static checks only)'});
  console.log(`[generation] Mac package: ${output}\n[generation] Static dependency checks passed; Mac startup and MPS inference still require a Mac.`);
}
