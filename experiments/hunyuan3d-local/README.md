# Hunyuan3D-2mini-Turbo 本地 CPU 试验

用于替换 TripoSR 的独立实验；不连接 Web 项目，不使用外部生成 API。

## 采用的模型

- 官方 `tencent/Hunyuan3D-2mini/hunyuan3d-dit-v2-mini-turbo`：DINOv2-giant 图片编码器及 0.6B 形状生成器。
- 官方 `hunyuan3d-vae-v2-mini-turbo`：512 latent tokens 的快速几何解码器。
- 5 步采样、guidance=5、seed=12345，图片按官方配置处理为 1022×1022。
- 默认请求网格分辨率 380，使用官方 FlashVDM `merge` 和 CPU Marching Cubes。
- 只生成几何，不运行贴图生成。CPU 使用 float32，官方 CUDA 示例通常使用 float16。

## CPU 内存适配

`run.py` 顺序启动三个独立进程：

1. `encode`：官方图片预处理与 DINOv2 编码，保存图片条件张量。
2. `sample`：释放图片编码器后，加载形状模型并运行官方扩散采样代码。
3. `mesh`：释放形状模型后，加载 Turbo VAE，解码、提取并导出网格。

每阶段退出后释放大模型内存，避免把全部模块同时转换为 float32。权重按模块逐个张量加载并核对名称、形状，不保存整份 float32 checkpoint 副本。

跳过官方包入口中未使用的 MeshLab 后处理导入。Turbo VAE checkpoint 只包含推理模块，显式移除未使用的点云编码器和 `pre_kl`，其余参数严格匹配。这不改变神经网络前向运算。官方原始源码未改动，保存在 `vendor/Hunyuan3D-2`。

`check_architecture.py` 检查模块参数与 checkpoint 表头一致，并以合成张量检查分阶段 API；这些检查不代表图像重建效果。实际效果只能以 `results/*/result.json` 标记为 completed 的结果为准。

## 来源与下载

源码固定为 `f8db63096c8282cb27354314d896feba5ba6ff8a`。

Hugging Face 原站连接较慢，权重文件从腾讯 ModelScope 镜像下载，完成后对照 Hugging Face 原版 SHA256 校验：

- 主模型：`bdbcef30dd0149a281e17d5b5b1fdad1122c904e098a42f3100e04e03c247bc4`
- Turbo VAE：`5dcaca67a8da9e7079fb7b55714a572d0651ac95983bb43099913feaf6738f94`

模型元数据和来源修订见各模型目录内的 `provenance.json`。许可证和 Notice 保存于 `models/`，使用与发布需遵循上游条款。

## 本机运行

虚拟环境位于 `.venv`，基础 Python 使用本机已有的 Python 3.12。与此前 TripoSR 环境独立，未更新其依赖。

```powershell
cd E:\code\huzz-open\g-studio\experiments\hunyuan3d-local
.\.venv\Scripts\python.exe run.py --samples umbrella
.\.venv\Scripts\python.exe run.py --samples vase chair
.\.venv\Scripts\python.exe compare.py
```

每次创建带时间戳的结果目录。阶段中断后，可使用同一组参数和 `--resume 结果目录` 继续；已保存的图片编码和形状潜变量可复用，不必重新推理。

例如继续某个伞的任务：

```powershell
.\.venv\Scripts\python.exe run.py --samples umbrella --resume results\umbrella-日期时间
```

## 结果文件

- `original.png` / `input.png`：原图与实际模型输入。
- `condition.pt` / `latents.pt`：分阶段缓存，仅从本地可信生成文件读取。
- `raw.glb`：官方模型直接输出，保留原始坐标。
- `mesh.glb` / `mesh.ply`：供本地评审器使用，只统一坐标、中心、落地与最长尺寸 2。
- `views.png`、`maps/`、`shadow-25.png` / `shadow-65.png`：视图和投影诊断。
- `result.json`、各阶段 `*-stats.json` 和日志：版本、参数、实际耗时、峰值内存等。

`compare.py` 使用与此前实验相同的渲染器，输出 `review/comparison.png`。视角匹配的二维 IoU 只是轮廓指标，不等于三维几何正确率。Codex 模型经过此前交互调整，DSH 是首轮输出，不能据此进行同条件模型能力排名。

有完成的结果并执行比较后，双击 `view-results.cmd` 打开独立桌面查看器。

本次三件真实结果已经完成，详见 `VALIDATION.md`。另有数值清理和减面副本：

```powershell
.\.venv\Scripts\python.exe clean.py
.\.venv\Scripts\python.exe simplify.py
```

两者保留原始输出，分别生成 `mesh-clean.glb`、`mesh-preview.glb` 及其验证记录；不用于重新解释或手工修正模型结构。

参考：[官方仓库](https://github.com/Tencent-Hunyuan/Hunyuan3D-2)、[官方权重](https://huggingface.co/tencent/Hunyuan3D-2mini)、[腾讯 ModelScope 镜像](https://modelscope.cn/models/Tencent-Hunyuan/Hunyuan3D-2mini)。
