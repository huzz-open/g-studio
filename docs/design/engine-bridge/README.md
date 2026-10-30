# 引擎桥接设计

状态：原始设计，部分能力已接入。下列接口、伪代码和阶段清单保留设计上下文，不作为当前功能完成清单。

当前格式见 [.gs 技术参考](../../reference/gs-format.md)，现有插件安装和行为见 [Godot 集成](../../../integrations/godot/README.md)。

## 方案导航

[架构与设计原则](architecture.md)说明文件同步、受管节点和数据职责。

| 文件 | 内容 | 实施阶段 |
| --- | --- | --- |
| [01-gs-format-spec.md](./01-gs-format-spec.md) | .gs 文件格式完整规范 | P1 |
| [02-engine-adapter.md](./02-engine-adapter.md) | 引擎适配器抽象层设计 | P1 概念 / P3 实现 |
| [03-resource-model.md](./03-resource-model.md) | 资源模型重新设计 | P1 |
| [04-resource-manager-ui.md](./04-resource-manager-ui.md) | 资源管理器 UI 重构 | P1 |
| [05-workspace-strategy.md](./05-workspace-strategy.md) | 工作区绑定策略 | P1 |
| [06-sync-protocol.md](./06-sync-protocol.md) | 双向同步协议 | P2-P3 |
| [07-godot-adapter.md](./07-godot-adapter.md) | Godot 适配器具体实现 | P3 |
| [08-implementation-phases.md](./08-implementation-phases.md) | 分阶段实施计划 | 全程参考 |

[设计索引](../README.md) · [文档索引](../../README.md)
