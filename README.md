# G-Studio

A browser-based game asset workbench for sprite slicing, part editing, lighting previews, tileset creation and Godot resource export.

[Live demo](https://huzz-open.github.io/g-studio/) · [Documentation](docs/README.md) · [Development guide](CONTRIBUTING.md) · [中文](README.zh-CN.md)

## Features

- **Sprite slicing**: slice automatically or manually, then export sprites and atlases.
- **Parts and lighting**: edit normals and geometry, and preview lights and shadows in a scene.
- **Model generation**: create geometry with silhouette approximation or an optional local AI service.
- **Tilesets and scene regions**: build 47-tile terrain atlases, collision and occlusion regions, and export Godot resources.
- **Resource management**: browse a local workspace and save and organize project files.

Core editing requires no login. Drop the [sample sprite sheet](samples/沧澜水乡_snippet.png) into Sprite Slicer to try it. Chrome or Edge is recommended for local directory access; export important assets as backups.

## Run locally

Requires Node.js 22.12+ and npm.

```sh
git clone https://github.com/huzz-open/g-studio.git
cd g-studio
npm install
npm run dev:web
```

Open <http://localhost:5173>. These steps start only the web app, without Python or model downloads. For mainland China, optionally run `npm run setup:cn` before installing dependencies.

### Start the AI backend

From the repository root, run `npm run dev` to start both the web app and backend, or start only the backend:

```sh
npm run dev:gensvc
```

Mini Turbo is enabled by default. First-time setup prepares the runtime and downloads approximately 4.23 GB of model weights. Use `--models` to choose the enabled models:

```sh
npm run dev:gensvc -- --models turbo       # Standard Turbo
npm run dev:gensvc -- --models 2.1         # Full 2.1 Shape
npm run dev:gensvc -- --models mini,turbo  # Multiple models
npm run dev:gensvc -- --models all         # All models
```

The same options can be passed to `npm run dev --` to start the web app too. Once the desired model is ready, enter the service address shown in the startup terminal, obtain the token using the terminal instructions, and test the connection in the web app. See the [model generation guide](docs/guides/model-generation.md) (Chinese) and [backend configuration](services/generation-python/deployment.md) for connection and device settings.

## Development

| Command | Purpose |
| --- | --- |
| `npm run dev:web` | Start the web development server |
| `npm run dev` | Start the web app and AI backend |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Preview the production build |

Built with Vue 3, TypeScript, Vite, Three.js and OpenCV.js. See the [development guide](CONTRIBUTING.md) for project structure and validation, and the [Godot integration guide](integrations/godot/README.md) for plugin installation (both Chinese).

## License

[Apache License 2.0](LICENSE). Optional models and upstream inference code retain their own [third-party terms](services/generation-python/deployment.md#license).
