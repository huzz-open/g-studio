"""Render measured masks; no generated imagery or hand-edited result illustrations."""
import html
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

folder = Path(sys.argv[1] if len(sys.argv) > 1 else 'output/registration-validation-20261031')
report = json.loads((folder / 'report.json').read_text(encoding='utf-8'))
font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 14)
methods = ['initial', 'legacy', 'camera', 'cameraAbove', 'oracle']
rows = []
geometry_rows = []
gallery = Image.new('RGB', (1320, 280 * len(report['runs'])), '#17191d')
draw = ImageDraw.Draw(gallery)
for row, case in enumerate(report['runs']):
    width, height = case['width'], case['height']
    rgba = np.fromfile(folder / (case['id'] + '-target.rgba'), dtype=np.uint8).reshape(height, width, 4)
    target = rgba[:, :, 3] >= 21
    image = Image.fromarray(rgba, 'RGBA')
    image.save(folder / (case['id'] + '-target.png'))
    cells = [f'<td><b>{html.escape(case["id"])}</b><br>{html.escape(case["assumption"])}<br><img src="{case["id"]}-target.png"></td>']
    thumb = image.copy(); thumb.thumbnail((208, 218))
    gallery.paste(thumb, (6, row * 280 + 48), thumb)
    draw.text((6, row * 280 + 7), case['id'], fill='white', font=font)
    draw.text((6, row * 280 + 25), 'Target image', fill='#bbb', font=font)
    for col, method in enumerate(methods, 1):
        value = case['methods'].get(method)
        if value is None:
            cells.append('<td>Not available</td>'); continue
        mask = np.fromfile(folder / f'{case["id"]}-{method}.mask', dtype=np.uint8).reshape(height, width).astype(bool)
        rgb = np.full((height, width, 3), [23, 25, 29], dtype=np.uint8)
        rgb[target & mask] = [220, 225, 230]
        rgb[target & ~mask] = [80, 160, 255]
        rgb[~target & mask] = [255, 100, 90]
        overlay = Image.fromarray(rgb); name = f'{case["id"]}-{method}.png'; overlay.save(folder / name)
        overlay.thumbnail((208, 218)); gallery.paste(overlay, (col * 220 + 6, row * 280 + 48))
        rmse = value['heldoutRMSE']; metric = f'IoU {value["iou"]:.3f}' + (f' / RMS {rmse:.2f}px' if rmse is not None else '')
        draw.text((col * 220 + 6, row * 280 + 7), method, fill='white', font=font)
        draw.text((col * 220 + 6, row * 280 + 25), metric, fill='#bbb', font=font)
        angles = f'<br>pitch {value["pitch"]:.2f}, yaw {value["yaw"]:.2f}' if 'pitch' in value else ''
        cells.append(f'<td><img src="{name}"><br>{metric}{angles}</td>')
    rows.append('<tr>' + ''.join(cells) + '</tr>')
    if case['source']:
        previews = [f'<td>{case["id"]}<br><img src="{case["id"]}-target.png"></td>']
        for method in methods:
            raw = folder / f'{case["id"]}-{method}-mesh.rgba'
            if not raw.exists():
                previews.append('<td>Not available</td>'); continue
            mesh_image = Image.frombytes('RGBA', (width, height), raw.read_bytes())
            name = f'{case["id"]}-{method}-mesh.png'; mesh_image.save(folder / name)
            background = Image.new('RGBA', (width, height), '#17191d')
            overlay = Image.blend(Image.alpha_composite(background, image), Image.alpha_composite(background, mesh_image), .5)
            overlay_name = f'{case["id"]}-{method}-blend.png'; overlay.save(folder / overlay_name)
            previews.append(f'<td><img src="{name}"><br><img src="{overlay_name}"></td>')
        geometry_rows.append('<tr>' + ''.join(previews) + '</tr>')
gallery.save(folder / 'comparison.png')
selected = ['assembly-47-60', 'sheet-1-25', 'real-umbrella', 'real-barrel']
indexes = [i for i, c in enumerate(report['runs']) if c['id'] in selected]
summary = Image.new('RGB', (1320, 280 * len(indexes)), '#17191d')
for i, row in enumerate(indexes):
    summary.paste(gallery.crop((0, row * 280, 1320, (row + 1) * 280)), (0, i * 280))
summary.save(folder / 'summary.png')
page = '''<!doctype html><meta charset="utf-8"><title>Camera registration validation</title>
<style>body{font:15px system-ui;background:#17191d;color:#ddd;margin:24px}table{border-collapse:collapse}td,th{border:1px solid #444;padding:10px;vertical-align:top}img{width:200px;height:220px;object-fit:contain}p{max-width:1100px;line-height:1.6}</style>
<h1>相机—模型配准验证</h1>
<p>白色：重合；蓝色：模型遗漏；红色：模型超出。所有投影在原图画布上独立复核，未以各自包围盒重新居中评分。</p>
<p>initial：20°/25° 固定观察角，仅对齐尺度和画面位置；legacy：现有姿态拟合及表面保留约束，不含网格修复；camera：固定几何、上方向、零相机滚转的轮廓相机搜索；cameraAbove：再加入统一的 0°～85° 俯视约束；oracle：由合成真值提供已知对应点的参考解，不是自动匹配算法。</p>
<p>RMS 使用未参与 oracle 拟合的对应点；部分是合成场景中已知、现实图像未必可见的点，只用于信息受控实验。对称体的同索引点 RMS 不作姿态正确性结论。真实生成模型没有真值角度，因此不报告其姿态准确率。透视、遮挡、像素化、形状不一致用于检验假设边界。</p>
<p>本报告比较的旧方法与相机方法具有不同搜索维度和表面约束，不能把差异全部归因于“旋转相机优于旋转模型”。未接入生产优化流程。</p>
<table><tr><th>参考图</th><th>固定角度</th><th>现有算法</th><th>相机搜索</th><th>仅允许俯视</th><th>已知对应参考解</th></tr>'''
(folder / 'report.html').write_text(page + ''.join(rows) + '</table><h2>真实模型：深度测试后的几何与原图叠加</h2><p>仅用于查看结构，不是阴影效果验证。位置和尺度完全沿用配准结果。</p><table><tr><th>原图</th><th>固定角度</th><th>现有拟合</th><th>相机搜索</th><th>仅允许俯视</th><th>已知对应参考解</th></tr>' + ''.join(geometry_rows) + '</table>', encoding='utf-8')
print(folder / 'report.html')
