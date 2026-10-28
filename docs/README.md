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
| [引擎桥接](design/engine-bridge/README.md) | 原始设计与实施计划，含未验收接口和伪代码 | ZH |
| [角色视频工作流](design/character-video-workflow.md) | 素材制作方案，不代表全部功能已实现 | ZH |

## 历史记录 / Historical records

| 文档 | 日期与范围 | 语言 |
| --- | --- | --- |
| [生成服务验证](history/model-generation-validation.md) | 2026-10-26～27，Windows CPU、TLS、资源准备和分发包 | ZH |
| [木箱阴影调查](history/shadow-alignment-2026-10-26.md) | 2026-10-26，图像轮廓与代理几何不一致的分析 | EN |

历史记录保留当时的环境和结论，不作为当前命令或跨平台支持的承诺。实验输出和机器私有缓存不随仓库分发。文档归类规则见[开发指南](../CONTRIBUTING.md#文档维护)。
