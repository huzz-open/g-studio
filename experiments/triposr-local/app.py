"""Standalone Tk desktop UI. Model inference runs in a separate local process."""
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

from PIL import Image, ImageTk
import trimesh
from render import render, export_maps

ROOT = Path(__file__).resolve().parent


class App:
    def __init__(self, window):
        self.window = window
        window.title('TripoSR 本地验证 · 图片 → 三维形状 → 阴影')
        window.geometry('1120x900')
        self.mesh = None
        self.folder = None
        self.process = None
        self.events = queue.Queue()
        self.pending = None
        self.path = tk.StringVar()
        self.status = tk.StringVar(value='选择透明 PNG 生成模型，或打开已有结果。CPU 首次推理需要等待。')
        top = ttk.Frame(window,padding=12)
        top.pack(fill='x')
        ttk.Entry(top,textvariable=self.path).pack(side='left',fill='x',expand=True)
        ttk.Button(top,text='选择图片',command=self.choose).pack(side='left',padx=4)
        ttk.Label(top,text='网格').pack(side='left')
        self.resolution = tk.StringVar(value='96')
        ttk.Combobox(top,textvariable=self.resolution,values=['64','96','128'],width=5,state='readonly').pack(side='left',padx=5)
        self.generate = ttk.Button(top,text='本地生成',command=self.run)
        self.generate.pack(side='left',padx=4)
        ttk.Button(top,text='停止',command=self.stop).pack(side='left')
        ttk.Button(top,text='打开结果',command=self.open_result).pack(side='left',padx=4)
        content = ttk.Frame(window,padding=(12,0))
        content.pack(fill='both',expand=True)
        left = ttk.Frame(content,width=290)
        left.pack(side='left',fill='y',padx=(0,12))
        ttk.Label(left,text='原始图片').pack(anchor='w')
        self.original = ttk.Label(left)
        self.original.pack(pady=8)
        self.azimuth = self.slider(left,'观察方位（绕物体旋转）',0,360,0)
        self.elevation = self.slider(left,'观察俯角',5,80,20)
        self.light_azimuth = self.slider(left,'光源方向',-180,180,-45)
        self.light_elevation = self.slider(left,'光源高度角',10,85,45)
        self.clay = tk.BooleanVar(value=False)
        self.shadows = tk.BooleanVar(value=True)
        ttk.Checkbutton(left,text='纯色几何（检查真实形状）',variable=self.clay,command=self.schedule).pack(anchor='w',pady=4)
        ttk.Checkbutton(left,text='启用阴影',variable=self.shadows,command=self.schedule).pack(anchor='w')
        ttk.Button(left,text='导出当前角度的深度 / 法线',command=self.export).pack(fill='x',pady=12)
        ttk.Button(left,text='打开输出文件夹',command=self.reveal).pack(fill='x')
        ttk.Label(left,text='模型生成后，旋转与阴影均为固定算法。\n输出为三角网格，不含语义部件。\n深度 / 法线尚未对齐到原像素图。',wraplength=280).pack(anchor='w',pady=12)
        self.preview = ttk.Label(content,anchor='center')
        self.preview.pack(side='left',fill='both',expand=True)
        ttk.Label(window,textvariable=self.status,padding=10,wraplength=1080).pack(fill='x')
        self.log = tk.Text(window,height=5,wrap='word',state='disabled')
        self.log.pack(fill='x',padx=12,pady=(0,10))
        window.after(100,self.poll)
        window.protocol('WM_DELETE_WINDOW',self.close)
        if len(sys.argv)>1:
            self.load(Path(sys.argv[1]))
        else:
            results = sorted((ROOT/'results').glob('*/result.json'),key=lambda p:p.stat().st_mtime)
            if results:
                self.load(results[-1].parent)

    def slider(self,parent,label,low,high,initial):
        var = tk.DoubleVar(value=initial)
        ttk.Label(parent,text=label).pack(anchor='w',pady=(8,0))
        ttk.Scale(parent,from_=low,to=high,variable=var,command=lambda _:self.schedule(),length=280).pack(fill='x')
        return var

    def show_original(self,path):
        image = Image.open(path).convert('RGBA')
        image.thumbnail((256,170),Image.Resampling.NEAREST)
        bg = Image.new('RGBA',(256,180),(215,219,225,255))
        bg.alpha_composite(image,((256-image.width)//2,(180-image.height)//2))
        self.original_photo = ImageTk.PhotoImage(bg)
        self.original.configure(image=self.original_photo)

    def choose(self):
        path = filedialog.askopenfilename(title='选择透明背景的单个物品',filetypes=[('PNG image','*.png')])
        if path:
            self.path.set(path)
            self.show_original(path)

    def run(self):
        if self.process is not None:
            return
        if not Path(self.path.get()).is_file():
            messagebox.showerror('请选择图片','先选择一张透明 PNG。')
            return
        self.generate.configure(state='disabled')
        self.status.set('正在本地生成；进度见下方日志。')
        try:
            self.process = subprocess.Popen([sys.executable,'-u',str(ROOT/'run.py'),self.path.get(),
                '--resolution',self.resolution.get()],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,
                text=True,encoding='utf-8',errors='replace',env={**os.environ,'PYTHONIOENCODING':'utf-8'},
                creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        except Exception as exc:
            self.generate.configure(state='normal')
            messagebox.showerror('启动失败',str(exc))
            return
        process = self.process
        def reader():
            for line in process.stdout:
                self.events.put(('log',line))
            self.events.put(('done',process.wait()))
        threading.Thread(target=reader,daemon=True).start()

    def poll(self):
        while not self.events.empty():
            kind,value = self.events.get_nowait()
            if kind == 'log':
                self.log.configure(state='normal')
                self.log.insert('end',value)
                self.log.see('end')
                self.log.configure(state='disabled')
                if value.startswith('RESULT: '):
                    self.load(Path(value[8:].strip()))
            else:
                self.generate.configure(state='normal')
                self.process = None
                self.status.set('生成完成。可以旋转模型、调整光源。' if value == 0 else '生成未完成；请查看日志。')
        self.window.after(100,self.poll)

    def stop(self):
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()
            self.status.set('已停止本次推理。')

    def open_result(self):
        path = filedialog.askopenfilename(initialdir=ROOT/'results',title='打开 result.json',filetypes=[('Result','result.json')])
        if path:
            self.load(Path(path).parent)

    def load(self,folder):
        try:
            report = json.loads((folder/'result.json').read_text(encoding='utf-8'))
            if report.get('status') != 'completed':
                raise ValueError('结果尚未完成')
            mesh = trimesh.load(folder/'mesh.glb',force='mesh',process=False)
            if len(mesh.faces)==0:
                raise ValueError('空网格')
            self.mesh,self.folder = mesh,folder
            self.show_original(folder/'original.png')
            self.path.set(report['input'])
            self.status.set(f'{len(mesh.faces):,} 个三角形 · {report["device"]} · 推理 {report["timings_seconds"]["inference"]:.1f} 秒')
            self.schedule()
        except Exception as exc:
            messagebox.showerror('打开失败',str(exc))

    def schedule(self):
        if self.pending:
            self.window.after_cancel(self.pending)
        self.pending = self.window.after(100,self.draw)

    def draw(self):
        self.pending = None
        if self.mesh is None:
            return
        image,_ = render(self.mesh,azimuth=self.azimuth.get(),elevation=self.elevation.get(),
                         light_azimuth=self.light_azimuth.get(),light_elevation=self.light_elevation.get(),
                         clay=self.clay.get(),shadows=self.shadows.get())
        self.photo = ImageTk.PhotoImage(image.resize((660,660),Image.Resampling.NEAREST))
        self.preview.configure(image=self.photo)

    def export(self):
        if self.mesh is None:
            return
        from datetime import datetime
        folder = self.folder/f'view-{datetime.now():%Y%m%d-%H%M%S-%f}'
        meta = export_maps(self.mesh,folder,self.azimuth.get(),self.elevation.get())
        (folder/'camera.json').write_text(json.dumps(meta,indent=2),encoding='utf-8')
        self.status.set(f'已导出：{folder}')

    def reveal(self):
        if self.folder:
            os.startfile(self.folder)

    def close(self):
        self.stop()
        self.window.destroy()


if __name__ == '__main__':
    window = tk.Tk()
    App(window)
    window.mainloop()
