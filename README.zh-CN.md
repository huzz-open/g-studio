**中文** | [English](./README.md)

<p align="center">
  <img src="./public/favicon.svg" width="96" height="96" alt="G-Studio Logo">
</p>

# G-Studio

运行在浏览器中的游戏资源工作台：切分精灵图、编辑部件、预览光影、生成瓦片集和场景区域，支持 Godot 资源导出。

**[在线体验](https://huzz-open.github.io/g-studio/)** · [文档索引](./docs/README.md) · [开发指南](./CONTRIBUTING.md)

基础编辑无需登录，资产保存在本地。可选 AI 模型生成使用独立服务；公网中转模式会通过所配置的服务器传输图片和模型。

## 主要功能

| 功能 | 用途 |
| --- | --- |
| 精灵切图 | 自动或手动切割精灵图，导出散件和合成图 |
| 部件与场景光影 | 编辑共享部件、法线和几何，预览点光源与方向光 |
| 模型生成 | 使用轮廓近似或本地 AI 生成几何，预览后保存为部件 |
| Tileset 生成 | 生成 47-tile 自动地形图集，导出 Godot `.tres` |
| 场景区域编辑 | 绘制碰撞和遮挡区域，导出 Godot `.tscn` |
| 资源管理 | 浏览本地工作区，管理图片及工程文件 |

在切图工具中拖入 [示例精灵图](./samples/沧澜水乡_snippet.png) 即可体验。详细操作见[部件与光影指南](./docs/guides/parts-and-lighting.md)。

## 快速开始

需要 Node.js 22.12+ 和 npm。

```sh
git clone https://github.com/huzz-open/g-studio.git
cd g-studio
# 国内网络可选：npm run setup:cn
npm install
npm run dev
```

打开 <http://localhost:5173>。`npm run dev` 同时启动网页与 AI 后端；首次会准备 Python 环境并下载约 **4.23GB 模型权重**。只开发或使用网页功能，可改为 `npm run dev:web`，无需准备 Python 和模型。

国内下载预设及恢复方法见[后端部署说明](./services/generation-python/README.md#download-sources)。

## AI 硬件与离线包

支持 **CPU、兼容的 NVIDIA CUDA 显卡、Apple Silicon Mac（MPS）**。不推荐普通 Windows 笔记本核显作为本项目的 GPU 推理方案：可能比 CPU 慢，或受驱动与算子兼容性限制无法完成任务；台式机 CPU 也可能明显快于核显。

| 2026-10-27 实测设备 / 路径 | 结果 |
| --- | --- |
| 台式机 i5-10500，CPU | 约 **228 秒** |
| 同机 Intel UHD 630，实验性 DirectML | 分块适配后约 **868 秒**，耗时为同机 CPU 的 **3.8 倍**；正式版本使用 CPU |
| 笔记本 AMD Radeon 780M | 小算子通过，模型推理报错；当前使用 CPU |
| Apple M5，24 GB，MPS | 生成 **84.5 秒**，无 CPU 回退；完整离线启动、API 和花瓶外形检查通过 |
| NVIDIA CUDA | 已提供运行路径和离线包；尚无完整 GPU 推理实测成绩，当前模型不支持 MX150 2 GB 的 GPU 推理，请使用 CPU |

Windows Intel/CPU 使用 **1 步、128 分辨率**，GPU 耗时累计自成功阶段，未验证外形质量。Mac 正式 API 使用推荐的 **5 步、256 分辨率**，包含提交与轮询共 86.5 秒；仅改为 1 步就出现花瓶变形，耗时也更长。这不是严格的跨平台性能排名，也不代表其他设备的表现。[测试条件与结果](./docs/history/model-generation-validation.md#2026-10-27设备实测汇总)。

离线后端包位于本地 `runtime/bundles/`（不随 Git 仓库分发）：

| 包名 | 适用范围 / 复用 |
| --- | --- |
| `g-studio-generation-win32-x64-cu124.zip` | Windows NVIDIA + CPU 共用，约 9.68 GB；`--cpu` 无需另下环境 |
| `g-studio-generation-win32-x64-cpu.zip` | Windows 纯 CPU，可选较小包，约 6.18 GB |
| `g-studio-generation-darwin-arm64-mps.zip` | Apple Silicon MPS + CPU 共用，约 5.29 GB |

解压后运行 `sh start-generation.sh --offline`（Windows 使用 Git Bash，Mac 使用终端）。包内含 Node、Python、依赖和权重，无需另装这些运行时；不包含网页前端。不同系统的二进制环境分开，模型权重与推理源码共用同一版本。详见[离线包与启动说明](./services/generation-python/README.md#portable-packages)。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动网页和 AI 后端 |
| `npm run dev:web` | 仅启动网页 |
| `npm run build` | 类型检查并构建到 `dist/`，不下载模型 |
| `npm run preview` | 本地预览构建产物 |
| `sh start-generation.sh` | 单独启动后端；Windows 使用 Git Bash |

AI 连接操作见[模型生成指南](./docs/guides/model-generation.md)；缓存、GPU、离线运行和分发包见[后端部署](./services/generation-python/README.md)。日常清理请保留 [`runtime/generation/`](./runtime/README.md)，删除后会重新准备所需资源。

## 文档与开发

- [文档索引](./docs/README.md)：使用指南、部署、技术参考、设计与验证记录。
- [开发指南](./CONTRIBUTING.md)：目录结构、开发流程和测试命令。
- [公网中转部署](./services/generation-relay/README.md)：让在线网页连接本机生成服务。

技术栈：Vue 3、TypeScript、Vite、Three.js、OpenCV.js。

推荐 Chrome 或 Edge，以使用 File System Access API 读写本地目录。其他浏览器可使用浏览器存储模式；重要资产请导出备份。

## 许可证

[Apache License 2.0](./LICENSE)。可选模型及上游推理代码遵循各自条款，见[第三方许可](./services/generation-python/README.md#license)。
