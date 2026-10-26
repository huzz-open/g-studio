"""Independently inspect DSH-generated meshes; never alter their geometry."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
import trimesh

ROOT = Path(__file__).resolve().parent
TRIPO = ROOT.parent/'triposr-local'
sys.path.insert(0,str(TRIPO))
from render import render, export_maps
from assess import normalize_mask

BASELINES = {
    'umbrella':'油纸伞-20261026-153921-635092',
    'vase':'青花瓷瓶-20261026-153935-548975',
    'chair':'靠背椅-20261026-153948-987451',
}
LABELS = {'umbrella':'油纸伞','vase':'青花瓷瓶','chair':'靠背椅'}


def load_mesh(path):
    mesh = trimesh.load(path,force='mesh',process=False)
    if not isinstance(mesh,trimesh.Trimesh) or not len(mesh.faces):
        raise ValueError(f'No triangle mesh in {path}')
    if not np.isfinite(mesh.vertices).all():
        raise ValueError(f'Non-finite vertices in {path}')
    if not hasattr(mesh.visual,'vertex_colors'):
        mesh.visual = mesh.visual.to_color()
    return mesh


def best_view(mesh,target):
    scores=[]
    for azimuth in range(0,360,15):
        _,data=render(mesh,azimuth=azimuth,size=128,ground=False,shadows=False,clay=True)
        pred=normalize_mask(data['mask'])
        score=np.count_nonzero(pred & target)/max(1,np.count_nonzero(pred | target))
        scores.append({'azimuth':azimuth,'iou':float(score)})
    return max(scores,key=lambda row:row['iou'])


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('trial',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    out=args.output.resolve()
    out.mkdir(parents=True,exist_ok=True)
    font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',16)
    overview=Image.new('RGB',(5*220,3*254+40),(31,36,46))
    draw=ImageDraw.Draw(overview)
    for i,label in enumerate(['原图','DSH 几何','DSH 侧面 +90°','DSH 投影','TripoSR 几何/投影']):
        draw.text((i*220+6,8),label,font=font,fill='white')
    results={}
    for row,key in enumerate(BASELINES):
        source=args.trial/'inputs'/f'{key}.png'
        mesh_path=args.trial/'outputs'/f'{key}.glb'
        mesh=load_mesh(mesh_path)
        original=Image.open(source).convert('RGBA')
        mask=normalize_mask(np.asarray(original)[:,:,3]>127)
        best=best_view(mesh,mask)
        baseline=load_mesh(TRIPO/'results'/BASELINES[key]/'mesh.glb')
        baseline_view=best_view(baseline,mask)
        y=40+row*254
        draw.text((6,y),LABELS[key],font=font,fill='white')
        thumb=original.copy();thumb.thumbnail((202,210),Image.Resampling.NEAREST)
        bg=Image.new('RGBA',(220,220),(55,61,71,255))
        bg.alpha_composite(thumb,((220-thumb.width)//2,(220-thumb.height)//2))
        overview.paste(bg.convert('RGB'),(0,y+25))
        for col,model,azimuth,ground in [(1,mesh,best['azimuth'],False),(2,mesh,best['azimuth']+90,False),
                                        (3,mesh,best['azimuth'],True),(4,baseline,baseline_view['azimuth'],True)]:
            im,_=render(model,azimuth=azimuth,ground=ground,clay=True)
            overview.paste(im.resize((220,220),Image.Resampling.NEAREST),(col*220,y+25))
        dest=out/key;dest.mkdir(exist_ok=True)
        sheet=Image.new('RGB',(4*256,2*282),(31,36,46));labels=ImageDraw.Draw(sheet)
        for col in range(4):
            azimuth=(best['azimuth']+90*col)%360
            for mode in range(2):
                im,_=render(mesh,azimuth=azimuth,clay=bool(mode))
                sheet.paste(im.resize((256,256),Image.Resampling.NEAREST),(col*256,mode*282+26))
                labels.text((col*256+6,mode*282+4),f'{azimuth} deg / {"geometry" if mode else "color"}',fill='white')
        sheet.save(dest/'views.png')
        for elevation in (25,65):
            im,data=render(mesh,azimuth=best['azimuth'],light_elevation=elevation,clay=True)
            im.resize((576,576),Image.Resampling.NEAREST).save(dest/f'shadow-{elevation}.png')
        map_meta=export_maps(mesh,dest/'maps',best['azimuth'],20)
        (dest/'maps'/'camera.json').write_text(json.dumps(map_meta,indent=2),encoding='utf-8')
        components=trimesh.graph.connected_components(mesh.face_adjacency,nodes=np.arange(len(mesh.faces)))
        results[key]={'source':str(source.resolve()),'mesh':str(mesh_path.resolve()),
                      'mesh_sha256':hashlib.sha256(mesh_path.read_bytes()).hexdigest(),
                      'vertices':len(mesh.vertices),'faces':len(mesh.faces),
                      'bounds':mesh.bounds.tolist(),'extents':mesh.extents.tolist(),
                      'watertight':bool(mesh.is_watertight),'winding_consistent':bool(mesh.is_winding_consistent),
                      'degenerate_faces':int(np.count_nonzero(mesh.area_faces<1e-12)),
                      'face_components':len(components),'best_2d_fit':best,'triposr_2d_fit':baseline_view,
                      'coordinate_checks':{'grounded':bool(abs(mesh.bounds[0,2])<1e-5),
                                           'xy_centered':bool(np.max(np.abs(mesh.bounds.mean(axis=0)[:2]))<1e-5),
                                           'longest_dimension_2':bool(abs(mesh.extents.max()-2)<1e-5)}}
    overview.save(out/'comparison.png')
    report={'method':'Same CPU rasterizer and light for both sources. No geometry repair or rescaling.',
            'silhouette_method':'20 degree elevation; 15 degree azimuth search; masks independently cropped, uniformly scaled and centered.',
            'warning':'Silhouette IoU measures 2D fit only, not 3D accuracy. Invisible geometry has no ground truth.',
            'results':results}
    (out/'metrics.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(results,ensure_ascii=False,indent=2))


if __name__=='__main__':
    main()
