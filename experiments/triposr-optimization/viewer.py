"""Native local viewer for completed TripoSR optimization trials."""
import json
import os
from pathlib import Path
import sys
import tkinter as tk
from tkinter import ttk
from PIL import Image,ImageTk
import trimesh

ROOT=Path(__file__).resolve().parent
TRIPO=ROOT.parent/'triposr-local'
sys.path.insert(0,str(TRIPO))
from render import render

NAMES={'油纸伞':'umbrella','花瓶':'vase','椅子':'chair'}
OPTIONS={'原方案 96':'baseline96','仅升网格至 256':'grid256','官方预处理 96':'official96',
         '官方预处理＋256':'official256','输入模糊 2px':'blur96','前景占比约 70%':'fg70',
         '平滑 20 步':'taubin20','平滑 80 步':'taubin80','强平滑 320 步':'taubin320','保守后处理候选':'candidate'}


class Viewer:
    def __init__(self,window):
        self.window=window;self.pending=None;self.mesh=None
        self.out=Path(json.loads((ROOT/'latest.json').read_text(encoding='utf-8'))['output'])
        self.records=json.loads((self.out/'results.json').read_text(encoding='utf-8'))['records']
        window.title('TripoSR 优化试验 · 原始 / 官方 / 平滑')
        window.geometry('1080x860')
        side=ttk.Frame(window,padding=12);side.pack(side='left',fill='y')
        self.item=tk.StringVar(value='花瓶');self.variant=tk.StringVar(value='原方案 96')
        for title,var,values in [('物品',self.item,list(NAMES)),('方案',self.variant,list(OPTIONS))]:
            ttk.Label(side,text=title).pack(anchor='w')
            choice=ttk.Combobox(side,textvariable=var,values=values,state='readonly',width=32)
            choice.pack(fill='x',pady=(0,8));choice.bind('<<ComboboxSelected>>',lambda _:self.load())
        ttk.Label(side,text='实际推理输入').pack(anchor='w')
        self.input=ttk.Label(side);self.input.pack(pady=8)
        self.az=self.slider(side,'观察方位',0,360,0)
        self.el=self.slider(side,'观察俯角',5,80,20)
        self.light=self.slider(side,'光源方向',-180,180,-45)
        self.height=self.slider(side,'光源高度角',10,85,45)
        self.shadows=tk.BooleanVar(value=False)
        ttk.Checkbutton(side,text='显示地面与阴影',variable=self.shadows,command=self.schedule).pack(anchor='w',pady=8)
        self.info=tk.StringVar();ttk.Label(side,textvariable=self.info,wraplength=275).pack(anchor='w',pady=8)
        ttk.Button(side,text='打开实验结果',command=lambda:os.startfile(self.out)).pack(fill='x',pady=8)
        ttk.Label(side,text='统一使用原始模型比例尺，保留平滑后的尺寸变化。\n所有显示为纯色，不用纹理掩盖形状。\n平滑不会自动纠正错误的三维结构。',wraplength=275).pack(anchor='w',pady=8)
        self.canvas=ttk.Label(window,anchor='center');self.canvas.pack(fill='both',expand=True,padx=8)
        self.load()

    def slider(self,parent,label,lo,hi,value):
        v=tk.DoubleVar(value=value)
        ttk.Label(parent,text=label).pack(anchor='w',pady=(8,0))
        ttk.Scale(parent,from_=lo,to=hi,variable=v,command=lambda _:self.schedule(),length=275).pack(fill='x')
        return v

    def load(self):
        item=NAMES[self.item.get()];variant=OPTIONS[self.variant.get()]
        result=self.records[item].get(variant)
        if result is None:
            self.info.set('此方案未生成。');return
        self.mesh=trimesh.load(self.out/item/variant/'mesh.glb',force='mesh',process=False)
        input_key=result['settings']['input']
        image=Image.open(self.out/item/input_key/'input.png').convert('RGB')
        image.thumbnail((240,180),Image.Resampling.LANCZOS)
        self.input_photo=ImageTk.PhotoImage(image);self.input.configure(image=self.input_photo)
        changes=result['metrics']['extents_vs_baseline']
        self.info.set(f'{len(self.mesh.faces):,} 个三角面\n近退化面：{result["metrics"]["degenerate_faces"]}\n相对原始尺寸 X/Y/Z：\n{changes[0]*100:.1f}% / {changes[1]*100:.1f}% / {changes[2]*100:.1f}%')
        self.schedule()

    def schedule(self):
        if self.pending:self.window.after_cancel(self.pending)
        self.pending=self.window.after(100,self.draw)

    def draw(self):
        self.pending=None
        if self.mesh is None:return
        image,_=render(self.mesh,azimuth=self.az.get(),elevation=self.el.get(),light_azimuth=self.light.get(),
                       light_elevation=self.height.get(),size=680,clay=True,ground=self.shadows.get(),shadows=self.shadows.get())
        self.photo=ImageTk.PhotoImage(image);self.canvas.configure(image=self.photo)


if __name__=='__main__':
    window=tk.Tk();Viewer(window);window.mainloop()
