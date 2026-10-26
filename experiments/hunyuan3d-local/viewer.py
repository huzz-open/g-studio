"""Local native viewer for real Hunyuan geometry and prior baselines."""
import json
import os
from pathlib import Path
import sys
import tkinter as tk
from tkinter import ttk
import numpy as np
from PIL import Image,ImageTk
import trimesh
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent/'triposr-local'))
from render import render


class Viewer:
    def __init__(self,w):
        self.w=w;self.pending=None;self.mesh=None
        self.records=json.loads((ROOT/'review/metrics.json').read_text(encoding='utf-8'))['results']
        self.prior=json.loads((ROOT.parent/'geometry-comparison/results/metrics.json').read_text(encoding='utf-8'))['models']
        self.names={label:key for label,key in [('油纸伞','umbrella'),('花瓶','vase'),('椅子','chair')] if key in self.records}
        w.title('Hunyuan3D 本地实测 · 模型与阴影对比');w.geometry('1080x850')
        side=ttk.Frame(w,padding=12);side.pack(side='left',fill='y')
        self.item=tk.StringVar(value=next(iter(self.names)))
        self.engine=tk.StringVar(value='Hunyuan mini-Turbo')
        self.quality=tk.StringVar(value='减面预览')
        for label,var,values in [('物品',self.item,list(self.names)),('模型',self.engine,['Hunyuan mini-Turbo','TripoSR','Codex','DSH'])]:
            ttk.Label(side,text=label).pack(anchor='w');box=ttk.Combobox(side,textvariable=var,values=values,state='readonly',width=30)
            box.pack(fill='x',pady=(0,8));box.bind('<<ComboboxSelected>>',lambda _:self.load())
        ttk.Label(side,text='Hunyuan 网格版本').pack(anchor='w')
        quality=ttk.Combobox(side,textvariable=self.quality,values=['原始网格','仅清理','减面预览'],state='readonly',width=30)
        quality.pack(fill='x',pady=(0,8));quality.bind('<<ComboboxSelected>>',lambda _:self.load())
        self.original=ttk.Label(side);self.original.pack(pady=8)
        self.az=self.slider(side,'观察方位',0,360,0)
        self.el=self.slider(side,'俯视角度',5,80,20)
        self.light=self.slider(side,'光源方向',-180,180,-45)
        self.height=self.slider(side,'光源高度角',10,85,45)
        self.shadow=tk.BooleanVar(value=True)
        ttk.Checkbutton(side,text='显示地面与阴影',variable=self.shadow,command=self.schedule).pack(anchor='w',pady=8)
        self.info=tk.StringVar();ttk.Label(side,textvariable=self.info,wraplength=265).pack(anchor='w',pady=8)
        ttk.Button(side,text='打开结果目录',command=lambda:os.startfile(ROOT/'results')).pack(fill='x',pady=8)
        ttk.Label(side,text='可切换原始、数值清理、算法减面版本。\n没有手工建模替换 AI 输出。\n采用纯色材质检查几何。',wraplength=265).pack(anchor='w',pady=8)
        self.view=ttk.Label(w,anchor='center');self.view.pack(fill='both',expand=True,padx=8)
        self.load()
    def slider(self,parent,label,lo,hi,value):
        v=tk.DoubleVar(value=value);ttk.Label(parent,text=label).pack(anchor='w',pady=(8,0))
        ttk.Scale(parent,from_=lo,to=hi,variable=v,command=lambda _:self.schedule(),length=265).pack(fill='x');return v
    def load(self):
        key=self.names[self.item.get()];entry=self.records[key]
        if self.engine.get()=='Hunyuan mini-Turbo':
            filename={'原始网格':'mesh.glb','仅清理':'mesh-clean.glb','减面预览':'mesh-preview.glb'}[self.quality.get()]
            path=Path(entry['folder'])/filename
            if not path.exists():path=Path(entry['folder'])/'mesh.glb'
            fit=entry['best_2d_fit']
        else:
            engine={'TripoSR':'triposr','Codex':'codex','DSH':'dsh'}[self.engine.get()]
            record=self.prior[key][engine];path=Path(record['path']);fit=record['best_2d_fit']
        self.mesh=trimesh.load(path,force='mesh',process=False)
        self.mesh.apply_transform(trimesh.transformations.rotation_matrix(np.deg2rad(-fit['azimuth']),[0,0,1]))
        im=Image.open(Path(entry['folder'])/'original.png').convert('RGBA');im.thumbnail((245,185),Image.Resampling.NEAREST)
        bg=Image.new('RGBA',(265,195),(215,219,225,255));bg.alpha_composite(im,((265-im.width)//2,(195-im.height)//2))
        self.input_photo=ImageTk.PhotoImage(bg);self.original.configure(image=self.input_photo)
        self.info.set(f'{self.engine.get()} · {len(self.mesh.faces):,} 面\n{self.quality.get() if self.engine.get()=="Hunyuan mini-Turbo" else "原始对照"}\n仅几何与阴影，不生成贴图。')
        self.az.set(0);self.schedule()
    def schedule(self):
        if self.pending:self.w.after_cancel(self.pending)
        self.pending=self.w.after(100,self.draw)
    def draw(self):
        self.pending=None
        if self.mesh is None:return
        im,_=render(self.mesh,azimuth=self.az.get(),elevation=self.el.get(),light_azimuth=self.light.get(),light_elevation=self.height.get(),size=680,clay=True,ground=self.shadow.get(),shadows=self.shadow.get())
        self.photo=ImageTk.PhotoImage(im);self.view.configure(image=self.photo)


if __name__=='__main__':
    w=tk.Tk();Viewer(w);w.mainloop()
