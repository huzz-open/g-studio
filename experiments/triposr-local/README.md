# TripoSR 本地形状与阴影验证

这是独立 Python 桌面程序，不依赖 g-studio 的 Vite/Vue，不启动 HTTP 服务，也没有接入 Web。

验证目标是：**用本地 TripoSR 替代“AI 看图编写代理几何”的步骤，随后用固定算法计算光照与阴影。**

## 本机启动

双击 `launch.cmd`。已经生成的结果会自动打开；也可以通过“打开结果”选择某个目录内的 `result.json`。

1. 选择透明 PNG，单张图片只包含一个物体。
2. 选择网格分辨率：64 用于快速检查，96 为默认，128 有助于观察细杆和孔洞。
3. 点击“本地生成”，等待下方日志完成。
4. 改变观察方位查看正面、侧面、背面；切换“纯色几何”检查真实形状。
5. 改变光源方向、高度角，或关闭阴影进行对比。
6. 点击导出按钮保存当前相机角度的法线、深度和表面坐标。

模型生成需要计算时间；生成完后，界面旋转和阴影更新不再运行 AI。首次渲染需要 Numba 编译，后续使用磁盘缓存。当前预览使用方向光硬阴影，不能视为与 g-studio 点光源场景的逐像素一致性验证。

## 首次安装 / 迁移机器

需要 Windows、Python 3.12（包含 Tkinter）。使用独立 `.venv`；请不要把这份虚拟环境直接复制到另一台电脑。首次安装需要联网获取依赖、官方源码和约 1.56 GiB 权重；下载器支持断点续传和 SHA256 校验。

```powershell
cd E:\code\huzz-open\g-studio\experiments\triposr-local
.\setup.ps1
# 如果 Python 3.12 没有注册到 py launcher：
.\setup.ps1 -PythonExe '你的 Python 3.12 完整路径\python.exe'
# 可选依赖镜像；DirectDownload 只影响 Hugging Face 下载连接：
.\setup.ps1 -IndexUrl 'https://pypi.tuna.tsinghua.edu.cn/simple' -DirectDownload
```

本机虚拟环境使用已存在的 `D:\software\tmp\omniparser-trial\python` 中的 Python 3.12 基础运行时，依赖安装在本目录 `.venv`，没有修改 OmniParser 的环境。删除那个基础 Python 前，应重建此处虚拟环境。

正式推理只读 `models/` 本地文件，开启 `HF_HUB_OFFLINE` 和 `TRANSFORMERS_OFFLINE`；无需 API Key。输入图像不会上传到服务器。当前支持透明 PNG，不会另行调用在线抠图。灰色背景且已居中的输入可在 CLI 显式使用 `--prepared-rgb`。

## 命令行

```powershell
.\.venv\Scripts\python.exe run.py '..\..\output\ancient-chinese-props\sprites\油纸伞.png' --resolution 96
# 多张图片共用一次模型加载：
.\.venv\Scripts\python.exe run.py a.png b.png c.png --resolution 96 --threads 4
# 有 CUDA 版 PyTorch 和 NVIDIA GPU 时可显式指定：
.\.venv\Scripts\python.exe run.py a.png --device cuda
.\.venv\Scripts\python.exe test_pipeline.py
```

默认使用 CPU，4 个计算线程。不要将官方 A100 的运行速度当成本机 CPU 的速度。每次生成保留独立带时间戳的目录，停止或失败的任务不会被标记为完成。

## 输出

| 文件 | 含义 |
|---|---|
| `original.png` / `input.png` | 原图和实际模型输入；透明轮廓裁切、最近邻缩放、居中到 512×512 灰底 |
| `raw.glb` | TripoSR 原始坐标系下的三角网格、顶点颜色 |
| `mesh.glb` / `mesh.ply` | XY 居中、底部 Z=0、最长尺寸归一化为 2 的网格 |
| `views.png` | 四方向外观与纯色几何对照 |
| `shadow-light-25.png` / `shadow-light-65.png` | 同一网格在不同光源高度下的阴影 |
| `maps/normal-world.png` | 世界空间法线，RGB=(N+1)/2，Alpha 为可见表面掩码 |
| `maps/depth16.png` | 16 位正交视图深度；0 表示背景，解码参数在 JSON 内 |
| `maps/surface.npz` | 浮点表面位置、世界法线、相机方向深度和有效掩码 |
| `maps/mask.png` / `maps/color.png` | 模型投影轮廓与顶点颜色插值结果 |
| `result.json` | 设备、版本、源码提交、参数、耗时、坐标变换和局限 |

这些是**实验输出格式**，不是当前 Web 部件编辑器的数据协议。深度图属于模型相机视角，尚未配准到原始精灵像素。不能直接把它当作原图同尺寸的深度贴图使用。

## 与此前光影方案的对应关系

原方案：图片 → AI 解释结构 → 盒子、杆件、薄面等部件 JSON → 固定渲染。

本实验：图片 → 本地 TripoSR 推断密度场和颜色 → Marching Cubes 三角网格 → 固定渲染。

两者都能向阴影算法提供三维表面，但 TripoSR **不会自动输出物品类别、语义部件、可编辑基本几何参数或可信接地点**。需要后续增加网格导入、简化、坐标/相机配准和人工修正，才能评估接入现有部件编辑器。

本程序通过最低 Z 值落地，这只是明确的几何规则，不是 AI 识别出了真正的支撑点。浮空噪点、误建的细杆或错误方向都会影响落地与阴影。

## 适配说明

- 上游源码固定为 `107cefdc244c39106fa830359024f6a2f1c78871`，存于忽略提交的 `vendor/TripoSR`。
- 保留官方神经网络与 `stabilityai/TripoSR` 权重，不训练模型。
- `compat.py` 用 scikit-image CPU Marching Cubes 适配 `torchmcubes` 接口，处理轴顺序；避免 Windows C++/CUDA 编译。
- DINO 的配置文件提前下载并定向到本地路径，其网络权重包含在 TripoSR checkpoint 中。
- 固定 Transformers 4.36.2：其 ViT 保留官方所用 4.35.0 的位置编码插值方式，且对应 tokenizers 有 Windows/Python 3.12 轮子。直接安装 4.35.0 会要求无法在本环境直接安装的 tokenizers 0.14.1；4.49.0 改过插值，因此最终样例已用 4.36.2 复测。
- 原图已有 Alpha，因此禁用上游不必要的 rembg 导入和自动抠图入口，避免额外模型和启动成本。
- `render.py` 为 NumPy/Numba CPU 三角形光栅化、深度缓冲、Lambert 光照和方向光阴影贴图。
- 顶点颜色可能烘入原画明暗，不能宣称是无光照 albedo；“纯色几何”模式适合检查结构和阴影。

## 如何评估

优先检查侧背面体积、伞面厚度、杆件连续性、椅腿和椅背孔洞。三角形数量、网格闭合、成功导出都不能证明结构正确。提高 Marching Cubes 分辨率只能更细地提取已推断的场，无法保证恢复模型没有推断出来的结构。

自动检查覆盖相机正交基、CPU 网格提取轴顺序、光源升高后的投影变化、深度解码和 Alpha。真实样例结果与观察见 `VALIDATION.md`，对照总图为 `results/validation-overview.png`。

可运行 `python assess.py 结果目录` 生成 `comparison.png` 和 `assessment.json`。该工具在固定 20° 俯角下，以 15° 方位步长比较二维轮廓；分别做居中与等比例缩放。IoU 高只说明某个方向轮廓相近，不能证明背面、厚度和投影正确。

参考：[TripoSR 官方仓库](https://github.com/VAST-AI-Research/TripoSR)、[官方权重](https://huggingface.co/stabilityai/TripoSR)。上游许可证随源码保存在 `vendor/TripoSR/LICENSE`。
