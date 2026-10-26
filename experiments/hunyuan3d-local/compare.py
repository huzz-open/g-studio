"""Compare completed real Hunyuan results with the previous local experiments."""
import json
from pathlib import Path
import sys
import numpy as np
from PIL import Image,ImageDraw,ImageFont
import trimesh

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent/'dsh-geometry'))
from evaluate import load_mesh,best_view
from assess import normalize_mask
from render import render


def completed():
    found={}
    for path in sorted((ROOT/'results').glob('*/result.json')):
        data=json.loads(path.read_text(encoding='utf-8'))
        if data.get('status')=='completed':found[Path(data['job']['input']).stem]=(path.parent,data)
    return found


def main():
    found=completed()
    if not found:raise SystemExit('No completed Hunyuan result yet')
    prior=json.loads((ROOT.parent/'geometry-comparison/results/metrics.json').read_text(encoding='utf-8'))['models']
    out=ROOT/'review';out.mkdir(exist_ok=True)
    font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',16)
    columns=['原图','TripoSR','Codex 已有模型','DSH 首轮模型','Hunyuan mini-Turbo','Hunyuan 侧面 +90°']
    sheet=Image.new('RGB',(256*len(columns),300*len(found)+36),(31,36,46));draw=ImageDraw.Draw(sheet)
    for i,label in enumerate(columns):draw.text((i*256+6,8),label,font=font,fill='white')
    metrics={}
    labels={'umbrella':'油纸伞','vase':'花瓶','chair':'椅子'}
    for row,(item,(folder,result)) in enumerate(found.items()):
        y=36+row*300
        original=Image.open(folder/'original.png').convert('RGBA')
        target=normalize_mask(np.asarray(original)[:,:,3]>127)
        mesh=load_mesh(folder/'mesh.glb');fit=best_view(mesh,target)
        thumb=original.copy();thumb.thumbnail((226,246),Image.Resampling.NEAREST)
        bg=Image.new('RGBA',(256,256),(55,61,71,255));bg.alpha_composite(thumb,((256-thumb.width)//2,(256-thumb.height)//2))
        sheet.paste(bg.convert('RGB'),(0,y+28));draw.text((6,y+3),labels[item],font=font,fill='white')
        for col,engine in enumerate(['triposr','codex','dsh'],1):
            entry=prior[item][engine];old=load_mesh(entry['path']);az=entry['best_2d_fit']['azimuth']
            im,_=render(old,azimuth=az,light_azimuth=az-45,size=256,ground=False,shadows=False,clay=True)
            sheet.paste(im,(col*256,y+28));draw.text((col*256+6,y+3),f'{len(old.faces):,} 面',font=font,fill='white')
        for col,az in [(4,fit['azimuth']),(5,fit['azimuth']+90)]:
            im,_=render(mesh,azimuth=az,light_azimuth=az-45,size=256,ground=False,shadows=False,clay=True)
            sheet.paste(im,(col*256,y+28));draw.text((col*256+6,y+3),f'{len(mesh.faces):,} 面 / {az%360}°',font=font,fill='white')
        for light in (25,65):
            im,_=render(mesh,azimuth=fit['azimuth'],light_azimuth=fit['azimuth']-45,light_elevation=light,size=512,clay=True)
            im.save(folder/f'shadow-{light}.png')
        metrics[item]={'folder':str(folder),'faces':len(mesh.faces),'best_2d_fit':fit,
                       'extents':mesh.extents.tolist(),'phases':result['phases'],
                       'watertight':result['mesh']['watertight'],'degenerate_faces':result['mesh']['degenerate_faces']}
    sheet.save(out/'comparison.png')
    (out/'metrics.json').write_text(json.dumps({'model':'Hunyuan3D-2mini-Turbo','method':'20-degree orthographic camera, camera-relative light, uniform clay; 2D fitting is not 3D accuracy.','results':metrics},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(metrics,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
