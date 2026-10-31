# Generation backend

Python service for optional AI model generation. It provides an authenticated HTTP API and keeps model resources separate from private credentials and jobs.

[Browser guide (中文)](../../docs/guides/model-generation.md) · [Configuration](deployment.md) · [API contract](../../packages/generation-protocol/README.md)

## Start

From the repository root:

```sh
sh start-generation.sh --cpu
```

Use Git Bash on Windows or a terminal on macOS/Linux. Backend-only startup does not require frontend dependencies or preinstalled Python; the launcher prepares the environment. The default Mini model downloads approximately 4.23 GB of weights on first use and reuses verified resources on later starts.

With Node/npm installed, `npm run dev:gensvc -- --cpu` is also available, including from PowerShell. Use `npm run dev` after `npm install` to start the web app and backend together.

Enter the API address and credential from the backend in the web app's model generation settings. The default address is <http://127.0.0.1:8765>. HTTP availability and model readiness are separate states.

## Configuration

| Task | Documentation |
| --- | --- |
| Select CPU, NVIDIA CUDA or Apple MPS | [Devices and platform support](deployment.md#gpu-and-platform-support) |
| Enable Mini, Turbo or full 2.1 Shape | [Models and startup policy](deployment.md#shape-models-and-startup-policy) |
| Use mirrors or prepare downloads | [Download sources](deployment.md#download-sources) |
| Install from a hosted website | [External installation](deployment.md#external-installation) |
| Connect from another device | [Direct access](deployment.md#direct-access-from-another-device) |
| Reuse caches without downloads | [Offline operation](deployment.md#reusing-resources-offline) |
| Set paths, ports and origins | [Environment variables](deployment.md#configuration) |
| Diagnose failures | [Troubleshooting](deployment.md#troubleshooting) |

Keep [`runtime/generation/`](../../runtime/README.md) to retain downloaded resources. `runtime/generation-data/` contains private credentials and temporary jobs.

## Scope

The service generates model. Single-image output can contain incorrect or missing structure; inspect results before use. Platform measurements and quality limitations are in the [validation records](../../docs/history/README.md#模型生成).

Upstream code and models retain their own terms. See [licensing and source provenance](deployment.md#license).
