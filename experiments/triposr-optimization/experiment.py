"""Controlled local TripoSR optimization trial. No training or external API."""
import argparse
from datetime import datetime
import gc
import hashlib
import json
import os
from pathlib import Path
import sys
import time

os.environ['HF_HUB_OFFLINE']='1'
os.environ['TRANSFORMERS_OFFLINE']='1'
os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
ROOT=Path(__file__).resolve().parent
TRIPO=ROOT.parent/'triposr-local'
sys.path.insert(0,str(TRIPO))

import numpy as np
from PIL import Image,ImageFilter,ImageDraw,ImageFont
import trimesh
from scipy import ndimage
from render import render

BASELINES={'umbrella':'油纸伞-20261026-153921-635092','vase':'青花瓷瓶-20261026-153935-548975','chair':'靠背椅-20261026-153948-987451'}
LABELS={'umbrella':'油纸伞','vase':'花瓶','chair':'椅子'}
VARIANTS={
    'baseline96':'原方案 96',
    'grid256':'仅网格升至 256',
    'official96':'官方预处理 96',
    'official256':'官方预处理＋256',
    'blur96':'输入高斯模糊 2px',
    'fg70':'前景占比约 70%',
    'taubin20':'原网格平滑 20 步',
    'taubin80':'原网格平滑 80 步',
}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def foreground_input(original,side=358):
    im=original.convert('RGBA');crop=im.crop(im.getchannel('A').getbbox())
    factor=side/max(crop.size)
    crop=crop.resize((max(1,round(crop.width*factor)),max(1,round(crop.height*factor))),Image.Resampling.NEAREST)
    bg=Image.new('RGBA',(512,512),(128,128,128,255))
    bg.alpha_composite(crop,((512-crop.width)//2,(512-crop.height)//2))
    return bg.convert('RGB')


def anchor(mesh,scale):
    """Translate to own ground/XY center, but retain baseline scale: do not hide shrinkage."""
    mesh=mesh.copy()
    lo,hi=mesh.bounds
    offset=np.array([-(lo[0]+hi[0])/2,-(lo[1]+hi[1])/2,-lo[2]])
    mesh.vertices=(mesh.vertices+offset)*scale
    return mesh


def render_view(mesh,azimuth=0,size=384,ground=False,shadows=False):
    return render(mesh,azimuth=azimuth,light_azimuth=azimuth-45,light_elevation=45,
                  elevation=20,size=size,clay=True,ground=ground,shadows=shadows)


def mask_stats(mesh,azimuth):
    _,data=render_view(mesh,azimuth,size=256)
    mask=data['mask']
    enclosed=ndimage.binary_fill_holes(mask)&~mask
    labels,count=ndimage.label(enclosed)
    areas=np.bincount(labels.ravel())[1:]
    return {'silhouette_pixels':int(mask.sum()),'enclosed_hole_pixels':int(enclosed.sum()),
            'holes_at_least_4_pixels':int((areas>=4).sum())},mask


def save_result(raw,baseline_raw,out,item,variant,settings,timings,baseline_scale):
    folder=out/item/variant;folder.mkdir(parents=True,exist_ok=True)
    raw.export(folder/'raw.glb')
    mesh=anchor(raw,baseline_scale)
    mesh.export(folder/'mesh.glb')
    base=anchor(baseline_raw,baseline_scale)
    front_stat,mask=mask_stats(mesh,0)
    _,base_mask=mask_stats(base,0)
    side_stat,_=mask_stats(mesh,90)
    extent_ratio=(raw.extents/baseline_raw.extents).tolist()
    metrics={'faces':len(mesh.faces),'vertices':len(mesh.vertices),
             'watertight':bool(mesh.is_watertight),'winding_consistent':bool(mesh.is_winding_consistent),
             'degenerate_faces':int((mesh.area_faces<1e-12).sum()),
             'components':len(trimesh.graph.connected_components(mesh.face_adjacency,nodes=np.arange(len(mesh.faces)))),
             'bounds':mesh.bounds.tolist(),'extents_vs_baseline':extent_ratio,
             'front_mask':front_stat,'side_mask':side_stat,
             'front_iou_with_baseline':float(np.count_nonzero(mask&base_mask)/max(1,np.count_nonzero(mask|base_mask)))}
    if variant.startswith('taubin'):
        delta=np.linalg.norm(raw.vertices-baseline_raw.vertices,axis=1)*baseline_scale
        metrics['vertex_displacement']={'mean':float(delta.mean()),'max':float(delta.max())}
        assert np.array_equal(raw.faces,baseline_raw.faces),'Postprocessing changed topology'
    if item=='umbrella':
        slices={}
        for z in (.4,.8):
            segments=trimesh.intersections.mesh_plane(mesh,[0,0,1],[0,0,z])
            slices[str(z)]=None if not len(segments) else np.ptp(segments.reshape(-1,3),axis=0)[:2].tolist()
        metrics['lower_shaft_slice_xy_extent']=slices
    for azimuth in (0,90,180,270):
        image,_=render_view(mesh,azimuth,size=384)
        image.save(folder/f'clay-{azimuth}.png')
    for angle in (25,65):
        im,_=render(mesh,azimuth=0,light_azimuth=-45,light_elevation=angle,clay=True,size=384)
        im.save(folder/f'shadow-{angle}.png')
    result={'item':item,'variant':variant,'settings':settings,'timings_seconds':timings,
            'display_transform':'each mesh grounded/XY-centered; same uniform scale derived from baseline96; no rescaling after smoothing',
            'metrics':metrics,'mesh_sha256':sha(folder/'mesh.glb')}
    (folder/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(f'{item}/{variant}: {len(mesh.faces)} faces; infer {timings.get("inference",0):.1f}s; extract {timings.get("extraction",0):.1f}s',flush=True)
    return result


def summarize(out,records):
    font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',16)
    # All changes retained in full-width sheets; compact summary is written separately.
    for item in BASELINES:
        if item not in records:
            continue
        sheet=Image.new('RGB',(256*len(VARIANTS),3*286),(31,36,46));draw=ImageDraw.Draw(sheet)
        for col,(variant,label) in enumerate(VARIANTS.items()):
            folder=out/item/variant
            for row,filename in enumerate(('clay-0.png','clay-90.png','shadow-25.png')):
                if (folder/filename).exists():
                    im=Image.open(folder/filename).resize((256,256),Image.Resampling.LANCZOS)
                    sheet.paste(im,(col*256,row*286+30))
                draw.text((col*256+7,row*286+5),label+(' · 正面',' · 侧面',' · 阴影')[row],font=font,fill='white')
        sheet.save(out/f'{item}-all.png')
    cols=['baseline96','official256','blur96','taubin80','taubin320'] if all('taubin320' in v for v in records.values()) else ['baseline96','official256','blur96','taubin20','taubin80']
    compact=Image.new('RGB',(280*len(cols),310*len(records)),(31,36,46));draw=ImageDraw.Draw(compact)
    for row,item in enumerate(records):
        for col,variant in enumerate(cols):
            folder=out/item/variant
            if (folder/'clay-0.png').exists():
                im=Image.open(folder/'clay-0.png').resize((280,280),Image.Resampling.LANCZOS)
                compact.paste(im,(col*280,row*310+30))
            draw.text((col*280+6,row*310+6),LABELS[item]+' · '+VARIANTS[variant],font=font,fill='white')
    compact.save(out/'overview.png')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--items',nargs='+',choices=list(BASELINES),default=list(BASELINES))
    args=p.parse_args()
    out=ROOT/'results'/datetime.now().strftime('%Y%m%d-%H%M%S')
    out.mkdir(parents=True,exist_ok=False)
    print('OUTPUT:',out,flush=True)
    import torch
    from compat import install
    install(TRIPO)
    from tsr.system import TSR
    from tsr.utils import resize_foreground
    torch.set_num_threads(4)
    torch.manual_seed(0)
    start=time.perf_counter()
    model=TSR.from_pretrained(str(TRIPO/'models'),'config.yaml','model.ckpt').eval()
    model.renderer.set_chunk_size(8192)
    load_seconds=time.perf_counter()-start
    print(f'Model loaded on CPU in {load_seconds:.1f}s',flush=True)
    results={}
    for item in args.items:
        source=TRIPO/'results'/BASELINES[item]
        original=Image.open(source/'original.png').convert('RGBA')
        baseline_image=Image.open(source/'input.png').convert('RGB')
        official=resize_foreground(original,.85)
        arr=np.asarray(official).astype('float32')/255
        official=Image.fromarray(((arr[:,:,:3]*arr[:,:,3:4]+(1-arr[:,:,3:4])*.5)*255).astype('uint8'))
        # Official preprocessor receives the padded native-sized image and internally
        # resizes bilinearly to 512; do not substitute our own resizer here.
        inputs={'baseline96':baseline_image,'official96':official,
                'blur96':baseline_image.filter(ImageFilter.GaussianBlur(2)),
                'fg70':foreground_input(original,358)}
        results[item]={}
        baseline_raw=None;scale=None
        for tag,input_image in inputs.items():
            input_folder=out/item/tag;input_folder.mkdir(parents=True,exist_ok=True)
            input_image.save(input_folder/'input.png')
            print(f'{item}/{tag}: inference...',flush=True)
            start=time.perf_counter()
            with torch.inference_mode():
                scene=model([input_image],device='cpu')
            infer=time.perf_counter()-start
            for resolution in ([96,256] if tag in ('baseline96','official96') else [96]):
                variant=tag if resolution==96 else ('grid256' if tag=='baseline96' else 'official256')
                start=time.perf_counter()
                print(f'{item}/{variant}: extracting {resolution} grid...',flush=True)
                with torch.inference_mode():
                    mesh=model.extract_mesh(scene,True,resolution=resolution,threshold=25)[0]
                mesh.fix_normals(multibody=True)
                extraction=time.perf_counter()-start
                if not np.isfinite(mesh.vertices).all() or not len(mesh.faces):
                    raise RuntimeError('Invalid mesh')
                if variant=='baseline96':
                    baseline_raw=mesh.copy();scale=2/max(mesh.extents)
                    old=trimesh.load(source/'mesh.glb',force='mesh',process=False)
                    reproduced=anchor(mesh,scale)
                    assert len(old.faces)==len(mesh.faces),'Baseline face count failed to reproduce'
                    np.testing.assert_allclose(old.vertices,reproduced.vertices,atol=1e-5)
                settings={'input':tag,'resolution':resolution,'threshold':25,'smoothing':None,'input_sha256':sha(input_folder/'input.png')}
                results[item][variant]=save_result(mesh,baseline_raw,out,item,variant,settings,{'inference':infer,'extraction':extraction},scale)
                if variant=='baseline96':
                    for steps in (20,80):
                        smoothed=mesh.copy();start=time.perf_counter()
                        trimesh.smoothing.filter_taubin(smoothed,lamb=.5,nu=.51,iterations=steps)
                        elapsed=time.perf_counter()-start
                        smooth_settings={**settings,'smoothing':{'algorithm':'Taubin','lamb':.5,'nu':.51,'iterations':steps}}
                        results[item][f'taubin{steps}']=save_result(smoothed,baseline_raw,out,item,f'taubin{steps}',smooth_settings,{'postprocess':elapsed},scale)
                del mesh
                gc.collect()
            del scene
            gc.collect()
        (out/'results.json').write_text(json.dumps({'load_seconds':load_seconds,'device':'cpu','records':results},ensure_ascii=False,indent=2),encoding='utf-8')
        summarize(out,results)
    (ROOT/'latest.json').write_text(json.dumps({'output':str(out),'completed':True},ensure_ascii=False,indent=2),encoding='utf-8')
    print('COMPLETED:',out,flush=True)


if __name__=='__main__':
    main()
