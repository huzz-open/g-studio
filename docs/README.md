# 文档索引

[项目介绍](../README.zh-CN.md) · [English overview](../README.md) · [开发指南](../CONTRIBUTING.md)

## 使用指南

| 文档 | 内容 |
| --- | --- |
| [部件与场景光影](guides/parts-and-lighting.md) | 切图、编辑部件、布置场景与导出 |
| [模型生成](guides/model-generation.md) | 连接服务、生成模型、对比与采用结果 |
| [Godot 集成](../integrations/godot/README.md) | 安装桥接插件、场景同步与角色遮挡 |

## 开发与部署

| 文档 | 内容 |
| --- | --- |
| [开发指南](../CONTRIBUTING.md) | 本地环境、目录职责与修改约定 |
| [测试与验证](development/testing.md) | 按改动范围选择测试、浏览器与 Python 环境 |
| [文档写作规范](development/documentation.md) | 内容归属、格式与维护规则 |
| [生成后端](../services/generation-python/README.md) | 启动入口与配置导航（EN） |
| [运行资源](../runtime/README.md) | 缓存、私有数据与清理边界（EN） |
| [旧版中转服务](../services/generation-relay/README.md) | 兼容部署；当前网页使用直连（EN） |

## 技术参考

| 文档 | 内容 |
| --- | --- |
| [部件格式与资产](reference/parts.md) | 格式、模型、实例和可移植导出 |
| [.gs 工程格式](reference/gs-format.md) | 当前类型、版本与读写入口 |
| [光照渲染](reference/lighting.md) | 灯光、代理模型、表面缓存和阴影 |
| [共享编辑器](reference/editor.md) | 标签页、历史、控件和后台计算 |
| [模型生成与采用规则](reference/generation-workflow.md) | 参数、记录、模型快照和候选失效 |
| [生成协议](../packages/generation-protocol/README.md) | HTTP、任务生命周期与 Provider 扩展（EN） |
| [47-tile 算法](../src/modules/tileset-maker/docs/subtile-47-algorithm.md) | 子瓦片映射与图集布局 |
| [模型与源码来源](../services/generation-python/bundled/README.md) | 固定版本、清单与声明（EN） |
| [运行时许可](../scripts/generation/licenses/README.md) | 随附运行时的声明位置（EN） |

## 设计与历史

- [设计方案](design/README.md)：架构、算法理由、待实施工作流与开放问题。
- [验证与调查记录](history/README.md)：带日期的实测、失败证据与修正过程。

未标注语言的页面为中文。设计方案不代表功能全部交付；历史结果只适用于记录中的版本和环境。
