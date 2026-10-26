"""Inspect completed experiments at the previous workflow's 20-degree elevation.

Silhouette IoU is only a 2D registration diagnostic, never a 3D accuracy score.
"""
import argparse
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import trimesh
from render import render


def normalize_mask(mask,size=128):
    ys,xs = np.nonzero(mask)
    if not len(xs):
        return np.zeros((size,size),dtype=bool)
    crop = Image.fromarray((mask[ys.min():ys.max()+1,xs.min():xs.max()+1]*255).astype('uint8'))
    scale = (size-12)/max(crop.size)
    crop = crop.resize((max(1,round(crop.width*scale)),max(1,round(crop.height*scale))),Image.Resampling.NEAREST)
    canvas = Image.new('L',(size,size))
    canvas.paste(crop,((size-crop.width)//2,(size-crop.height)//2))
    return np.asarray(canvas)>127


def evaluate(folder):
    report = json.loads((folder/'result.json').read_text(encoding='utf-8'))
    mesh = trimesh.load(folder/'mesh.glb',force='mesh',process=False)
    original = Image.open(folder/'original.png').convert('RGBA')
    if np.asarray(original)[:,:,3].min() == 255:
        raise ValueError('Silhouette assessment requires original foreground alpha.')
    target = normalize_mask(np.asarray(original)[:,:,3]>127)
    scores = []
    for azimuth in range(0,360,15):
        _,data = render(mesh,azimuth=azimuth,elevation=20,size=128,ground=False,shadows=False)
        mask = normalize_mask(data['mask'])
        iou = np.count_nonzero(target & mask)/max(1,np.count_nonzero(target | mask))
        scores.append({'azimuth':azimuth,'iou':float(iou)})
    best = max(scores,key=lambda row:row['iou'])
    _,data = render(mesh,azimuth=best['azimuth'],elevation=20,size=128,ground=False,shadows=False)
    prediction = normalize_mask(data['mask'])
    overlay = np.full((128,128,3),[31,36,46],dtype='uint8')
    overlay[target & prediction] = [175,190,205]
    overlay[target & ~prediction] = [255,100,90]
    overlay[prediction & ~target] = [50,210,230]
    try:
        font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',16)
    except OSError:
        font = ImageFont.load_default()
    sheet = Image.new('RGB',(1024,310),(31,36,46))
    source = Image.new('RGBA',(256,256),(58,63,72,255))
    original.thumbnail((236,236),Image.Resampling.NEAREST)
    source.alpha_composite(original,((256-original.width)//2,(256-original.height)//2))
    sheet.paste(source.convert('RGB'),(0,34))
    for col,clay in ((1,False),(2,True)):
        preview,_ = render(mesh,azimuth=best['azimuth'],elevation=20,clay=clay,ground=False,size=192)
        sheet.paste(preview.resize((256,256),Image.Resampling.NEAREST),(col*256,34))
    sheet.paste(Image.fromarray(overlay).resize((256,256),Image.Resampling.NEAREST),(768,34))
    draw = ImageDraw.Draw(sheet)
    for col,text in enumerate(('原图',f'生成外观 · {best["azimuth"]}°','实际几何形状',f'轮廓对齐 IoU {best["iou"]:.3f}')):
        draw.text((col*256+8,8),text,font=font,fill='white')
    draw.text((8,289),'灰：重合   红：原图有、模型无   青：模型有、原图无；仅做二维居中缩放，不证明三维正确',font=font,fill='white')
    sheet.save(folder/'comparison.png')
    assessment = {'elevation':20,'azimuth_step':15,'best':best,'all_views':scores,
                  'method':'Both silhouettes independently cropped, uniformly scaled and centered; no warp.',
                  'warning':'2D fitting diagnostic only; not a 3D accuracy measure.',
                  'input':report['input'],'triangles':len(mesh.faces),'timings_seconds':report['timings_seconds']}
    (folder/'assessment.json').write_text(json.dumps(assessment,ensure_ascii=False,indent=2),encoding='utf-8')
    print(f'{folder.name}: best silhouette IoU {best["iou"]:.3f} at {best["azimuth"]} degrees',flush=True)
    return assessment


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('folders',type=Path,nargs='+')
    args = p.parse_args()
    for folder in args.folders:
        evaluate(folder)
