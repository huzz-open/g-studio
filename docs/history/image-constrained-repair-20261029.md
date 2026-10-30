# 原图约束修复与真实光照验证（2026-10-29）

[历史索引](README.md) · [当前文档](../README.md)

**本页为旧 v1 修复结果。** 后续审查发现实体判定和降采样等缺陷，当前 v2 不再对这两份含开边界的输入自动执行封口。旧覆盖率改善不能视为安全几何修复已通过，见[修正记录](repair-review-fixes-20261029.md)。

## 纠正先前诊断

对 `public/scene-lighting/chair.png` 的 RGBA 逐像素检查确认，靠背花纹里的多个镂空孔洞本来就是透明的。之前的轮廓/光照记录将这些孔洞统称为生成错误不准确。本轮不封掉它们，而是修复错误扩大的孔洞边缘、原图不透明区域中的小缺口，并裁掉透明区多余几何。原图棋盘格证据保存在 `output/geometry-repair-20261029/chair-checker.png`。

## 实施与统一参数

使用[原图约束修复算法](../design/image-constrained-geometry-repair.md)，对同样两份 Hunyuan Mini 真实 GLB 处理。源图、网格 SHA256 与先前报告相同，模型已采用 surface-preserving-v2 对齐。修复没有重新生成模型，没有椅子或伞的类别专用参数。

| 项目 | 靠背椅 | 油纸伞（回归对照） |
| --- | ---: | ---: |
| 原始有效三角面 | 11,975 | 11,974 |
| 修复派生三角面 | 67,842 | 35,518 |
| 接受插值的小缺口连通分量 | 53 | 36 |
| 保守跳过的分量 | 10 | 12 |
| 实际 GPU 几何覆盖率：前 → 后 | 96.99% → 98.33% | 96.93% → 98.03% |
| 不透明区域缺少几何的像素：前 → 后 | 3,076 → 1,706 | 2,940 → 1,883 |
| 图像范围内透明区多余投影像素：前 → 后 | 7,835 → 0 | 4,267 → 0 |

“小缺口分量”包括轮廓上的窄缺失条带，不代表修复了 53 个拓扑洞。像素计数来自生产 WebGL 深度场回读，使用输入图片的原始分辨率及渲染 alpha 阈值。零多余投影指本相机下图像范围内的透明区，不代表所有隐藏结构都已还原。

## 实际光照与阴影

继续使用生产 `createSceneRenderer`，同一 Intel UHD 630 / ANGLE WebGL 2 环境，同一相机、原图、法线设置和三组灯光。修复前后都已经完成相同姿态校准，唯一变量是几何修复。

- 点光源 `[-3,4,4]`，强度 24。
- 点光源 `[3,2.8,3]`，强度 18。
- 方向光方位 70°、仰角 28°，强度 1.1。

椅子和伞的整体明暗稳定，主要变化是局部边缘与投影。椅子方向光下，受阴影开关影响的原图屏幕像素比例从 14.57% 变为 14.29%；地面受阴影影响屏幕像素从 20,651 变为 20,467。这些是变化量诊断，不作为“阴影越少越正确”的评分。原图真实孔洞和椅腿空隙仍能透光，伞没有重新出现上轮的错误换面现象。

仍有 1.67% 椅子前景像素缺少几何，主要是没有足够邻域深度或涉及较大深度断层的区域。没有为追求 100% 覆盖而捏造连接面。修复未修改原 GLB，也没有宣称全局水密或可直接用于碰撞。

## 验证和产物

部件测试 58 项及生产构建通过。浏览器验证“按原图修复几何”、开关、保存重载、源 GLB 保留、修改角度后修复失效，以及内置图可移植导出后修复仍有效。

- `output/geometry-repair-20261029/report.json`：输入来源、修复遮罩和各分量统计。
- `output/geometry-repair-lighting-20261029/lighting-report.json`：实际渲染配置和 GPU 指标。
- `chair-repair-evidence.png`：原图透明度与修复前后误差。
- `chair-lighting-comparison.png` / `umbrella-lighting-comparison.png`：实际点光源、方向光和几何前后对比。
- 所有原始截图、阴影开关和差分图保存在同目录，没有覆盖旧版本的失败记录。

复现：

```sh
node scripts/verify-geometry-repair.cjs
node scripts/verify-real-lighting.cjs output/geometry-repair-20261029/report.json output/geometry-repair-lighting-20261029
python scripts/render-lighting-report.py output/geometry-repair-lighting-20261029
```

需要本地真实模型与前轮输入清单、运行中的 Vite、Playwright/Chrome，以及 Pillow/NumPy。验证脚本不是新推理任务。
