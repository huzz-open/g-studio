"""Fetch pinned official shape code and public mini-Turbo weights."""
from concurrent.futures import ThreadPoolExecutor,as_completed
import hashlib
import json
from pathlib import Path
import shutil
import sys
import time
import urllib.request

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent/'triposr-local'))
from download import get_json,download,opener
REV='f8db63096c8282cb27354314d896feba5ba6ff8a'
MODEL='tencent/Hunyuan3D-2mini'
SUB='hunyuan3d-dit-v2-mini-turbo'
MIRROR_REV='0d1901d5f6300a268615cff3aff885c4fd494ff5'


def source():
    tree=get_json(f'https://api.github.com/repos/Tencent-Hunyuan/Hunyuan3D-2/git/trees/{REV}?recursive=1')
    selected=[x for x in tree['tree'] if x['type']=='blob' and
              (x['path'].startswith('hy3dgen/shapegen/') or x['path'] in ('hy3dgen/__init__.py','LICENSE','README.md','requirements.txt') or
               (x['path'].startswith('examples/') and x['path'].endswith('.py')))]
    def fetch(x):
        download(f'https://raw.githubusercontent.com/Tencent-Hunyuan/Hunyuan3D-2/{REV}/{x["path"]}',ROOT/'vendor/Hunyuan3D-2'/x['path'],x['size'])
    with ThreadPoolExecutor(max_workers=6) as pool:list(pool.map(fetch,selected))
    (ROOT/'vendor/source-revision.json').write_text(json.dumps({'repository':'https://github.com/Tencent-Hunyuan/Hunyuan3D-2','revision':REV},indent=2))


def ranges(url,dest,size,sha,workers=8):
    if dest.exists() and dest.stat().st_size==size:
        with dest.open('rb') as f:
            if hashlib.file_digest(f,'sha256').hexdigest()==sha:
                print('Weights ready and verified.',flush=True);return
    chunks=dest.parent/'parts';chunks.mkdir(parents=True,exist_ok=True)
    step=16*1024*1024
    def fetch(i):
        start,end=i*step,min((i+1)*step,size)-1
        part=chunks/f'{i:04d}'
        if part.exists() and part.stat().st_size==end-start+1:return part
        for retry in range(6):
            try:
                offset=part.stat().st_size if part.exists() else 0
                if offset>end-start+1:part.unlink();offset=0
                if offset==end-start+1:return part
                current=start+offset
                req=urllib.request.Request(url,headers={'Range':f'bytes={current}-{end}','User-Agent':'local-shape-trial'})
                with opener('modelscope.cn' in url or retry%2==1).open(req,timeout=60) as response:
                    if response.status!=206 or response.headers.get('Content-Range')!=f'bytes {current}-{end}/{size}':
                        raise RuntimeError('Unexpected range response')
                    with part.open('ab' if offset else 'wb') as output:
                        while data:=response.read(1024*1024):output.write(data)
                if part.stat().st_size!=end-start+1:raise RuntimeError('Incomplete chunk')
                return part
            except Exception as error:
                if retry==5:raise
                print(f'Retrying chunk {i}: {str(error)[:180]}',flush=True)
                time.sleep(2)
    count=(size+step-1)//step
    complete=0;tick=time.monotonic()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for future in as_completed([pool.submit(fetch,i) for i in range(count)]):
            part=future.result();complete+=part.stat().st_size
            if time.monotonic()-tick>12 or complete==size:
                print(f'Weights: {complete/2**20:.0f}/{size/2**20:.0f} MiB ({complete/size:.1%})',flush=True);tick=time.monotonic()
    staging=dest.with_suffix('.assembling')
    with staging.open('wb') as out:
        for i in range(count):
            with (chunks/f'{i:04d}').open('rb') as f:shutil.copyfileobj(f,out)
    with staging.open('rb') as f:
        if hashlib.file_digest(f,'sha256').hexdigest()!=sha:raise RuntimeError('Model SHA256 mismatch')
    staging.replace(dest)
    for i in range(count):(chunks/f'{i:04d}').unlink()
    chunks.rmdir()
    print('Model SHA256 verified.',flush=True)


def weights(sub=SUB):
    root=ROOT/'models'/sub;root.mkdir(parents=True,exist_ok=True)
    info=get_json(f'https://huggingface.co/api/models/{MODEL}',True)
    revision=info['sha']
    tree=get_json(f'https://huggingface.co/api/models/{MODEL}/tree/{revision}/{sub}',True)
    for name in ('config.yaml','model.fp16.safetensors'):
        item=next(x for x in tree if x['path']==f'{sub}/{name}')
        url=f'https://huggingface.co/{MODEL}/resolve/{revision}/{sub}/{name}'
        if name.endswith('safetensors'):
            # Public Tencent mirror; its listed SHA256 matches the Hugging Face
            # original. Verify the assembled bytes against the HF digest below.
            url=f'https://modelscope.cn/models/Tencent-Hunyuan/Hunyuan3D-2mini/resolve/{MIRROR_REV}/{sub}/{name}'
            ranges(url,root/name,item['size'],item['lfs']['oid'])
        else:download(url,root/name,item['size'],direct=True)
    for name in ('LICENSE','NOTICE'):
        download(f'https://huggingface.co/{MODEL}/resolve/{revision}/{name}',ROOT/'models'/name,direct=True)
    (root/'provenance.json').write_text(json.dumps({'model':MODEL,'revision':revision,'files':tree,'weight_mirror':'Tencent-Hunyuan/Hunyuan3D-2mini on ModelScope','mirror_revision':MIRROR_REV,'verified_against':'Hugging Face original LFS SHA256'},indent=2))


if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('--source',action='store_true');p.add_argument('--weights',action='store_true');p.add_argument('--vae',action='store_true');a=p.parse_args()
    if a.source:source()
    if a.weights:weights()
    if a.vae:weights('hunyuan3d-vae-v2-mini-turbo')
