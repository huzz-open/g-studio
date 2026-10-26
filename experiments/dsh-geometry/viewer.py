"""Local inspection of the original, unmodified DSH-generated models."""
import json
import os
from pathlib import Path
import sys
import tkinter as tk
from tkinter import ttk

from PIL import Image, ImageTk
import trimesh

ROOT=Path(__file__).resolve().parent
TRIPO=ROOT.parent/'triposr-local'
COMPARISON=ROOT.parent/'geometry-comparison'
sys.path.insert(0,str(TRIPO))
from render import render

TRIAL=ROOT/'trials'/'trial-01'
REPORT=ROOT/'review'/'first-pass'
NAMES={'油纸伞':'umbrella','青花瓷瓶':'vase','靠背椅':'chair'}
BASELINES={'umbrella':'油纸伞-20261026-153921-635092','vase':'青花瓷瓶-20261026-153935-548975','chair':'靠背椅-20261026-153948-987451'}


class Viewer:
    def __init__(self,window):
        self.window=window
        self.pending=None
        self.mesh=None
        self.metrics=json.loads((REPORT/'metrics.json').read_text(encoding='utf-8'))['results']
        self.comparison=json.loads((COMPARISON/'results'/'metrics.json').read_text(encoding='utf-8'))['models'] if (COMPARISON/'results'/'metrics.json').exists() else None
        window.title('三方模型评审 · Codex / DSH / TripoSR')
        window.geometry('1080x860')
        left=ttk.Frame(window,padding=12);left.pack(side='left',fill='y')
        ttk.Label(left,text='物品').pack(anchor='w')
        self.item=tk.StringVar(value='油纸伞')
        selector=ttk.Combobox(left,textvariable=self.item,values=list(NAMES),state='readonly',width=30)
        selector.pack(fill='x');selector.bind('<<ComboboxSelected>>',lambda _:self.load())
        self.original=ttk.Label(left);self.original.pack(pady=12)
        engines=['Codex 已有模型','DSH 首轮代码模型','TripoSR 对照'] if self.comparison else ['DSH 首轮代码模型','TripoSR 对照']
        self.engine=tk.StringVar(value=engines[0])
        engine=ttk.Combobox(left,textvariable=self.engine,values=engines,state='readonly')
        engine.pack(fill='x');engine.bind('<<ComboboxSelected>>',lambda _:self.load())
        self.azimuth=self.slider(left,'观察方位',0,360,0)
        self.elevation=self.slider(left,'观察俯角',5,80,20)
        self.light_azimuth=self.slider(left,'光源方向',-180,180,-45)
        self.light_elevation=self.slider(left,'光源高度角',10,85,45)
        self.clay=tk.BooleanVar(value=True);self.shadows=tk.BooleanVar(value=True)
        self.pixelated=tk.BooleanVar(value=False)
        ttk.Checkbutton(left,text='纯色几何',variable=self.clay,command=self.schedule).pack(anchor='w',pady=8)
        ttk.Checkbutton(left,text='启用阴影',variable=self.shadows,command=self.schedule).pack(anchor='w')
        ttk.Checkbutton(left,text='像素放大显示（关闭为原生高分辨率）',variable=self.pixelated,command=self.schedule).pack(anchor='w',pady=5)
        ttk.Button(left,text='打开对比结果目录',command=lambda:os.startfile(COMPARISON/'results' if self.comparison else REPORT)).pack(fill='x',pady=10)
        self.info=tk.StringVar();ttk.Label(left,textvariable=self.info,wraplength=260).pack(anchor='w',pady=10)
        ttk.Label(left,text='仅统一坐标、尺寸和展示朝向，未修形状。\n纯色＋关闭阴影可检查表面几何。\nCodex 是此前的模型，DSH 是首轮输出。',wraplength=260).pack(anchor='w')
        self.preview=ttk.Label(window,anchor='center');self.preview.pack(side='left',fill='both',expand=True,padx=8)
        self.load()

    def slider(self,parent,label,minimum,maximum,value):
        variable=tk.DoubleVar(value=value)
        ttk.Label(parent,text=label).pack(anchor='w',pady=(10,0))
        ttk.Scale(parent,from_=minimum,to=maximum,variable=variable,command=lambda _:self.schedule(),length=260).pack(fill='x')
        return variable

    def load(self):
        key=NAMES[self.item.get()]
        engine={'Codex 已有模型':'codex','DSH 首轮代码模型':'dsh','TripoSR 对照':'triposr'}[self.engine.get()]
        path=COMPARISON/'models'/f'codex-{key}.glb' if engine=='codex' else TRIPO/'results'/BASELINES[key]/'mesh.glb' if engine=='triposr' else TRIAL/'outputs'/f'{key}.glb'
        self.mesh=trimesh.load(path,force='mesh',process=False)
        if not hasattr(self.mesh.visual,'vertex_colors'):
            self.mesh.visual=self.mesh.visual.to_color()
        angle=self.comparison[key][engine]['best_2d_fit']['azimuth'] if self.comparison else self.metrics[key]['triposr_2d_fit' if engine=='triposr' else 'best_2d_fit']['azimuth']
        # Reorient a display copy so all choices use the same camera and light.
        import numpy as np
        self.mesh.apply_transform(trimesh.transformations.rotation_matrix(np.deg2rad(-angle),[0,0,1]))
        self.azimuth.set(0)
        original=Image.open(TRIAL/'inputs'/f'{key}.png').convert('RGBA')
        original.thumbnail((250,190),Image.Resampling.NEAREST)
        canvas=Image.new('RGBA',(260,200),(215,219,225,255))
        canvas.alpha_composite(original,((260-original.width)//2,(200-original.height)//2))
        self.original_photo=ImageTk.PhotoImage(canvas);self.original.configure(image=self.original_photo)
        self.info.set(f'{self.engine.get()}\n{len(self.mesh.faces):,} 个三角面\n{self.item.get()}')
        self.schedule()

    def schedule(self):
        if self.pending:
            self.window.after_cancel(self.pending)
        self.pending=self.window.after(80,self.draw)

    def draw(self):
        self.pending=None
        if self.mesh is None:
            return
        im,_=render(self.mesh,azimuth=self.azimuth.get(),elevation=self.elevation.get(),
                    light_azimuth=self.light_azimuth.get(),light_elevation=self.light_elevation.get(),
                    clay=self.clay.get(),shadows=self.shadows.get(),size=240 if self.pixelated.get() else 720)
        self.photo=ImageTk.PhotoImage(im.resize((720,720),Image.Resampling.NEAREST) if self.pixelated.get() else im)
        self.preview.configure(image=self.photo)


if __name__=='__main__':
    window=tk.Tk()
    Viewer(window)
    window.mainloop()
