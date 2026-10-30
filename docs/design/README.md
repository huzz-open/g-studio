# 设计方案

[文档索引](../README.md)

此处记录架构理由、算法取舍和后续方案。使用步骤见指南，当前配置见服务文档，具体测试结果见[历史记录](../history/README.md)。

## 已接入能力

| 方案 | 范围与状态 |
| --- | --- |
| [生成服务架构](model-generation.md) | 前端、协议、服务与资产职责 |
| [多模型推理服务](model-generation-upgrade.md) | 三模型、常驻、队列和固定执行策略；质量问题仍开放 |
| [轮廓配准](silhouette-registration.md) | 相似变换、可见表面保护及搜索边界 |
| [原始模型与优化候选](model-comparison.md) | 同步对比、快照与显式采用 |
| [原图约束几何修复](image-constrained-geometry-repair.md) | repair v2；实体条件不满足时保留源几何 |

## 待实施与开放问题

| 方案 | 范围与状态 |
| --- | --- |
| [Mini 推理调查](mini-inference-investigation.md) | 数值根因与性能未解决；进一步模型实验已暂停 |
| [引擎桥接](engine-bridge/README.md) | 原始设计和分阶段计划，部分能力已接入 |
| [Godot 素材制作插件](godot-plugin/README.md) | 原生制作流程、资产模型与选型，待实施 |
| [角色视频工作流](character-video-workflow.md) | 四方向动画素材制作方案，尚非完整产品功能 |
