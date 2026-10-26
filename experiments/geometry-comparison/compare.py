"""Compare existing Codex, DSH first-pass and TripoSR geometry on equal display settings."""
import hashlib
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
import trimesh

ROOT=Path(__file__).resolve().parent
DSH=ROOT.parent/'dsh-geometry'
TRIPO=ROOT.parent/'triposr-local'
sys.path.insert(0,str(DSH))
from evaluate import load_mesh, best_view, BASELINES, LABELS
from render import render
from assess import normalize_mask

ENGINE_NAMES={'codex':'Codex 已有模型','dsh':'DSH 首轮模型','triposr':'TripoSR'}


def export_codex(raw):
    out=ROOT/'models';out.mkdir(exist_ok=True)
    records={}
    for key,record in raw['models'].items():
        data=np.asarray(record['vertices'],dtype=float).reshape(-1,9)
        # Right-handed rotation +90 degrees about X: Y-up -> Z-up.
        position=data[:,[0,2,1]].copy();position[:,1]*=-1
        normals=data[:,[3,5,4]].copy();normals[:,1]*=-1
        lo,hi=position.min(0),position.max(0)
        offset=np.array([-(lo[0]+hi[0])/2,-(lo[1]+hi[1])/2,-lo[2]])
        scale=2/np.max(hi-lo)
        position=(position+offset)*scale
        colors=np.column_stack([np.clip(data[:,6:9],0,1)**(1/2.2)*255,np.full(len(data),255)]).astype('uint8')
        faces=np.arange(len(position)).reshape(-1,3)
        mesh=trimesh.Trimesh(vertices=position,faces=faces,vertex_normals=normals,vertex_colors=colors,process=False)
        target=out/f'codex-{key}.glb';mesh.export(target)
        loaded=load_mesh(target)
        # GLB export must preserve the original triangle soup and its positions.
        assert len(loaded.faces)==record['triangleCount']
        np.testing.assert_allclose(loaded.vertices,position,atol=2e-7)
        records[key]={'mesh':str(target),'original_triangles':record['triangleCount'],
                      'axis_conversion':'(x,y,z) -> (x,-z,y)',
                      'offset_after_rotation':offset.tolist(),'uniform_scale':float(scale),
                      'geometry_edits':'none; only rigid axis conversion, centering and uniform normalization',
                      'mesh_sha256':hashlib.sha256(target.read_bytes()).hexdigest()}
    return records


def cell(mesh,azimuth,*,size=320,ground=True,shadows=True):
    # Keep the light relative to the viewing direction, for consistent illumination.
    return render(mesh,azimuth=azimuth,light_azimuth=azimuth-45,elevation=20,
                  size=size,ground=ground,shadows=shadows,clay=True)


def main():
    raw=json.loads((ROOT/'codex-raw.json').read_text())
    converted=export_codex(raw)
    out=ROOT/'results';out.mkdir(exist_ok=True)
    font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',18)
    width,height=320,370
    sheet=Image.new('RGB',(width*4,height*3+44),(31,36,46));draw=ImageDraw.Draw(sheet)
    for i,label in enumerate(['原图',*ENGINE_NAMES.values()]):
        draw.text((width*i+8,10),label,font=font,fill='white')
    metrics={}
    for row,key in enumerate(BASELINES):
        source=DSH/'trials/trial-01/inputs'/f'{key}.png'
        original=Image.open(source).convert('RGBA')
        target=normalize_mask(np.asarray(original)[:,:,3]>127)
        y=44+row*height
        draw.text((8,y+4),LABELS[key],font=font,fill='white')
        thumb=original.copy();thumb.thumbnail((280,310),Image.Resampling.NEAREST)
        bg=Image.new('RGBA',(width,width),(55,61,71,255))
        bg.alpha_composite(thumb,((width-thumb.width)//2,(width-thumb.height)//2))
        sheet.paste(bg.convert('RGB'),(0,y+30))
        paths={'codex':ROOT/'models'/f'codex-{key}.glb',
               'dsh':DSH/'trials/trial-01/outputs'/f'{key}.glb',
               'triposr':TRIPO/'results'/BASELINES[key]/'mesh.glb'}
        metrics[key]={}
        for col,(engine,path) in enumerate(paths.items(),1):
            mesh=load_mesh(path)
            fitted=best_view(mesh,target)
            az=fitted['azimuth']
            image,_=cell(mesh,az)
            sheet.paste(image,(col*width,y+30))
            draw.text((col*width+8,y+4),f'{len(mesh.faces):,} 面 · IoU {fitted["iou"]:.3f}',font=font,fill='white')
            dest=out/key/engine;dest.mkdir(parents=True,exist_ok=True)
            views=Image.new('RGB',(4*320,350),(31,36,46));vd=ImageDraw.Draw(views)
            for view in range(4):
                angle=(az+view*90)%360
                im,_=cell(mesh,angle)
                views.paste(im,(view*320,30));vd.text((view*320+8,6),f'{angle}°',font=font,fill='white')
            views.save(dest/'views.png')
            # Native 640px geometry diagnostic, with no texture and no shadow map.
            high,data=cell(mesh,az,size=640,ground=False,shadows=False)
            high.save(dest/'clay-640.png')
            normal=np.clip((data['normal']*.5+.5)*255,0,255).astype('uint8')
            Image.fromarray(np.dstack([normal,(data['mask']*255).astype('uint8')])).save(dest/'geometry-normal.png')
            valid=data['mask'];depth=data['depth'][valid];depth_png=np.zeros(valid.shape,'uint16')
            depth_png[valid]=1+np.rint((depth-depth.min())/max(float(np.ptp(depth)),1e-9)*65534).astype('uint16')
            Image.fromarray(depth_png).save(dest/'geometry-depth16.png')
            metrics[key][engine]={'path':str(path),'faces':len(mesh.faces),'vertices':len(mesh.vertices),
                                  'best_2d_fit':fitted,'extent':mesh.extents.tolist(),
                                  'mesh_sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
        # Large vase detail: all original geometry, no color textures or shadows.
    sheet.save(out/'three-way.png')
    detail=Image.new('RGB',(3*640,680),(31,36,46));dd=ImageDraw.Draw(detail)
    for col,(engine,label) in enumerate(ENGINE_NAMES.items()):
        detail.paste(Image.open(out/'vase'/engine/'clay-640.png'),(col*640,40))
        dd.text((col*640+12,10),label+' · 原生640像素 / 纯色 / 关闭阴影',font=font,fill='white')
    detail.save(out/'vase-surface-detail.png')
    report={'codex_export':converted,'source_provenance':raw['provenance'],
            'method':{'elevation':20,'projection':'orthographic','size_normalization':'longest dimension = 2',
                      'light':'azimuth = camera azimuth - 45 degrees; elevation = 45 degrees',
                      'geometry':'No smoothing, remeshing, retopology or manual correction',
                      'view_alignment':'15-degree azimuth search by centered, uniformly scaled silhouette IoU',
                      'display':'Native 320px overview, native 640px clay diagnostics; no nearest-neighbor enlargement'},
            'caveats':['Codex models were authored and iterated in the earlier task, not a fresh blind single-prompt run.',
                       'Silhouette IoU is not 3D accuracy. Different model assumptions affect invisible surfaces.'],
            'models':metrics}
    (out/'metrics.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    for key,data in metrics.items():
        print(key, {engine:(item['faces'],round(item['best_2d_fit']['iou'],3)) for engine,item in data.items()})


if __name__=='__main__':
    main()
