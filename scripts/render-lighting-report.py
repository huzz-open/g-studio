"""Compose actual WebGL screenshots and on/off-shadow diagnostics. No relighting."""
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

folder=Path(sys.argv[1] if len(sys.argv)>1 else 'output/lighting-real-20261029')
report=json.loads((folder/'lighting-report.json').read_text(encoding='utf-8'))
font=lambda size: ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',size)
for run in report['results']:
    name=run['id']
    load=lambda suffix: Image.open(folder/f'{name}-{suffix}.png').convert('RGB')
    source=Image.open(folder/f'{name}-screen-mask.png').convert('RGBA')
    mask=np.asarray(source)[:,:,3]>=21
    ys,xs=np.where(mask);cx=(xs.min()+xs.max())/2;cy=(ys.min()+ys.max())/2
    height=max(ys.max()-ys.min()+60,(xs.max()-xs.min()+60)*360/560);width=height*560/360
    crop=(round(cx-width/2),round(cy-height/2),round(cx+width/2),round(cy+height/2))
    metrics={}
    for light in ['point','directional','point-right']:
        metrics[light]={}
        for stage in ['before','after']:
            lit=np.asarray(load(f'{stage}-{light}-lit')).astype(float)
            unshadowed=np.asarray(load(f'{stage}-{light}-no-shadow')).astype(float)
            darkening=np.maximum(0,unshadowed-lit).mean(axis=2)
            affected=darkening>3
            metrics[light][stage]={'spriteShadowAffectedFraction':float(affected[mask].mean()),'groundShadowAffectedScreenPixels':int((affected & ~mask).sum()),'spriteMeanRGB':float(lit[mask].mean()),'spriteMeanRGBWithoutShadow':float(unshadowed[mask].mean()),'thresholdRGB':3}
            # Difference visualization is diagnostic only; all lit frames are unmodified.
            heat=np.zeros((*mask.shape,3),dtype=np.uint8)+20
            heat[affected&~mask]=[65,180,225];heat[affected&mask]=[245,150,65]
            Image.fromarray(heat).save(folder/f'{name}-{stage}-{light}-shadow-difference.png')
    run['pixelDiagnostics']=metrics
    sheet=Image.new('RGB',(1168,1344),(15,20,26));d=ImageDraw.Draw(sheet)
    d.text((24,18),f"{run['label']} · 实际 WebGL 光照与阴影",font=font(27),fill='white')
    d.text((24,58),'同一原图、法线、灯光、相机和位置；仅改变派生几何。上两排为完整画面。' if run.get('repair') else '同一原图、法线设置、灯光、相机、位置；只替换校准参数。上两排为完整画面。',font=font(16),fill=(174,190,204))
    for i,title in enumerate(['已对齐 · 检查前','检查后 · 保留原几何'] if run.get('repair',{}).get('status','repaired').startswith('unsupported') else ['已对齐 · 几何修复前','已对齐 · 几何修复后'] if run.get('repair') else ['校准前','尺寸 + 朝向校准后']):d.text((24+i*584,95),title,font=font(24),fill='white')
    rows=[('point-lit','左前上方点光源：灯位 (-3, 4, 4)，强度 24',False),('directional-lit','右侧低角度方向光：方位 70°，仰角 28°，强度 1.1',False),('point-geometry','同一相机的实际几何局部：检查朝向与表面，不叠加原图',True)]
    for row,(suffix,title,detail) in enumerate(rows):
        y=140+row*392;d.text((24,y),title,font=font(17),fill=(173,194,209))
        for col,stage in enumerate(['before','after']):
            image=load(f'{stage}-{suffix}')
            if detail:image=image.crop(crop)
            sheet.paste(image.resize((560,360),Image.Resampling.LANCZOS),(24+col*584,y+26))
    d.text((24,1320),f"真实烘焙几何覆盖率：{run['coverage']['before']*100:.2f}% → {run['coverage']['after']*100:.2f}% ；覆盖率不等于光照正确率。",font=font(16),fill=(190,205,216))
    sheet.save(folder/f'{name}-lighting-comparison.png')
    detail=Image.new('RGB',(1168,930),(15,20,26));d=ImageDraw.Draw(detail)
    d.text((24,18),f"{run['label']} · 点光源下的阴影开关诊断（同位置裁切）",font=font(25),fill='white')
    for col,stage in enumerate(['before','after']):
        d.text((24+584*col,65),'校准前' if col==0 else '校准后',font=font(23),fill='white')
        for row,suffix in enumerate(['point-lit','point-no-shadow']):
            y=110+row*400;d.text((24+584*col,y),'阴影开启' if row==0 else '阴影关闭',font=font(18),fill=(184,201,213))
            detail.paste(load(f'{stage}-{suffix}').crop(crop).resize((560,360),Image.Resampling.LANCZOS),(24+584*col,y+28))
    detail.save(folder/f'{name}-shadow-toggle.png')
(folder/'lighting-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps([{ 'id':r['id'],'coverage':r['coverage'],'pixelDiagnostics':r['pixelDiagnostics']} for r in report['results']],ensure_ascii=False,indent=2))
