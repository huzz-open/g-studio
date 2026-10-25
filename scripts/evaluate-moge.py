"""Offline joint-geometry audit. Does not infer a receiver from synthetic background.

Postprocessing follows MoGe v2 infer (nearest 64x64 focal/shift fit, projection).
Model/source provenance is recorded with results. No production rendering is changed.
"""
import argparse
import hashlib
import importlib.util
import json
import html
import time
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw
from scipy.optimize import least_squares

spec = importlib.util.spec_from_file_location('camera_eval', Path(__file__).with_name('evaluate-camera.py'))
camera = importlib.util.module_from_spec(spec)
spec.loader.exec_module(camera)
SHA = '24eacb5dc7a2c54c7bc98f7de085ffbed79ad006ea5b664c2c2cdc02ff3a52f0'


def uv_grid(height, width):
    y, x = np.indices((height, width))
    return np.stack([2*x+1-width, 2*y+1-height], -1) / np.hypot(height, width)


def recover(points, mask):
    h, w = mask.shape
    iy = np.floor(np.arange(64)*h/64).astype(int)
    ix = np.floor(np.arange(64)*w/64).astype(int)
    keep = mask[iy[:, None], ix]
    xyz = points[iy[:, None], ix][keep].astype(np.float64)
    uv = uv_grid(h, w)[iy[:, None], ix][keep]
    if len(xyz) < 2:
        raise ValueError('Insufficient valid points for camera recovery')
    def focal_at(shift):
        projected = xyz[:, :2] / (xyz[:, 2:] + shift)
        focal = np.sum(projected*uv) / np.sum(projected**2)
        return focal, projected
    def residual(shift):
        focal, projected = focal_at(shift)
        return (focal*projected-uv).ravel()
    fit = least_squares(residual, np.array([0.0]), method='lm', ftol=1e-3)
    shift = float(np.float32(fit.x[0]))
    focal, _ = focal_at(shift)
    if not fit.success or not np.isfinite(focal) or focal <= 0:
        raise ValueError('Invalid recovered camera')
    return float(focal), shift, float(np.sqrt(np.mean(residual(shift)**2)))


def postprocess(raw):
    points = raw['points'][0].astype(np.float32)
    mask = raw['mask'][0] > .5
    focal, shift, residual = recover(points, mask)
    z = points[..., 2] + shift
    mask &= (z > 0) & np.isfinite(z)
    scale = float(raw['metric_scale'].ravel()[0])
    xyz = np.concatenate([uv_grid(*z.shape)/focal*z[..., None], z[..., None]], -1)*scale
    xyz[~mask] = np.nan
    h, w = z.shape
    fpx = focal*np.hypot(h, w)/2
    return xyz, mask, dict(focal_relative_diagonal=focal, shift=shift, predicted_scale=scale,
                          focal_px=fpx, vertical_fov_deg=float(np.degrees(2*np.arctan(h/(2*fpx)))),
                          projection_fit_rms=residual, intrinsics=[[fpx, 0, w/2], [0, fpx, h/2], [0, 0, 1]])


def compare(a, b, keep):
    keep = keep & np.isfinite(a).all(-1) & np.isfinite(b).all(-1)
    if keep.sum() < 20:
        return {'valid': False}
    za, zb = a[..., 2][keep], b[..., 2][keep]
    extent = max(float(np.percentile(za,95)-np.percentile(za,5)), 1e-9)
    ratio = float(np.median(za)/np.median(zb))
    return dict(valid=True, pixels=int(keep.sum()),
                depth_rank_correlation=camera.depth_eval.spearmanr(za,zb).statistic,
                depth_rmse_after_scale_over_range=float(np.sqrt(np.mean((za-ratio*zb)**2))/extent),
                scale_alignment=ratio)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--assets', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--model', type=Path, default=Path('node_modules/.cache/depth-eval/moge2-small.onnx'))
    parser.add_argument('--reuse-results', action='store_true', help='Reuse this audit\'s saved raw outputs after provenance checks')
    args = parser.parse_args()
    if hashlib.sha256(args.model.read_bytes()).hexdigest() != SHA:
        raise ValueError('Model checksum mismatch')
    options = ort.SessionOptions(); options.intra_op_num_threads=4; options.inter_op_num_threads=1
    session = ort.InferenceSession(str(args.model), sess_options=options, providers=['CPUExecutionProvider'])
    args.output.mkdir(parents=True, exist_ok=True)
    records, rows = [], []
    previous = json.loads((args.output/'moge-results.json').read_text(encoding='utf-8')) if args.reuse_results else None
    if previous and previous['sha256'] != SHA:
        raise ValueError('Cached model differs')
    for number, label in camera.depth_eval.SAMPLES:
        name = f'sprite-{number:02d}'
        source = args.assets / (name+'.png')
        rgba=Image.open(source).convert('RGBA')
        rgb, fg, mapping = camera.canonical_input(rgba)
        alpha=np.zeros(fg.shape,dtype=np.uint8)
        resized_alpha=np.asarray(rgba.crop(mapping['bbox']).getchannel('A').resize(mapping['size'],Image.Resampling.NEAREST))
        pad=mapping['pad'];alpha[pad:pad+resized_alpha.shape[0],pad:pad+resized_alpha.shape[1]]=resized_alpha
        if previous:
            saved=next(r for r in previous['records'] if r['name']==name)
            if saved['source_sha256'] != hashlib.sha256(source.read_bytes()).hexdigest():
                raise ValueError('Cached source differs')
        cases = {}; previews=[]
        for variant,tokens in [('baseline',1200),('mirror',1200),('detail',1800)]:
            pixels = np.asarray(rgb,dtype=np.float32)/255
            if variant=='mirror': pixels=pixels[:,::-1].copy()
            start=time.perf_counter()
            if previous:
                with np.load(args.output/f'{name}-moge-{variant}.npz') as archive:
                    raw={k:archive[k] for k in ['points','normal','mask','metric_scale']}
            else:
                values=session.run(None,{'image':pixels.transpose(2,0,1)[None], 'num_tokens':np.array(tokens,dtype=np.int64)})
                raw=dict(zip([o.name for o in session.get_outputs()],values))
            if 'scale' in raw:
                raw['metric_scale']=raw.pop('scale')
            xyz,mask,calib=postprocess(raw)
            elapsed=saved['conditions'][variant]['seconds'] if previous else time.perf_counter()-start
            normal=raw['normal'][0]
            np.savez_compressed(args.output/f'{name}-moge-{variant}.npz', **raw, projected_points=xyz, valid=mask,
                                intrinsics=np.array(calib['intrinsics']), foreground=fg[:,::-1] if variant=='mirror' else fg)
            if variant=='mirror':
                xyz=xyz[:,::-1].copy();xyz[...,0]*=-1; mask=mask[:,::-1];normal=normal[:,::-1].copy();normal[...,0]*=-1
            stats=dict(**calib,seconds=elapsed,foreground_coverage=float(mask[fg.astype(bool)].mean()),
                       visible_foreground_coverage=float(mask[alpha>0].mean()),opaque_fraction_of_visible=float((alpha>=250).sum()/(alpha>0).sum()))
            cases[variant]=(xyz,mask,normal,stats)
            valid=(alpha>0)&mask
            depth=xyz[...,2]; lo,hi=np.percentile(depth[valid],[2,98])
            gray=np.clip((np.nan_to_num(depth,nan=lo)-lo)/max(hi-lo,1e-9),0,1)
            colored=cv2.applyColorMap((gray*255).astype(np.uint8),cv2.COLORMAP_TURBO)[...,::-1];colored[~valid]=32
            previews.append(Image.fromarray(colored))
            print(name,variant,round(elapsed,2),'s',flush=True)
        baseline=cases['baseline']
        record=dict(name=name,label=label,source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),mapping=mapping,
                    conditions={k:v[3] for k,v in cases.items()}, comparisons={})
        for key in ['mirror','detail']:
            other=cases[key];keep=fg.astype(bool)&baseline[1]&other[1]
            record['comparisons'][key]=compare(baseline[0],other[0],keep)
            dot=np.sum(baseline[2][keep]*other[2][keep],axis=-1)
            record['comparisons'][key]['normal_median_difference_deg']=float(np.median(np.degrees(np.arccos(np.clip(dot,-1,1)))))
        record['shadow_eligible']=False
        record['reason']='No observed receiver plane, gravity, or contact constraint in RGBA input; synthetic background excluded.'
        records.append(record)
        row=Image.new('RGB',(1000,280),(24,24,24));draw=ImageDraw.Draw(row)
        for i,im in enumerate([rgb]+previews):
            im=im.copy(); im.thumbnail((240,240));row.paste(im,(i*250+(250-im.width)//2,32))
            draw.text((i*250+8,8),[name+' source','MoGe 1200 depth','Mirrored input depth','MoGe 1800 depth'][i],fill='white')
        rows.append(row)
        (args.output/'moge-results.json').write_text(json.dumps(dict(model='Ruicheng/moge-2-vits-normal-onnx',
            revision='e50ffda41565591092adea54c6ac83d6212e1e23',sha256=SHA,
            postprocess_source='microsoft/MoGe@74fbce054ebed49800de42d0ad0e83495065719a',
            note='Model predictions and sensitivity, not measured geometry or accuracy. Generated source normals are not independent observations.',
            records=records),ensure_ascii=False,indent=2),encoding='utf-8')
    sheet=Image.new('RGB',(1000,280*len(rows)))
    for i,row in enumerate(rows):sheet.paste(row,(0,280*i))
    sheet.save(args.output/'moge-comparison.png')
    table=''
    for r in records:
        a,b=r['conditions']['baseline'],r['comparisons']['mirror']
        table+=f"<tr><td>{html.escape(r['name']+' '+r['label'])}</td><td>{a['foreground_coverage']:.1%}</td><td>{a['vertical_fov_deg']:.1f}°</td><td>{b['depth_rank_correlation']:.3f}</td><td>{b['depth_rmse_after_scale_over_range']:.1%}</td><td>{b['normal_median_difference_deg']:.1f}°</td></tr>"
    (args.output/'moge-report.html').write_text('''<!doctype html><meta charset="utf-8"><title>二维素材联合几何评估</title>
<style>body{background:#181b20;color:#e1e5eb;font:16px system-ui;max-width:1100px;margin:32px auto;line-height:1.7}td,th{padding:10px;border-bottom:1px solid #444}img{width:100%}a{color:#9bc3ff}</style>
<h1>MoGe 联合几何评估</h1><p>同一批 8 个二维素材；统一透明裁边、尺寸与灰色背景。每个素材测试原向 1200 tokens、水平镜像 1200 tokens 和原向 1800 tokens。模型在本机 CPU 运行。</p>
<p>下面是预测稳定性，不是真实几何精度。相机参数和尺度也是模型预测；灰色背景由程序填入，没有资格作为真实地面。源法线来自原图，不是独立几何测量，本次未将其作为额外观测输入。</p>
<table><tr><th>素材</th><th>前景覆盖</th><th>预测垂直视角</th><th>镜像深度相关</th><th>深度差 / 深度范围</th><th>法线差中位数</th></tr>'''+table+'''</table>
<p>数值比较使用 alpha≥250 的内部像素；对照图展示全部 alpha>0 的有效预测像素，包括半透明边缘。覆盖率只表示模型有输出，不代表预测正确。深度对比仅允许正比例尺度对齐，不额外拟合深度偏移。各图单独按前景深度 2–98 百分位着色，因此色彩相似不能替代数值对照。</p>
<img src="moge-comparison.png"><h2>投影判断</h2><p>当前没有观测到接收阴影的平面，也没有独立的重力方向或接触约束。因此本轮没有把任何样本标为可可靠生成落地阴影。生成阴影仍需选定这些条件；本次没有偷偷填入默认条件。</p>
<p><a href="moge-results.json">完整数据、模型版本和校验信息</a> · <a href="report.html">前两阶段报告</a> · <a href="https://github.com/microsoft/MoGe/blob/74fbce054ebed49800de42d0ad0e83495065719a/docs/onnx.md">官方 ONNX 文档</a></p>''',encoding='utf-8')


if __name__=='__main__':
    main()
