"""Pure algorithm relief audit; no AI and no inferred ground heights."""
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt, label
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import lsqr


def integrate(normal, mask):
    # OpenGL tangent normal convention used by generator.ts; image Y points down.
    ids=np.full(mask.shape,-1,int); ids[mask]=np.arange(mask.sum())
    n=normal.astype(float)/255*2-1
    valid=mask & (n[...,2] > 0.01)
    p=-n[...,0]/np.maximum(n[...,2],.01)
    q=n[...,1]/np.maximum(n[...,2],.01)
    rows=[];cols=[];data=[];rhs=[]
    for dy,dx,gradient in [(0,1,p),(1,0,q)]:
        for y,x in zip(*np.where(valid)):
            yy,xx=y+dy,x+dx
            if yy>=mask.shape[0] or xx>=mask.shape[1] or not valid[yy,xx]:continue
            k=len(rhs);rows.extend([k,k]);cols.extend([ids[y,x],ids[yy,xx]]);data.extend([-1,1]);rhs.append((gradient[y,x]+gradient[yy,xx])/2)
    edges=len(rhs)
    components,count=label(mask)
    for c in range(1,count+1):
        y,x=np.argwhere(components==c)[0]
        rows.append(len(rhs));cols.append(ids[y,x]);data.append(1);rhs.append(0.)
    a=coo_matrix((data,(rows,cols)),shape=(len(rhs),int(mask.sum()))).tocsr()
    result=lsqr(a,np.array(rhs),atol=1e-8,btol=1e-8,iter_lim=5000)
    z=np.zeros(mask.shape);z[mask]=result[0]
    residual=(a@result[0]-rhs)[:edges]
    return z,dict(components=count,stop=int(result[1]),iterations=int(result[2]),gradient_rmse=float(np.sqrt(np.mean(residual**2))),invalid_normals=int((mask&~valid).sum()))


def main():
    assets=Path('C:/data/code/huzz-game/Demo/game/assets/qfz-sprites')
    out=Path('C:/Users/19796/.codex/visualizations/2026/10/25/01a171be-7c27-7b11-b588-85276f88de6e/pure-algorithm-height');out.mkdir(exist_ok=True)
    sheet=Image.new('RGB',(900,960),(30,30,30));draw=ImageDraw.Draw(sheet);records=[]
    for row,number in enumerate([10,15,17]):
        name=f'sprite-{number:02d}'
        rgba=Image.open(assets/(name+'.png')).convert('RGBA');normal=np.asarray(Image.open(assets/(name+'_normal.png')).convert('RGB'))
        mask=np.asarray(rgba)[...,3]>=128
        edt=distance_transform_edt(np.pad(mask,1))[1:-1,1:-1]
        z,metrics=integrate(normal,mask)
        np.savez_compressed(out/(name+'.npz'),distance_px=edt,relative_relief=z,mask=mask)
        record=dict(name=name,alpha_threshold=128,normal_convention='OpenGL, no XY inversion assumed',**metrics);records.append(record)
        background=Image.new('RGBA',rgba.size,(80,80,80,255));background.alpha_composite(rgba)
        images=[background.convert('RGB')]
        for values in [edt,z]:
            lo,hi=np.percentile(values[mask],[0,100]);gray=np.zeros(mask.shape,dtype=np.uint8);gray[mask]=np.clip((values[mask]-lo)/max(hi-lo,1e-9)*255,0,255)
            images.append(Image.fromarray(gray).convert('RGB'))
        for col,im in enumerate(images):
            im.thumbnail((270,270),Image.Resampling.NEAREST);sheet.paste(im,(col*300+(300-im.width)//2,row*320+35))
            draw.text((col*300+10,row*320+10),[name+' original','Euclidean distance (px)','Normal integration (relative)'][col],fill='white')
    sheet.save(out/'comparison.png')
    (out/'results.json').write_text(json.dumps(records,indent=2),encoding='utf-8')
    (out/'report.html').write_text('''<!doctype html><meta charset="utf-8"><title>纯算法高度初稿</title><style>body{background:#202020;color:#ddd;max-width:1000px;margin:32px auto;font:16px system-ui;line-height:1.7}img{width:100%}</style><h1>纯算法初稿：轮廓距离与法线积分</h1><p>没有使用 AI。左：原图；中：SciPy 精确欧氏距离变换；右：掩码内法线梯度的稀疏最小二乘积分（LSQR）。Alpha 阈值为 128。假定输入为 OpenGL 法线且未翻转 XY。</p><p>距离变换只给出离轮廓距离；积分只恢复相对浮雕，每个连通区域固定一个零值以消除常数自由度。两者都不是离地高度，未用它们直接投射地面阴影。灰度独立归一化，仅供观察。</p><img src="comparison.png"><h2>最小修正入口</h2><p>接地点解决零高度；整体高度解决尺度，但两者仍不足以确定每个像素的离地高度。允许用户圈定顶部等高度区域、接地位置，再用标准的带边界条件拉普拉斯插值生成区域内部初稿；不同部件可分区，避免把伞面、支杆或桌腿强行当成同一表面。插值结果仍需实际阴影对照验收。</p><p>本轮没有伪造这些区域标注，也未将数据接入正式面板。下一阶段应在原图上显示可编辑约束及其影响，明确哪些来自算法、哪些来自用户。</p><p><a href="https://docs.scipy.org/doc/scipy/reference/generated/scipy.ndimage.distance_transform_edt.html">距离变换实现</a> · <a href="https://docs.scipy.org/doc/scipy/reference/generated/scipy.sparse.linalg.lsqr.html">LSQR 实现</a> · <a href="results.json">求解指标</a></p>''',encoding='utf-8')
    print(json.dumps(records,indent=2))

if __name__=='__main__':main()
