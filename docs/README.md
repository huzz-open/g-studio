# 文档索引 / Documentation

按任务选择入口。ZH = 中文，EN = English；根目录提供[中文](../README.zh-CN.md)和[英文](../README.md)项目介绍。

## 使用指南 / User guides

| 文档 | 用途 | 语言 |
| --- | --- | --- |
| [部件与光影](guides/parts-and-lighting.md) | 从切图到部件编辑、场景预览和导出 | ZH |
| [模型生成](guides/model-generation.md) | 选择连接方式、生成并保存模型 | ZH |

## 开发与部署 / Development and deployment

| 文档 | 用途 | 语言 |
| --- | --- | --- |
| [开发指南](../CONTRIBUTING.md) | 开发环境、代码导航、测试和文档维护 | ZH |
| [生成后端](../services/generation-python/README.md) | sh 启动、下载、GPU、缓存、环境变量 | EN |
| [公网中转](../services/generation-relay/README.md) | HTTPS/WSS 部署和服务器配置 | EN |
| [运行资源目录](../runtime/README.md) | 本地文件保留、私有数据和清理边界 | EN |
| [随附模型文件来源](../services/generation-python/bundled/README.md) | 配置与许可证的版本、来源及校验 | EN |
| [运行时许可](../scripts/generation/licenses/README.md) | 分发包所需许可文件 | EN |

## 当前技术参考 / Current references

| 文档 | 用途 | 语言 |
| --- | --- | --- |
| [部件格式与资产](reference/parts.md) | v1/v2、网格、实例、存储和可移植导出 | ZH |
| [当前 .gs 工程格式](reference/gs-format.md) | 已实现类型、版本语义和读写入口 | ZH |
| [光照渲染](reference/lighting.md) | 点光源、方向光、代理几何及渲染边界 | ZH |
| [共享编辑器](reference/editor.md) | 标签页、历史、参数控件和后台计算 | ZH |
| [生成协议](../packages/generation-protocol/README.md) | HTTP、任务生命周期、结果格式和 Provider 扩展 | EN |
| [47-tile 算法](../src/modules/tileset-maker/docs/subtile-47-algorithm.md) | 瓦片组合规则和实现说明 | ZH |

## 设计方案 / Designs

| 文档 | 状态与范围 | 语言 |
| --- | --- | --- |
| [生成服务架构](design/model-generation.md) | 已接入架构的职责与设计决定；部署参数引用当前服务文档 | ZH |
| [模型与图片轮廓配准](design/silhouette-registration.md) | 无 AI 的通用三维朝向、等比尺寸与位置校准，目标函数、算法来源及验证 | ZH |
| [原始模型与优化候选](design/model-comparison.md) | 同步滑动对比、原始快照与显式采用，计算不自动替换选择 | ZH |
| [原图约束的几何修复](design/image-constrained-geometry-repair.md) | 保留真实透明孔洞，裁剪多余几何并插值小缺口 | ZH |
| [几何模型与推理服务改造](design/model-generation-upgrade.md) | 已实施的服务机制、固定资源与未关闭的 Mini 正确性/性能问题 | ZH |
| [Mini 推理异常与性能调查](design/mini-inference-investigation.md) | 优先待修复：平板退化、FP32 规避办法、常驻预算与官方 FlashVDM 对照及验收 | ZH |
| [引擎桥接](design/engine-bridge/README.md) | 原始设计与实施计划，含未验收接口和伪代码 | ZH |
| [Godot 素材制作插件](design/godot-plugin/README.md) | 后续工作流、部件与组合资产模型、迁移边界及语言选型建议；尚未实施 | ZH |
| [角色视频工作流](design/character-video-workflow.md) | 素材制作方案，不代表全部功能已实现 | ZH |

## 历史记录 / Historical records

| 文档 | 日期与范围 | 语言 |
| --- | --- | --- |
| [几何修复审查修正](history/repair-review-fixes-20261029.md) | 2026-10-29，实体判定、细结构、支撑约束、冷重建和导入阈值修正；真实输入不满足封口条件时拒绝修改 | ZH |
| [原图约束修复验证](history/image-constrained-repair-20261029.md) | 2026-10-29，纠正椅背孔洞诊断；真实网格修复、光照和阴影对比 | ZH |
| [可见表面保护与光照复验](history/surface-preserving-alignment-20261029.md) | 2026-10-29，修正轮廓匹配选错表面的问题；记录通用先验、旧数据迁移及真实渲染复验 | ZH |
| [真实模型实际光照验证](history/real-lighting-20261029.md) | 2026-10-29，伞与椅子校准前后真实 WebGL 对比；发现轮廓改善仍可能选错表面朝向 | ZH |
| [真实模型轮廓验证](history/real-alignment-20261029.md) | 2026-10-29，两份已有生成网格与原图的独立投影验证 | ZH |
| [Windows CUDA 官方推理对照](history/model-generation-cuda-20261028.md) | 2026-10-28，RTX 3060 三模型官方/项目路径、耗时、内存与几何实验 | ZH |
| [几何模型与服务改造验证](history/model-generation-upgrade-20261028.md) | 2026-10-28，三模型资源、常驻/队列及真实几何对照 | ZH |
| [生成服务验证](history/model-generation-validation.md) | 2026-10-26～27，Windows CPU、TLS、资源准备和分发包 | ZH |
| [木箱阴影调查](history/shadow-alignment-2026-10-26.md) | 2026-10-26，图像轮廓与代理几何不一致的分析 | EN |

历史记录保留当时的环境和结论，不作为当前命令或跨平台支持的承诺。实验输出和机器私有缓存不随仓库分发。文档归类规则见[开发指南](../CONTRIBUTING.md#文档维护)。
