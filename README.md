[中文](./README.zh-CN.md) | **English**

<p align="center">
  <img src="./public/favicon.svg" width="128" height="128" alt="G-Studio Logo">
</p>

<h1 align="center">G-Studio</h1>

<p align="center"><strong>Lightweight Game Asset Workbench</strong> — slice sprites, generate tilesets, draw regions, edit maps, all in one place.</p>

**[Live Demo](https://huzz-open.github.io/g-studio/)** · [GitHub](https://github.com/huzz-open/g-studio)

---

G-Studio is a browser-based toolset for 2D game development, designed especially for Godot Engine projects. Core editing and assets stay local with no login required. Optional generation uses a local service or relay; relay tasks transfer images and models through the configured server.

## Try It Out

A sample sprite sheet is included in the [`samples/`](./samples/) directory for testing:

![Sample sprite sheet](./samples/沧澜水乡_snippet.png)

Open the Sprite Slicer module, drag and drop this image in, and try the auto-detection feature.

## Features

| Module | Description |
|--------|-------------|
| **Model Generation** | Silhouette approximation or local AI geometry, preview and save as a part; direct HTTP and WSS relay |
| **Resource Manager** | Browse local workspace directories, manage images and data files |
| **Sprite Slicer** | Auto/manual slice animation frames, icons, and items from sprite sheets |
| **Map Editor** | Edit world maps, place locations, draw roads and regions |
| **Tileset Maker** | Generate 47-tile auto-terrain atlases from textures or nine-grid sources, export Godot `.tres` |
| **Scene Region Editor** | Draw collision/occlusion regions on scene backgrounds, export Godot `.tscn` |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 22.12 (Vite 8 supports `^20.19.0 || >=22.12.0`)
- npm (included with Node.js); pnpm is also supported

### Install & Run

For developers in mainland China, run this once inside the cloned project **before `npm install`**:

```sh
npm run setup:cn
```

This dependency-free command persistently configures the current project to use Alibaba npmmirror, the Tsinghua Python package index, and ModelScope-first model weights. It does not change global settings, install packages, or download models. `npm run setup:default` removes the preset and restores the previous project npm configuration while keeping cached models.

Repository revisions, required weights, resumable downloads and SHA256 checks are managed by the project; no manual hashes, ModelScope SDK or account token are required for these public files. Verified configuration and license files ship with the project, so switching mirrors does not change inference settings. uv, the Python runtime, CPU/CUDA PyTorch packages and upstream inference source still use their respective official sources; GitHub-based npm dependencies are also unaffected by npm registry settings.

```bash
git clone https://github.com/huzz-open/g-studio.git
cd g-studio
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

`npm run dev` starts Vite and the Python generation service by default. On first launch it automatically prepares an isolated Python 3.12 environment, inference dependencies and approximately **4.2GB** of verified Hunyuan3D-2mini-Turbo weights. No manual Python/pip setup is required. Dependencies need additional space and download time. The web app starts first and remains usable during preparation. Later launches reuse the cache. Ctrl+C stops the launched processes. Windows users can also double-click `start-generation.cmd`; other platforms can run `sh start-generation.sh`.

GPU is preferred by default. Startup validates NVIDIA CUDA availability, logs detected adapters and the selected CPU/GPU type, and falls back to CPU if unavailable. Windows CPU inference is tested; NVIDIA and Linux execution still need hardware-specific verification. Intel integrated graphics are not treated as a supported CUDA device.

Open **Settings → Model generation → Connection settings → Direct API → Test connection**. Local development obtains the connection credential automatically and shows **Compute device: CPU / GPU**. The default mode remains silhouette approximation; starting a service does not upload images. Generate from the new menu or a part editor, inspect the result, then apply/save it. Saved mesh parts remain usable offline.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start both the local web app and AI generation service; use this for local use |
| `npm run dev:web` | Web only, without Python/model setup |
| `npm run generation:start` | Start only the AI generation service: prepare Python and models by default, then compute submitted jobs on this machine's GPU or CPU; does not start the web app |
| `npm run generation:download` | Download and verify models in advance |
| `npm run generation:doctor` | Check runtime and service connectivity |
| `npm run relay:start` | Start only the relay: transfer jobs, images and results between the website and generation service; does not download AI models or perform AI computation |

**How do `generation:start` and `relay:start` differ?**

`generation:start` launches the Python service that actually generates models, using the compute resources of the machine running it. `relay:start` launches a TypeScript (TS) service running on Node.js for device pairing, job forwarding and temporary transfer storage. “No AI on the relay” means that the connected generation service performs the computation. Running only the relay cannot generate AI models.

Choose according to your setup:

- **Web app and AI on your own computer:** run `npm run dev`. The browser connects directly to the local generation service; there is no need to run `relay:start` or a separate `generation:start`.
- **Website already running or deployed, with only the AI service missing:** run `npm run generation:start` on the machine that will perform the computation, then configure Direct API in the website.
- **Public website using your computer's compute through a relay:** run `npm run relay:start` on the server, run `npm run generation:start` with `--relay` on your computer, and complete the pairing steps below. Jobs travel from the website through the relay to your local AI service; results return along the same route.

Relay mode requires both services to be online. The relay server needs no GPU, but the machine running the generation service still needs the models and performs the AI computation.

The default cache/configuration directory is `~/.g-studio/generation`; override it with `GEN_HOME`. Failed downloads can resume. Configure `GEN_PORT` / `GEN_WEB_PORT` if ports are occupied. CPU inference takes minutes and needs several GB of available memory; lower extraction resolution, use remote compute, or keep silhouette mode on low-resource machines.

To use local compute through a public relay, first deploy the website and relay (`npm run relay:start`) on the server with HTTPS/WSS configured as described in the deployment guide below. Then run this on the user's computer that will perform AI computation:

```sh
npm run generation:start -- --relay wss://your-domain/generation/worker --pair
```

Enter the relay HTTPS base URL and eight-character code in the website, compare the request identifier, then type `y` in the worker terminal. Codes expire after five minutes and one successful use. Future launches can omit `--pair`, retaining the same cache directory and relay URL. Relay files are temporary (24 hours by default) and pass through the server; browser grants can be revoked. Direct mode avoids relay transfer but public-to-local access may require browser permission.

See [worker setup and configuration](./services/generation-python/README.md), [relay deployment](./services/generation-relay/README.md), [provider protocol](./packages/generation-protocol/README.md), and the [full design](./docs/model-generation-service-plan.md) (Chinese). Upstream [code](https://github.com/Tencent-Hunyuan/Hunyuan3D-2) and [model terms](https://huggingface.co/tencent/Hunyuan3D-2mini) remain applicable; weights do not inherit the project license.

### Build

```bash
npm run build
```

Output goes to `dist/`; building does not start Python or download weights. Static hosting serves the UI. WSS relay mode additionally requires the long-running TS service.

## Browser Compatibility

See the [validation record](./docs/model-generation-validation.md) (Chinese) for real CPU inference, TLS relay, offline assets and hardware validation limits.

G-Studio uses the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) to read/write local directories. Recommended:

- Chrome / Edge >= 86
- Other browsers work in "browser-only mode" (data stored in IndexedDB, not persisted to disk)

## Tech Stack

- Vue 3 + TypeScript + Vite
- Vue Router (Hash mode)
- IndexedDB + File System Access API (two-layer storage)
- OpenCV.js (image processing)

## License

[Apache License 2.0](./LICENSE)
