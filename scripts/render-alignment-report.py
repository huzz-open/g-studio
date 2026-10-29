"""Independent high-resolution validation of saved production mesh projections.

Uses Pillow polygon scan conversion, not the optimizer's rasterizer. Every panel
shares camera, world bounds and image scale. No inference or image synthesis.
"""
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

folder = Path(sys.argv[1] if len(sys.argv) > 1 else 'output/alignment-real-20261029')
report = json.loads((folder / 'report.json').read_text(encoding='utf-8'))
right, up = np.array(report['camera']['RIGHT']), np.array(report['camera']['UP'])
font_path = 'C:/Windows/Fonts/msyh.ttc'
def font(size): return ImageFont.truetype(font_path, size)
background = (20, 25, 31)
colors = {'overlap': (77, 174, 115), 'missing': (244, 150, 67), 'extra': (69, 196, 227)}
stages = [('before', '校准前'), ('sizeOnly', '仅等比尺寸校准'), ('after', '尺寸 + 朝向校准')]
summaries = []
for run in report['runs']:
    name = run['id']; bounds = run['bounds']
    source = Image.open(run['source']).convert('RGBA')
    projected = {}
    for stage, _ in stages:
        vertices = np.fromfile(folder / f'{name}-{stage}.f32', dtype='<f4').reshape(-1, 3)
        projected[stage] = np.stack([vertices @ right, vertices @ up], axis=1).reshape(-1, 3, 2)
    lo = np.array([bounds['left'], bounds['bottom']]); hi = lo + [bounds['width'], bounds['height']]
    for points in projected.values():
        lo = np.minimum(lo, points.min(axis=(0,1))); hi = np.maximum(hi, points.max(axis=(0,1)))
    center = (lo+hi)/2; extent = max(hi-lo)*1.12
    lo, hi = center-extent/2, center+extent/2
    resolution = 1024; scale = resolution/extent
    def screen(points):
        points = np.asarray(points)
        return np.stack([(points[...,0]-lo[0])*scale, (hi[1]-points[...,1])*scale], axis=-1)
    pos = screen([bounds['left'], bounds['bottom']+bounds['height']])
    end = screen([bounds['left']+bounds['width'], bounds['bottom']])
    x,y = np.rint(pos).astype(int); X,Y = np.rint(end).astype(int)
    image = Image.new('RGBA',(resolution,resolution)); image.alpha_composite(source.resize((X-x,Y-y),Image.Resampling.NEAREST),(x,y))
    truth = np.asarray(image)[:,:,3]/255 >= .08
    base = Image.new('RGBA',image.size,background+(255,)); base.alpha_composite(image)
    truth_mask = Image.fromarray(truth.astype('uint8')*255)
    truth_edge = np.asarray(truth_mask.filter(ImageFilter.MaxFilter(3))) != np.asarray(truth_mask.filter(ImageFilter.MinFilter(3)))
    overlays, differences, metrics = {}, {}, {}
    for stage, _ in stages:
        mask = Image.new('L',(resolution,resolution)); draw = ImageDraw.Draw(mask)
        for triangle in screen(projected[stage]): draw.polygon([tuple(p) for p in triangle],fill=255)
        model = np.asarray(mask)>0
        overlap = truth & model; missing = truth & ~model; extra = model & ~truth
        count = int(overlap.sum()); union = int((truth|model).sum())
        metrics[stage] = dict(iou=count/union, recall=count/int(truth.sum()), precision=count/int(model.sum()), extraPixels=int(extra.sum()), missingPixels=int(missing.sum()), evaluationResolution=resolution)
        rgb = np.array(base.convert('RGB'))
        # Image outline magenta, projected model outline cyan. Fill is very light.
        rgb[model] = (.85*rgb[model]+.15*np.array(colors['extra'])).astype('uint8')
        edge = np.asarray(mask.filter(ImageFilter.MaxFilter(5))) != np.asarray(mask.filter(ImageFilter.MinFilter(5)))
        rgb[truth_edge] = (245,111,193); rgb[edge] = colors['extra']
        overlays[stage] = Image.fromarray(rgb)
        diff = np.full((resolution,resolution,3),background,dtype='uint8')
        diff[overlap]=colors['overlap'];diff[missing]=colors['missing'];diff[extra]=colors['extra']
        differences[stage] = Image.fromarray(diff)
        overlays[stage].save(folder / f'{name}-{stage}-overlay.png')
    run['independentMetrics'] = metrics
    panel = 380; gap=22; margin=24; width=margin*2+panel*4+gap*3; height=1050
    sheet=Image.new('RGB',(width,height),(13,18,24));draw=ImageDraw.Draw(sheet)
    draw.text((margin,18),f"真实生成模型验证 · {run['label']}",font=font(29),fill='white')
    draw.text((margin,64),f"Hunyuan Mini  |  {run['triangleCount']:,} 三角面  |  同一正交相机与显示比例  |  未重新生成模型",font=font(17),fill=(169,185,199))
    names=['输入原图']+[label for _,label in stages]
    for col,title in enumerate(names):
        left=margin+col*(panel+gap)
        draw.text((left,110),title,font=font(22),fill='white')
        visual=base.convert('RGB') if col==0 else overlays[stages[col-1][0]]
        sheet.paste(visual.resize((panel,panel),Image.Resampling.LANCZOS),(left,150))
        if col:
            stage=stages[col-1][0];m=metrics[stage]
            draw.text((left,546),f"轮廓 IoU  {m['iou']*100:.1f}%",font=font(23),fill=(138,222,166))
            draw.text((left,584),f"原图覆盖率 {m['recall']*100:.1f}%",font=font(17),fill=(180,193,204))
            sheet.paste(differences[stage].resize((320,320),Image.Resampling.NEAREST),(left+(panel-320)//2,625))
        else:
            draw.text((left,548),'轮廓叠加：',font=font(19),fill='white')
            draw.text((left,580),'紫色 = 原图边缘',font=font(18),fill=(245,111,193))
            draw.text((left,612),'青色 = 模型投影边缘',font=font(18),fill=colors['extra'])
            draw.text((left,670),'下排误差分布：',font=font(19),fill='white')
            for line,(key,label) in enumerate([('overlap','绿色：图像与模型重合'),('missing','橙色：图像有、模型缺失'),('extra','青色：模型多出的区域')]):
                draw.text((left,708+line*35),label,font=font(18),fill=colors[key])
    draw.text((margin,978),'独立 1024×1024 投影验证；IoU 包括图片外多出的几何。下排仅显示误差分类，不是重绘后的原图。',font=font(17),fill=(170,184,197))
    draw.text((margin,1008),f"来源任务：{Path(run['jobDirectory']).name}  |  优化耗时 {run['elapsedMs']/1000:.2f}s",font=font(16),fill=(142,159,175))
    sheet.save(folder/f'{name}-comparison.png')
    summaries.append(dict(id=name,label=run['label'],metrics=metrics,rotation=run['result']['rotation'],elapsedMs=run['elapsedMs']))
(folder/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
(folder/'summary.json').write_text(json.dumps(summaries,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(summaries,ensure_ascii=False,indent=2))
