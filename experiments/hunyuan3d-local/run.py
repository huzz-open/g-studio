"""Run real Hunyuan mini-Turbo inference, one memory-bounded CPU phase at a time."""
import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parent
SAMPLES=ROOT.parent/'dsh-geometry/trials/trial-01/inputs'


def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run_phase(name,folder,args):
    command=[sys.executable,'-u',str(ROOT/'phase.py'),name,str(folder),'--steps',str(args.steps),
             '--resolution',str(args.resolution),'--chunks',str(args.chunks),'--seed',str(args.seed)]
    print(f'START {folder.name} / {name}',flush=True)
    started=time.perf_counter();last=0
    with (folder/f'{name}.log').open('w',encoding='utf-8') as log:
        process=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,
            encoding='utf-8',errors='replace',env={**os.environ,'PYTHONIOENCODING':'utf-8'},
            creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        try:
            for line in process.stdout:
                log.write(line);log.flush()
                if '%' not in line or time.monotonic()-last>20:
                    print(line.rstrip(),flush=True);last=time.monotonic()
            code=process.wait()
        except BaseException:
            process.terminate();process.wait();raise
    if code:raise RuntimeError(f'{name} failed with exit {code}; see {folder/name}.log')
    print(f'FINISH {name}: {time.perf_counter()-started:.1f}s',flush=True)


def finish(folder,job):
    import numpy as np
    import trimesh
    sys.path.insert(0,str(ROOT.parent/'triposr-local'))
    from render import render,export_maps
    from PIL import Image,ImageDraw
    mesh=trimesh.load(folder/'raw.glb',force='mesh',process=False)
    if not np.isfinite(mesh.vertices).all():raise ValueError('Non-finite output vertices')
    # Hunyuan/glTF is Y-up; the existing local comparison renderer is Z-up.
    rotation=trimesh.transformations.rotation_matrix(np.pi/2,[1,0,0])
    mesh.apply_transform(rotation)
    lo,hi=mesh.bounds.copy();scale=2/max(hi-lo)
    offset=np.array([-(lo[0]+hi[0])/2,-(lo[1]+hi[1])/2,-lo[2]])
    mesh.vertices=(mesh.vertices+offset)*scale
    mesh.visual=trimesh.visual.ColorVisuals(mesh=mesh,vertex_colors=np.tile([168,196,216,255],(len(mesh.vertices),1)))
    mesh.export(folder/'mesh.glb')
    mesh.export(folder/'mesh.ply')
    views=Image.new('RGB',(4*320,2*350),(31,36,46));draw=ImageDraw.Draw(views)
    for col,az in enumerate((0,90,180,270)):
        for row,ground in enumerate((False,True)):
            im,_=render(mesh,azimuth=az,light_azimuth=az-45,clay=True,size=320,ground=ground,shadows=ground)
            views.paste(im,(col*320,row*350+30))
            draw.text((col*320+8,row*350+8),f'{az} deg / {"shadow" if ground else "geometry"}',fill='white')
    views.save(folder/'views.png')
    maps=export_maps(mesh,folder/'maps',0,20)
    phases={name:json.loads((folder/f'{name}-stats.json').read_text()) for name in ('encode','sample','mesh')}
    report={'schema':'hunyuan-local-trial/v1','status':'completed','model':'Hunyuan3D-2mini-Turbo',
            'vae':'hunyuan3d-vae-v2-mini-turbo','device':'cpu','dtype':'float32','job':job,'phases':phases,
            'source':json.loads((ROOT/'vendor/source-revision.json').read_text()),
            'mesh':{'vertices':len(mesh.vertices),'triangles':len(mesh.faces),'bounds':mesh.bounds.tolist(),
                    'watertight':bool(mesh.is_watertight),'winding_consistent':bool(mesh.is_winding_consistent),
                    'degenerate_faces':int((mesh.area_faces<1e-12).sum())},
            'display_transform':{'rotation':'Y-up -> Z-up: (x,y,z) -> (x,-z,y)',
                                 'offset_after_rotation':offset.tolist(),'scale':float(scale)},
            'maps':maps,'postprocessing':'No smoothing, simplification, hole filling or manual geometry repair.',
            'limitations':['Single-view inferred geometry; hidden surfaces have no ground truth.',
                           'CPU float32 runtime; official examples use CUDA float16.',
                           'Texture generation is intentionally omitted: evaluating geometry and shadows.']}
    (folder/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(f'RESULT: {folder}',flush=True)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--samples',nargs='+',choices=['umbrella','vase','chair'],default=['umbrella','vase','chair'])
    p.add_argument('--steps',type=int,default=5)
    p.add_argument('--resolution',type=int,default=380)
    p.add_argument('--chunks',type=int,default=2048)
    p.add_argument('--seed',type=int,default=12345)
    p.add_argument('--resume',type=Path)
    args=p.parse_args()
    for sub in ('hunyuan3d-dit-v2-mini-turbo','hunyuan3d-vae-v2-mini-turbo'):
        if not (ROOT/'models'/sub/'model.fp16.safetensors').exists():raise SystemExit(f'Missing {sub} weights')
    folders=[]
    for item in args.samples:
        source=SAMPLES/f'{item}.png'
        folder=args.resume.resolve() if args.resume else ROOT/'results'/f'{item}-{datetime.now():%Y%m%d-%H%M%S}'
        folder.mkdir(parents=True,exist_ok=True)
        job={'input':str(source),'sha256':digest(source),'steps':args.steps,'resolution':args.resolution,'chunks':args.chunks,'seed':args.seed}
        if (folder/'job.json').exists():
            if json.loads((folder/'job.json').read_text())!=job:raise SystemExit('Resume settings or input mismatch')
        else:
            (folder/'job.json').write_text(json.dumps(job,indent=2),encoding='utf-8')
            shutil.copyfile(source,folder/'original.png')
        for phase,artifact in [('encode','condition.pt'),('sample','latents.pt'),('mesh','raw.glb')]:
            if not (folder/artifact).exists():run_phase(phase,folder,args)
        finish(folder,job);folders.append(str(folder))
        if args.resume:break
    (ROOT/'latest.json').write_text(json.dumps({'results':folders},indent=2),encoding='utf-8')


if __name__=='__main__':main()
