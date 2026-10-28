[中文](./README.zh-CN.md) | **English**

<p align="center">
  <img src="./public/favicon.svg" width="96" height="96" alt="G-Studio Logo">
</p>

# G-Studio

A browser-based game asset workbench for slicing sprites, editing parts, previewing lighting, and creating tilesets and scene regions, with Godot resource export.

**[Live demo](https://huzz-open.github.io/g-studio/)** · [Documentation](./docs/README.md) · [Development guide](./CONTRIBUTING.md)

Core editing requires no login and keeps assets local. Optional AI geometry generation uses a separate service; relay mode transfers images and models through the configured server.

## Features

| Feature | Purpose |
| --- | --- |
| Sprite slicing | Automatically or manually slice sheets and export individual sprites or atlases |
| Parts and scene lighting | Edit shared parts, normals and geometry; preview point and directional lights |
| Model generation | Generate silhouette or local AI geometry, retain results, and apply them in the part editor |
| Tileset generation | Build 47-tile terrain atlases and export Godot `.tres` files |
| Scene regions | Draw collision and occlusion regions and export Godot `.tscn` files |
| Resource management | Browse a local workspace and manage images and project files |

Drop the [sample sprite sheet](./samples/沧澜水乡_snippet.png) into Sprite Slicer to try it. See the [parts and lighting guide](./docs/guides/parts-and-lighting.md) (Chinese) for editing steps.

## Quick start

Requires Node.js 22.12+ and npm.

```sh
git clone https://github.com/huzz-open/g-studio.git
cd g-studio
# Optional for mainland China: npm run setup:cn
npm install
npm run dev
```

Open <http://localhost:5173>. `npm run dev` starts the web app and AI backend; the first launch prepares Python and downloads approximately **4.23GB of model weights**. Use `npm run dev:web` for web-only development or editing without Python and model setup.

See [download sources](./services/generation-python/README.md#download-sources) for the China preset and how to reset it.

## AI hardware and startup

Supported execution paths are **CPU, compatible NVIDIA CUDA GPUs, and Apple Silicon Macs (MPS)**. Ordinary Windows laptop integrated GPUs are not recommended for this model: inference can be slower than CPU or fail on backend/driver compatibility. A desktop CPU can outperform its integrated GPU.

| Device / path tested on 2026-10-27 | Result |
| --- | --- |
| Desktop i5-10500, CPU | About **228 seconds** |
| Same desktop, Intel UHD 630, experimental DirectML | About **868 seconds** after chunking adaptations: **3.8× the CPU time**; production uses CPU |
| Laptop AMD Radeon 780M | Small operations passed; model inference failed. Use CPU |
| Apple M5, 24 GB, MPS | **84.5 seconds** for generation, no CPU fallback; full offline startup, API and vase geometry inspection passed |
| NVIDIA CUDA | Execution path implemented; no complete GPU inference benchmark yet. MX150 2 GB GPU inference is not supported for this model; use CPU |

Windows Intel/CPU trials used **1 step, resolution 128**; GPU time aggregates successful phases and visual quality was not validated. The Mac API trial used the recommended **5 steps, resolution 256** (86.5 seconds including submission/polling). Reducing only the steps to 1 distorted the vase and was slower. These are not a controlled cross-platform ranking or a guarantee for other devices. See the [conditions and results](./docs/history/model-generation-validation.md#2026-10-27设备实测汇总) (Chinese).

The startup workflow uses current project source and automatic downloads through mirrors. From the project root:

```sh
npm run setup:cn                  # Optional, one-time China preset when Node/npm is available
sh start-generation.sh --cpu     # Prepare resources and start the CPU backend
```

Use Git Bash on Windows or Terminal on Mac. Backend-only startup needs neither `npm install` nor preinstalled Python; the script uses a compatible installed Node in place and downloads an official runtime only if no working Node is available locally. The China preset uses Tsinghua PyPI, NJU's matching PyTorch CPU/CUDA channel and ModelScope weights; runtime downloads may still use official sources. Pinned Hunyuan inference source ships as a verified repository wheel instead of individual network downloads.

Subsequent starts reuse complete resources. Use `--offline` only after preparation; starting the service does not generate a model until an image is submitted through the UI or API. See [backend startup](./services/generation-python/README.md#start).

On 2026-10-28, CPU startup from an empty runtime directory through real API generation passed locally. A 5-step / resolution-256 vase took about **5 min 6 sec**, producing 12,000 faces. First-time preparation took about 43 min 38 sec on this network, including roughly 4.23GB of weights; this is not cached startup latency. See [conditions, fixes and results](./docs/history/model-generation-validation.md) (Chinese).

## Common commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the web app and AI backend |
| `npm run dev:web` | Start only the web app |
| `npm run build` | Type-check and build to `dist/`, without model downloads |
| `npm run preview` | Preview the production build locally |
| `sh start-generation.sh` | Start only the backend; use Git Bash on Windows |

See the [model generation guide](./docs/guides/model-generation.md) (Chinese) for connection steps, and [backend deployment](./services/generation-python/README.md) for caching, GPU selection and offline operation. Keep [`runtime/generation/`](./runtime/README.md) during cleanup; deleting it triggers resource preparation again.

## Documentation and development

- [Documentation index](./docs/README.md): guides, deployment, references, designs and validation records; entries identify their language.
- [Development guide](./CONTRIBUTING.md) (Chinese): project structure, workflow and tests.
- [Relay deployment](./services/generation-relay/README.md): connect a public website to your local generation service.

Built with Vue 3, TypeScript, Vite, Three.js and OpenCV.js.

Chrome or Edge is recommended for local directory access through the File System Access API. Other browsers can use browser storage; export important assets as backups.

## License

[Apache License 2.0](./LICENSE). Optional models and upstream inference code retain their own terms; see [third-party licensing](./services/generation-python/README.md#license).
