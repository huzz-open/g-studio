# G-Studio

浏览器中的游戏资源工作台，支持精灵切图、部件编辑、光影预览、瓦片集制作和 Godot 资源导出。

[在线体验](https://huzz-open.github.io/g-studio/) · [使用文档](docs/README.md) · [开发指南](CONTRIBUTING.md) · [English](README.md)

## 功能

- **精灵切图**：自动或手动切分，导出散件与图集。
- **部件与光影**：编辑法线和几何，在场景中预览灯光与阴影。
- **模型生成**：使用轮廓近似或可选的本地 AI 服务生成几何。
- **瓦片与场景区域**：制作 47-tile 地形图集、碰撞和遮挡区域，导出 Godot 资源。
- **资源管理**：浏览本地工作区，保存与管理工程文件。

基础编辑无需登录。可将[示例精灵图](samples/沧澜水乡_snippet.png)拖入切图工具开始体验。推荐使用 Chrome 或 Edge 访问本地目录；重要资产请导出备份。

## 本地运行

需要 Node.js 22.12+ 和 npm。

```sh
git clone https://github.com/huzz-open/g-studio.git
cd g-studio
npm install
npm run dev:web
```

打开 <http://localhost:5173>。以上步骤只启动网页，无需 Python 或模型下载。国内网络可在安装依赖前执行 `npm run setup:cn`。

### 启动 AI 后端

在项目根目录运行 `npm run dev` 可同时启动网页和后端；只启动后端可运行：

```sh
npm run dev:gensvc
```

默认启用 Mini Turbo，首次启动会准备运行环境并下载约 4.23 GB 的模型权重。使用 `--models` 指定启用的模型：

```sh
npm run dev:gensvc -- --models turbo       # Standard Turbo
npm run dev:gensvc -- --models 2.1         # Full 2.1 Shape
npm run dev:gensvc -- --models mini,turbo  # 同时启用多个模型
npm run dev:gensvc -- --models all         # 启用全部模型
```

也可将这些参数传给 `npm run dev --`，同时启动网页。等待所需模型显示就绪后，在网页中填写启动终端显示的服务地址，并按终端提示获取 token 后测试连接。连接方式与设备配置见[模型生成指南](docs/guides/model-generation.md)和[后端配置](services/generation-python/deployment.md)。

## 开发

| 命令 | 用途 |
| --- | --- |
| `npm run dev:web` | 启动网页开发服务 |
| `npm run dev` | 启动网页和 AI 后端 |
| `npm run build` | 类型检查并构建到 `dist/` |
| `npm run preview` | 预览构建产物 |

技术栈：Vue 3、TypeScript、Vite、Three.js、OpenCV.js。目录结构与验证流程见[开发指南](CONTRIBUTING.md)；Godot 插件安装见[集成说明](integrations/godot/README.md)。

## 许可证

[Apache License 2.0](LICENSE)。可选模型与上游推理代码遵循各自的[第三方许可](services/generation-python/deployment.md#license)。
