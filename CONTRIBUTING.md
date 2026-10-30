# 开发指南

面向修改源码的贡献者。项目介绍见 [README](./README.zh-CN.md)，专题入口见[文档索引](./docs/README.md)。

## 本地开发

使用 Node.js 22.12+。本文统一使用 npm；仓库也保留了 pnpm 锁文件，修改依赖时应检查两份锁文件是否与清单一致，避免仅因切换工具而重写锁文件。

```sh
npm install
npm run dev:web
```

网页默认在 `http://localhost:5173`。修改切图、部件、场景或界面通常只需要网页服务。联调 AI 时使用 `npm run dev` 启动两端；已有网页时，在另一终端运行 `npm run dev:gensvc`。通过 `--` 传入后端参数，例如 `npm run dev:gensvc -- --cuda`。环境准备、下载预设和环境变量见[后端部署](./services/generation-python/README.md)。

```sh
npm run build
npm run preview
```

构建包含 Vue/TypeScript 检查，产物为 `dist/`，可静态部署。AI 服务独立运行；旧客户端的公网中转需要[另行部署常驻服务](./services/generation-relay/README.md)。

## 从哪里修改

| 路径 | 职责 |
| --- | --- |
| `src/modules/` | 切图、部件、模型生成、场景光影、瓦片及区域编辑等功能 |
| `src/router/` | Hash 路由和页面入口 |
| `src/shared/components/` | 编辑器外壳、参数控件、设置等共享界面 |
| `src/shared/parts/` | 部件格式、资产库、GLB 导入和几何 |
| `src/shared/generation/` | 生成客户端和传输适配 |
| `src/shared/history/`、`src/shared/composables/`、`src/shared/utils/` | 撤销历史、状态复用和计算调度 |
| `src/shared/gs-format/`、`src/shared/workspace/`、`src/shared/godot/` | 工程格式、存储和 Godot 导出 |
| `src/shared/i18n/` | 中英文界面文案 |
| `services/generation-python/` | Python 推理服务和 Provider |
| `services/generation-relay/` | Node/TypeScript 公网中转 |
| `packages/generation-protocol/` | 协议类型、JSON Schema、OpenAPI |
| `scripts/generation/` | 环境准备、下载和镜像 |
| `tests/` | 单元、集成及浏览器检查 |
| `runtime/` | 本地运行资源、私有数据和历史归档；见[清理边界](./runtime/README.md) |

`src/modules/experiments/` 仍有正式渲染代码依赖的数学和几何模块，以及独立伞模型验证页。根目录旧 `experiments/` 已归档；两者用途不同，不能按名字一并删除。

## 修改约定

- 多个编辑器共享的交互优先放在共享组件中；资产、实例和预览状态的边界见[部件参考](./docs/reference/parts.md)。
- 新增持久化字段时考虑旧工程默认值、导入导出和撤销历史。
- 修改协议时同步类型、Schema、OpenAPI 和客户端/服务端验证；见[生成协议](./packages/generation-protocol/README.md)。
- 界面文案同步中英文。根 README 保持同一结构，功能与启动行为的变更同步两种语言。
- 不提交模型、Python 环境、设备凭证、临时任务或分发 ZIP；保留已下载的运行资源。

## 验证改动

代码改动按影响范围运行相关测试和 `npm run build`。测试矩阵、浏览器环境与 Python/真实推理前提统一见[测试与验证](docs/development/testing.md)。

仅修改文档时，检查格式、链接、示例和当前源码的一致性，无需启动 AI 或下载模型。

## 文档维护

README 保持简洁，详细操作、技术约定、设计与历史记录分开维护。内容归属和格式见[文档写作规范](docs/development/documentation.md)。

一个事实只在所属专题详细维护，其他页面通过链接引用。新增或移动文档时同步[索引](docs/README.md)与入站链接；实现变化先更新当前说明，历史记录保留日期和条件。
