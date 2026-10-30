# 测试与验证

[开发指南](../../CONTRIBUTING.md) · [文档索引](../README.md)

代码改动按影响范围选择测试，并运行 `npm run build`。仅修改文档时，检查格式、相对链接、标题锚点及命令与源码的一致性即可。

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

## 浏览器检查

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

## Python 与真实推理

使用生成服务的 Python 3.12 环境执行 `tests/generation_runtime_test.py`、`tests/generation_service_test.py` 和 `tests/generation_source_wheel_test.py`。解释器位置记录在 `runtime/generation/platforms/<os>-<arch>/python-<variant>/environment.json`，其中 `python` 相对于该文件所在目录。

新增服务生命周期与模型适配检查：用同一生成环境执行 `tests/generation_lifecycle_test.py`、`tests/generation_startup_test.py` 和 `tests/generation_adapter_test.py`。前者使用合成 worker 检查加载期间接口、队列、取消、容量和失败语义；启动检查使用真实离线 HTTP 子进程；适配检查覆盖严格权重赋值、预处理及 2.1 分层坐标。它们都不代替真实模型质量验证。

`tests/generation_benchmark.py --url <API> --config <私有config.json> --jobs <任务目录> --output <忽略的结果目录> --models hunyuan-mini,hunyuan-turbo,hunyuan-2-1 --repeat-first` 用同一批花瓶、椅子、纸伞和盆景顺序生成，默认使用各模型声明的步数。以 `tests/generation_mesh_report.py <benchmark.json>` 统计原始/减面网格；仍需人工查看多角度外形，不能凭成功导出或统计自动判定质量通过。报告不保存访问凭证。

TLS 集成测试设置 `GENERATION_TEST_TLS=1`，并准备 OpenSSL。`tests/generation_fresh_e2e.py` 用全新目录、隐藏系统运行时和隔离旧缓存的方式，验证 CPU 在线准备、服务启动及 5 步/256 分辨率的真实模型生成；仅用于 Windows/Git Bash，会下载数 GB，目标目录必须不存在。例如：

```sh
python tests/generation_fresh_e2e.py E:/GStudioFreshCheck --bash "D:/Program Files/Git/bin/bash.exe" --output output/fresh-cpu-check
```

测试脚本的 Python 是控制端工具，不会作为被测服务的解释器。真实 Hunyuan 推理需要模型和较长时间，轻量算法测试不能代替它；硬件实测见[验证记录](../history/model-generation-validation.md)。

旧 `height-lab` 和部分 `*-evaluation.test.py` 脚本涉及已归档实验或机器路径，不属于干净检出即可运行的常规测试入口。重新使用前先核对依赖。
