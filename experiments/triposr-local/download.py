"""Download official source/weights once; inference itself is entirely offline."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import time
import urllib.request

ROOT = Path(__file__).resolve().parent
SOURCE_REVISION = '107cefdc244c39106fa830359024f6a2f1c78871'


def opener(direct=False):
    return urllib.request.build_opener(urllib.request.ProxyHandler({}) if direct else urllib.request.ProxyHandler())


def get_json(url, direct=False):
    with opener(direct).open(urllib.request.Request(url, headers={"User-Agent": "TripoSR-local-trial"}), timeout=45) as r:
        return json.load(r)


def download(url, dest, size=None, sha256=None, direct=False):
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and (size is None or dest.stat().st_size == size):
        if sha256 is None or hashlib.file_digest(dest.open('rb'), 'sha256').hexdigest() == sha256:
            print('Ready:', dest.name, flush=True)
            return
    partial = dest.with_suffix(dest.suffix + '.part')
    for attempt in range(5):
        try:
            offset = partial.stat().st_size if partial.exists() else 0
            headers = {"User-Agent": "TripoSR-local-trial"}
            if offset:
                headers['Range'] = f'bytes={offset}-'
            with opener(direct).open(urllib.request.Request(url, headers=headers), timeout=60) as response:
                append = offset > 0 and response.status == 206
                count = offset if append else 0
                tick = time.monotonic()
                with partial.open('ab' if append else 'wb') as output:
                    while chunk := response.read(1024 * 1024):
                        output.write(chunk)
                        count += len(chunk)
                        if time.monotonic() - tick > 15:
                            print(f'{dest.name}: {count / 2**20:.1f} MiB', flush=True)
                            tick = time.monotonic()
            if size is not None and partial.stat().st_size != size:
                raise RuntimeError('Incomplete download')
            if sha256 and hashlib.file_digest(partial.open('rb'), 'sha256').hexdigest() != sha256:
                partial.unlink()
                raise RuntimeError('SHA256 mismatch')
            partial.replace(dest)
            print('Downloaded:', dest.name, flush=True)
            return
        except Exception as exc:
            print(f'Download retry {attempt + 1}: {dest.name}: {exc}', flush=True)
            if attempt == 4:
                raise
            time.sleep(2)


def parallel_weights(url, dest, size, sha256, direct=False):
    """Resumable HTTP ranges, with SHA256 validation before publishing the checkpoint."""
    if dest.exists() and dest.stat().st_size == size:
        with dest.open('rb') as source:
            if hashlib.file_digest(source,'sha256').hexdigest() == sha256:
                print('Ready:',dest.name,flush=True)
                return
    chunks = dest.parent/'download-parts'
    chunks.mkdir(parents=True,exist_ok=True)
    step = 32*1024*1024
    prefix = dest.with_suffix(dest.suffix+'.part')
    def fetch(i):
        start,end = i*step,min((i+1)*step,size)-1
        part = chunks/f'{i:04d}'
        expected = end-start+1
        if part.exists() and part.stat().st_size == expected:
            return part
        if prefix.exists() and prefix.stat().st_size >= end+1:
            with prefix.open('rb') as old:
                old.seek(start)
                part.write_bytes(old.read(expected))
            return part
        for retry in range(5):
            try:
                request = urllib.request.Request(url,headers={'Range':f'bytes={start}-{end}', 'User-Agent':'TripoSR-local-trial'})
                with opener(direct).open(request,timeout=60) as response:
                    expected_range = f'bytes {start}-{end}/{size}'
                    if response.status != 206 or response.headers.get('Content-Range') != expected_range:
                        raise RuntimeError('Server did not honor requested range')
                    with part.open('wb') as output:
                        while block := response.read(1024*1024):
                            output.write(block)
                if part.stat().st_size != expected:
                    raise RuntimeError('Incomplete chunk')
                print(f'Model chunk {i+1}/{(size+step-1)//step} ready',flush=True)
                return part
            except Exception:
                if retry == 4:
                    raise
                time.sleep(2)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        parts = list(pool.map(fetch,range((size+step-1)//step)))
    staging = dest.with_suffix('.assembling')
    import shutil
    with staging.open('wb') as output:
        for part in parts:
            with part.open('rb') as source:
                shutil.copyfileobj(source,output)
    with staging.open('rb') as source:
        actual = hashlib.file_digest(source,'sha256').hexdigest()
    if actual != sha256:
        raise RuntimeError('Checkpoint SHA256 mismatch; no model was installed')
    staging.replace(dest)
    for part in parts:
        part.unlink()
    chunks.rmdir()
    if prefix.exists():
        prefix.unlink()
    print('Checkpoint downloaded and SHA256 verified.',flush=True)


def main():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--source-only', action='store_true')
    p.add_argument('--weights-only', action='store_true')
    p.add_argument('--direct', action='store_true', help='Ignore system proxy for Hugging Face')
    args = p.parse_args()
    if not args.weights_only:
        tree = get_json(f'https://api.github.com/repos/VAST-AI-Research/TripoSR/git/trees/{SOURCE_REVISION}?recursive=1')
        revision = tree['sha']
        selected = [x for x in tree['tree'] if x['type'] == 'blob' and
                    (x['path'].startswith('tsr/') or x['path'] in ('LICENSE', 'README.md', 'run.py', 'requirements.txt', 'examples/chair.png'))]
        def fetch(item):
            download(f'https://raw.githubusercontent.com/VAST-AI-Research/TripoSR/{revision}/{item["path"]}',
                     ROOT / 'vendor' / 'TripoSR' / item['path'], item['size'])
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            list(pool.map(fetch, selected))
        (ROOT / 'vendor' / 'source-revision.json').write_text(json.dumps({'repository': 'https://github.com/VAST-AI-Research/TripoSR', 'revision': revision}, indent=2))
    if not args.source_only:
        info = get_json('https://huggingface.co/api/models/stabilityai/TripoSR/tree/main', args.direct)
        for filename in ('config.yaml', 'model.ckpt'):
            item = next(x for x in info if x['path'] == filename)
            transfer = parallel_weights if filename == 'model.ckpt' else download
            transfer(f'https://huggingface.co/stabilityai/TripoSR/resolve/main/{filename}', ROOT / 'models' / filename,
                     item['size'], item.get('lfs', {}).get('oid'), args.direct)
        download('https://huggingface.co/facebook/dino-vitb16/raw/main/config.json', ROOT/'models'/'dino-config.json',direct=args.direct)
        (ROOT / 'models' / 'provenance.json').write_text(json.dumps(info, indent=2))


if __name__ == '__main__':
    main()
