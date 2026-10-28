"""Online CPU bootstrap from an empty workspace, followed by real API inference.

Windows/Git Bash integration test. Downloads several GB; existing caches and
credentials are never deleted or imported. The target must not already exist.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def verify(target, bash, output):
    if target.exists():
        raise RuntimeError('Fresh test requires a new target directory')
    output.mkdir(parents=True, exist_ok=True)
    target.mkdir(parents=True)
    for relative in ['scripts/generation', 'services/generation-python']:
        shutil.copytree(ROOT/relative, target/relative, ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '.venv'))
    shutil.copy2(ROOT/'start-generation.sh', target/'start-generation.sh')
    # This is the same project setting written by npm run setup:cn. Preparing
    # the fixture's setting requires no Node/Python inside the tested runtime.
    (target/'.generation-mirrors.local.json').write_text(json.dumps({'version':1,'profile':'cn'}), encoding='utf-8')
    resource = target/'runtime/generation'
    private = target/'runtime/generation-data'
    assert not resource.exists() and not private.exists()
    env = {k:v for k,v in os.environ.items() if not k.upper().startswith(('GEN_', 'UV_', 'PYTHON', 'PIP_', 'HF_', 'TRANSFORMERS_')) and not k.upper().endswith('_PROXY')}
    isolated_user = target/'isolated-user'
    isolated_user.mkdir()
    env.update(USERPROFILE=str(isolated_user), PYTHONIOENCODING='utf-8')
    with socket.socket() as probe:
        probe.bind(('127.0.0.1',0))
        port=probe.getsockname()[1]
    env['GEN_PORT']=str(port)
    shell='export PATH=/usr/bin:/bin:/c/Windows/System32:/c/Windows/System32/WindowsPowerShell/v1.0; for tool in node python python3 uv; do if command -v "$tool" >/dev/null 2>&1; then echo "Unexpected system runtime: $tool"; exit 1; fi; done; exec sh ./start-generation.sh --cpu'
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    token=''
    def request(path,body=None,headers=None):
        req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=body,headers={'Authorization':'Bearer '+token,**(headers or {})})
        with opener.open(req,timeout=30) as response:
            raw=response.read()
            return json.loads(raw) if 'json' in response.headers.get('Content-Type','') else raw
    report={'commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
            'target':str(target),'command':'sh start-generation.sh --cpu','mirror':'cn',
            'initialResourceDirectoryAbsent':True,'systemRuntimesHidden':True,
            'legacyHomeIsolated':True,'parameters':{'steps':5,'resolution':256,'seed':12345,'targetFaces':12000}}
    began=time.monotonic()
    with (output/'server.log').open('wb') as log:
        process=subprocess.Popen([str(bash),'-c',shell],cwd=target,env=env,stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
        report['launcherPid']=process.pid
        (output/'running.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
        try:
            deadline=time.monotonic()+3600
            last_state=None
            while time.monotonic()<deadline:
                if process.poll() is not None:
                    raise RuntimeError(f'Launcher exited with {process.returncode}; see server.log')
                config=private/'config.json'
                if config.exists():
                    token=json.loads(config.read_text('utf-8'))['token']
                    try:
                        provider=next(p for p in request('/v1/capabilities')['providers'] if p['providerId']=='hunyuan-mini')
                        if provider['state']!=last_state:
                            print('Provider: '+provider['state'],flush=True)
                            last_state=provider['state']
                        if provider['state']=='ready': break
                        if provider['state']=='failed': raise RuntimeError('Model preparation failed: '+json.dumps(provider))
                    except (OSError, StopIteration):
                        pass
                time.sleep(2)
            else:
                raise TimeoutError('Fresh preparation exceeded 60 minutes')
            report['setupSeconds']=round(time.monotonic()-began,2)
            report['device']=request('/v1/info')
            assert report['device']['backend']=='cpu', report['device']
            report['capabilities']=provider
            print(f"CPU model ready after {report['setupSeconds']} seconds",flush=True)
            image=(ROOT/'public/scene-lighting/vase.png').read_bytes()
            metadata={'protocolVersion':1,'providerId':'hunyuan-mini','clientRequestId':'fresh-cpu-20261028',
                      'inputSha256':hashlib.sha256(image).hexdigest(),'seed':12345,'targetFaces':12000,
                      'parameters':{'steps':5,'resolution':256}}
            boundary='gstudio-fresh-validation'
            body=(f'--{boundary}\r\nContent-Disposition: form-data; name="request"\r\nContent-Type: application/json\r\n\r\n'.encode()+json.dumps(metadata).encode()+f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="vase.png"\r\nContent-Type: image/png\r\n\r\n'.encode()+image+f'\r\n--{boundary}--\r\n'.encode())
            started=time.monotonic()
            job=request('/v1/jobs',body,{'Content-Type':'multipart/form-data; boundary='+boundary})
            previous=None
            while time.monotonic()-started<2400:
                job=request('/v1/jobs/'+job['id'])
                state=(job['status'],job['phase'])
                if state!=previous:
                    print('Job: '+' / '.join(state),flush=True)
                    previous=state
                if job['status'] in ('succeeded','failed','cancelled'): break
                time.sleep(2)
            report['generationSeconds']=round(time.monotonic()-started,2)
            report['job']=job
            if job['status']!='succeeded': raise RuntimeError('Generation failed: '+json.dumps(job.get('error',state)))
            model=request('/v1/jobs/'+job['id']+'/outputs/shadow')
            digest=hashlib.sha256(model).hexdigest()
            assert model[:4]==b'glTF' and digest==job['result']['outputs'][0]['sha256']
            (output/'vase.glb').write_bytes(model)
            shutil.copy2(ROOT/'public/scene-lighting/vase.png',output/'input.png')
            marker=json.loads((resource/'platforms/win32-x64/python-cpu/environment.json').read_text('utf-8'))
            report.update(status='passed',outputBytes=len(model),sha256=digest,python=marker['python'])
        except Exception as exc:
            report.update(status='failed',error=str(exc))
            raise
        finally:
            report['totalSeconds']=round(time.monotonic()-began,2)
            (output/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
            subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            process.wait(timeout=30)
            print(json.dumps({k:v for k,v in report.items() if k not in ('job','capabilities')},ensure_ascii=False),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('target',type=Path)
    parser.add_argument('--bash',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    verify(args.target.resolve(),args.bash.resolve(),args.output.resolve())
