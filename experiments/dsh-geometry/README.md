# DSH 看图写代码建模实验

使用用户已经安装并登录的 DeepSeek Harness 桌面客户端完成。客户端显示模型为 **DeepSeek-V4.1-Flash，1017，High**。没有重新安装 dsh，也没有直接使用 API Key。

## 查看结果

双击 `view-results.cmd` 打开独立桌面评审器。可切换油纸伞、花瓶、椅子，比较 DSH 与 TripoSR，旋转视角、改变光源、切换纯色几何或关闭阴影。评审器只读取本地网格，不调用 AI，不接入 Web。

本机运行环境复用 `../triposr-local/.venv`，评审器需要 numpy、trimesh、Pillow、numba、Tkinter。生成代码本身只需要 Python 3.12、numpy、trimesh。

## 实验输入与来源

- `trials/trial-01/inputs/`：仅复制三张原始 PNG。
- `review/submitted-prompt.txt`：实际发给 DSH 的完整任务文本。
- `trials/trial-01/build_models.py`：**DSH 首轮生成的原始代码，未修改**。
- `trials/trial-01/README.md`：DSH 对结构观察、假设和参数的说明。
- `trials/trial-01/outputs/`：我执行上述原始代码导出的三个 GLB。
- `review/first-pass/build_models.original.py`：执行前保存的代码快照；与原文件 SHA256 相同。
- `evaluate.py`、`viewer.py`：我编写的独立检查/显示程序，不参与构建 DSH 模型。

没有向 DSH 提供已有几何代码、TripoSR 输出、人工结构参数或具体建模方案。要求它只用文件编辑工具写代码，由我独立执行检查。UI 在约 17:00 接收任务，17:07 完成；这是一次首轮生成，不含人工反馈修正。

## 输出与评价

见 `VALIDATION.md`。

`review/first-pass/comparison.png` 为对比总图。各物品子目录有四方向视图、25°/65° 光源高度下的阴影图，以及法线、深度和表面坐标。`metrics.json` 保存几何检查和二维轮廓匹配结果。

重建与评估示例（在本目录执行）：

```powershell
..\triposr-local\.venv\Scripts\python.exe trials\trial-01\build_models.py
..\triposr-local\.venv\Scripts\python.exe evaluate.py trials\trial-01 --output review\first-pass
```

重建会覆盖 `outputs` 的同名 GLB。需要保留新一轮结果时，请使用新的 trial 目录与评审输出目录。
