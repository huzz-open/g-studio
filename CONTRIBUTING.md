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

构建包含 Vue/TypeScript 检查，产物为 `dist/`，可静态部署。公网中转需要[另行部署常驻服务](./services/generation-relay/README.md)。

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
| `runtime/` | 本地运行资源、私有数据和分发包；见[清理边界](./runtime/README.md) |

`src/modules/experiments/` 仍有正式渲染代码依赖的数学和几何模块，以及独立伞模型验证页。根目录旧 `experiments/` 已归档；两者用途不同，不能按名字一并删除。

## 修改约定

- 多个编辑器共享的交互优先放在共享组件中；资产、实例和预览状态的边界见[部件参考](./docs/reference/parts.md)。
- 新增持久化字段时考虑旧工程默认值、导入导出和撤销历史。
- 修改协议时同步类型、Schema、OpenAPI 和客户端/服务端验证；见[生成协议](./packages/generation-protocol/README.md)。
- 界面文案同步中英文。根 README 保持同一结构，功能与启动行为的变更同步两种语言。
- 不提交模型、Python 环境、设备凭证、临时任务或分发 ZIP；保留已下载的运行资源。

## 验证改动

根据修改范围选择测试，并运行 `npm run build`。文档变更检查命令、链接、示例和当前源码是否一致即可。

| 修改范围 | 检查命令 |
| --- | --- |
| 部件、资产、参数默认值 | `npm run test:parts` |
| 场景、灯光、方向控件 | `npm run test:scene-lighting` |
| 撤销、标签页 | `npm run test:history`、`npm run test:tabs` |
| 法线、轮廓投影数学 | `npm run test:normals`、`npm run test:shadows` |
| 计算调度 | `npm run test:compute` |
| 生成协议和导入 | `npm run test:generation` |
| 启动资源、外部安装、下载镜像 | `npm run test:runtime`、`npm run test:mirrors`、`npm run test:uv-mirror` |
| API 连接和部署命令 | `npm run test:connection`；用生成环境的 Python 执行 `tests/generation_network_test.py` |
| 中转 TypeScript | `npm run check:relay` |

这些命令没有统一的 `npm test` 入口。历史验证记录中的测试数量只对应当时运行。

### 浏览器检查

浏览器脚本需要自行提供 Playwright 和 Chromium，当前 `package.json` 没有声明 Playwright。先启动网页，再指定地址，避免依赖各脚本不同的默认端口。PowerShell 示例：

```powershell
$env:NORMAL_TEST_URL = 'http://127.0.0.1:5173/'
node tests/normal-preview.e2e.cjs
node tests/shadow-preview.e2e.cjs
node tests/processing-workers.e2e.cjs
node tests/sidebar-controls.e2e.cjs
```

已有外部 Playwright 安装时，可设置 `PLAYWRIGHT_MODULE` 为其模块路径，`NORMAL_TEST_BROWSER` 为浏览器可执行文件。伞模型验证使用 `UMBRELLA_TEST_URL` 和 `tests/umbrella-proxy.e2e.cjs`。

手工检查部件保存/取消、重复实例、场景切换、刷新恢复及导出后重新导入；光照变更还应检查两种灯光、透明边缘和投射/接收阴影开关。

### Python 与真实推理

使用生成服务的 Python 3.12 环境执行 `tests/generation_runtime_test.py`、`tests/generation_service_test.py` 和 `tests/generation_source_wheel_test.py`。解释器位置记录在 `runtime/generation/platforms/<os>-<arch>/python-<variant>/environment.json`，其中 `python` 相对于该文件所在目录。

新增服务生命周期与模型适配检查：用同一生成环境执行 `tests/generation_lifecycle_test.py`、`tests/generation_startup_test.py` 和 `tests/generation_adapter_test.py`。前者使用合成 worker 检查加载期间接口、队列、取消、容量和失败语义；启动检查使用真实离线 HTTP 子进程；适配检查覆盖严格权重赋值、预处理及 2.1 分层坐标。它们都不代替真实模型质量验证。

`tests/generation_benchmark.py --url <API> --config <私有config.json> --jobs <任务目录> --output <忽略的结果目录> --models hunyuan-mini,hunyuan-turbo,hunyuan-2-1 --repeat-first` 用同一批花瓶、椅子、纸伞和盆景顺序生成，默认使用各模型声明的步数。以 `tests/generation_mesh_report.py <benchmark.json>` 统计原始/减面网格；仍需人工查看多角度外形，不能凭成功导出或统计自动判定质量通过。报告不保存访问凭证。

TLS 集成测试设置 `GENERATION_TEST_TLS=1`，并准备 OpenSSL。`tests/generation_fresh_e2e.py` 用全新目录、隐藏系统运行时和隔离旧缓存的方式，验证 CPU 在线准备、服务启动及 5 步/256 分辨率的真实模型生成；仅用于 Windows/Git Bash，会下载数 GB，目标目录必须不存在。例如：

```sh
python tests/generation_fresh_e2e.py E:/GStudioFreshCheck --bash "D:/Program Files/Git/bin/bash.exe" --output output/fresh-cpu-check
```

测试脚本的 Python 是控制端工具，不会作为被测服务的解释器。真实 Hunyuan 推理需要模型和较长时间，轻量算法测试不能代替它；硬件实测见[验证记录](./docs/history/model-generation-validation.md)。

旧 `height-lab` 和部分 `*-evaluation.test.py` 脚本涉及已归档实验或机器路径，不属于干净检出即可运行的常规测试入口。重新使用前先核对依赖。

## 文档维护

| 内容 | 位置 |
| --- | --- |
| 项目介绍和最短启动路径 | 根目录中英文 README |
| 用户操作步骤 | `docs/guides/` |
| 当前格式、算法和组件约定 | `docs/reference/` 或相应 package README |
| 启动、配置和故障排查 | 相应 service README |
| 设计理由、未完成方案 | `docs/design/`，明确状态 |
| 带日期的验证与调查 | `docs/history/` |

一个事实只在一个专题中详细维护，其他文档链接引用。新增或移动文档时更新[索引](./docs/README.md)及引用；实现变化时先修订当前参考，再保留历史结论的日期与条件。不要把开发对话、验收答复或临时截图路径直接追加到 README。
