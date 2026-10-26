"""Offline image -> TripoSR -> mesh -> deterministic shadow/normal/depth experiment."""
import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import time

ROOT = Path(__file__).resolve().parent
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'


def prepare_image(path, output, prepared_rgb=False):
    import numpy as np
    from PIL import Image
    original = Image.open(path).convert('RGBA')
    original.save(output/'original.png')
    if prepared_rgb:
        image = original.convert('RGB').resize((512,512), Image.Resampling.LANCZOS)
    else:
        alpha = np.asarray(original)[:,:,3]
        if alpha.min() == 255:
            raise ValueError('Input must be a transparent PNG. Use --prepared-rgb only for an already centered image on 50% gray.')
        bbox = original.getchannel('A').getbbox()
        if bbox is None:
            raise ValueError('Image is completely transparent.')
        cropped = original.crop(bbox)
        scale = 434/max(cropped.size)
        resized = cropped.resize((max(1,round(cropped.width*scale)),max(1,round(cropped.height*scale))), Image.Resampling.NEAREST)
        square = Image.new('RGBA',(512,512),(128,128,128,255))
        square.alpha_composite(resized, ((512-resized.width)//2,(512-resized.height)//2))
        image = square.convert('RGB')
    image.save(output/'input.png')
    return image


def previews(mesh, output):
    from PIL import Image, ImageDraw
    from render import render, export_maps
    sheet = Image.new('RGB',(4*256,2*282),(31,36,46))
    draw = ImageDraw.Draw(sheet)
    for i, azimuth in enumerate((0,90,180,270)):
        for row, clay in enumerate((False,True)):
            im,_ = render(mesh,azimuth=azimuth,clay=clay,size=192)
            im = im.resize((256,256),Image.Resampling.NEAREST)
            sheet.paste(im,(i*256,row*282+26))
            draw.text((i*256+8,row*282+6),f'{azimuth} deg / {"geometry" if clay else "vertex color"}',fill='white')
    sheet.save(output/'views.png')
    maps = export_maps(mesh,output/'maps')
    for angle in (25,65):
        image,_ = render(mesh,light_elevation=angle)
        image.resize((576,576),Image.Resampling.NEAREST).save(output/f'shadow-light-{angle}.png')
    return maps


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('images',nargs='+',type=Path)
    p.add_argument('--output',type=Path,default=ROOT/'results')
    p.add_argument('--resolution',type=int,choices=(32,64,96,128,192,256),default=96)
    p.add_argument('--device',choices=('cpu','cuda'),default='cpu')
    p.add_argument('--threads',type=int,default=4)
    p.add_argument('--prepared-rgb',action='store_true')
    args = p.parse_args()
    if args.threads < 1:
        p.error('--threads must be positive')
    for f in ('config.yaml','model.ckpt','dino-config.json'):
        if not (ROOT/'models'/f).is_file():
            raise SystemExit(f'Missing models/{f}. Run download.py first.')
    print('Loading local TripoSR checkpoint (no network)...',flush=True)
    start = time.perf_counter()
    import torch
    import transformers
    import numpy as np
    from compat import install
    install(ROOT)
    from tsr.system import TSR
    torch.set_num_threads(args.threads)
    if args.device == 'cuda' and not torch.cuda.is_available():
        raise SystemExit('CUDA requested but unavailable.')
    model = TSR.from_pretrained(str(ROOT/'models'),'config.yaml','model.ckpt').to(args.device).eval()
    model.renderer.set_chunk_size(8192)
    load_seconds = time.perf_counter()-start
    print(f'Model ready in {load_seconds:.1f}s',flush=True)
    for path in args.images:
        output = args.output/f'{path.stem}-{datetime.now():%Y%m%d-%H%M%S-%f}'
        output.mkdir(parents=True,exist_ok=False)
        image = prepare_image(path,output,args.prepared_rgb)
        print(f'Inferring {path.name} on {args.device}...',flush=True)
        start = time.perf_counter()
        with torch.inference_mode():
            scene = model([image],device=args.device)
        if args.device == 'cuda':
            torch.cuda.synchronize()
        inference_seconds = time.perf_counter()-start
        print(f'Inference: {inference_seconds:.1f}s. Extracting grid {args.resolution}...',flush=True)
        start = time.perf_counter()
        with torch.inference_mode():
            mesh = model.extract_mesh(scene,True,resolution=args.resolution)[0]
        if len(mesh.faces) == 0 or not np.isfinite(mesh.vertices).all():
            raise RuntimeError('Model produced no valid surface.')
        mesh.fix_normals(multibody=True)
        mesh.export(output/'raw.glb')
        raw_bounds = mesh.bounds.copy()
        scale = 2/float(np.max(mesh.extents))
        translation = np.array([-(raw_bounds[0,0]+raw_bounds[1,0])/2,
                                -(raw_bounds[0,1]+raw_bounds[1,1])/2,-raw_bounds[0,2]])
        mesh.vertices = (mesh.vertices+translation)*scale
        mesh.export(output/'mesh.glb')
        mesh.export(output/'mesh.ply')
        extraction_seconds = time.perf_counter()-start
        print(f'Mesh: {len(mesh.vertices)} vertices, {len(mesh.faces)} triangles; {extraction_seconds:.1f}s. Rendering...',flush=True)
        start = time.perf_counter()
        maps = previews(mesh,output)
        report = {'schema':'triposr-local-experiment/v1','status':'completed',
                  'input':str(path.resolve()),'input_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                  'model':'stabilityai/TripoSR','source':json.loads((ROOT/'vendor/source-revision.json').read_text()),
                  'offline':True,'device':args.device,'torch':torch.__version__,'python':platform.python_version(),
                  'transformers':transformers.__version__,
                  'threads':args.threads,'resolution':args.resolution,'density_threshold':25,
                  'marching_cubes':'scikit-image CPU adapter; official network and weights',
                  'timings_seconds':{'load':load_seconds,'inference':inference_seconds,
                                     'mesh':extraction_seconds,'preview':time.perf_counter()-start},
                  'mesh':{'vertices':len(mesh.vertices),'triangles':len(mesh.faces),'watertight':bool(mesh.is_watertight),
                          'bounds':mesh.bounds.tolist(),'up_axis':'Z','units':'normalized, longest dimension = 2',
                          'raw_to_normalized':{'translation_before_scale':translation.tolist(),'scale':scale}},
                  'maps':maps,'limitations':['Inferred hidden geometry; not ground truth.',
                      'Vertex colors contain source lighting; not intrinsic albedo.',
                      'No semantic component segmentation or primitive JSON.',
                      'Original sprite camera/scale/contact alignment needs manual fitting.',
                      'Directional hard shadows in desktop preview; no Web integration.']}
        (output/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print(f'RESULT: {output.resolve()}',flush=True)
        del scene,mesh


if __name__ == '__main__':
    main()
