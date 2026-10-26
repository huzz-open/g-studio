# Local generation service

Run from the repository root after `npm install`:

```sh
npm run dev
```

This starts the web app and prepares an isolated Python 3.12 environment, PyTorch, pinned source code and approximately 4.2GB of Hunyuan3D-2mini-Turbo weights. The frontend remains usable while dependencies/models prepare. `Ctrl+C` stops processes launched by this command. No global Python packages are changed. The default frontend connection mode remains silhouette approximation; choose **Settings → Model generation → Connection settings → Direct API → Test connection** to enable service generation. The local Vite development server supplies the device-local token without adding it to the production bundle.

`npm run dev:web` starts only Vite. `npm run generation:start` runs only the worker. `npm run generation:download` prepares verified model files in advance. `npm run generation:doctor` checks the isolated runtime and service reachability. `start-generation.cmd` and `start-generation.sh` are convenience launchers after installing Node.js; they also install npm dependencies when missing.

## GPU selection

Startup detects NVIDIA hardware, chooses CUDA-enabled PyTorch when appropriate, then verifies a CUDA device operation in the isolated runtime. GPU is preferred by default. CPU is used when no compatible GPU is available or initialization fails. Logs show detected adapter names, the reason for fallback and the selected CPU/GPU category. `GEN_DEVICE=cpu` or `--cpu` forces CPU for diagnosis. A recoverable CUDA failure may retry the same task once on CPU after releasing the GPU process.

The tested machine is Windows x64, i5-10500, 32GB RAM, Intel UHD 630. UHD is logged but does not count as a supported CUDA GPU. CPU inference is real; NVIDIA and Linux paths require verification on their respective hardware before claiming those platform results. AMD/Intel/Apple GPU inference is not supported by this provider. GPU preference does not imply every installed graphics card can run the model.

## Paths and configuration

For the China preset, run `npm run setup:cn` at the repository root before installing npm dependencies. The local `.generation-mirrors.local.json` selects ModelScope-first weights, and the launcher supplies the Tsinghua package index to uv for ordinary packages. PyTorch installation stays on its explicit CPU/CUDA index. The preset and project npm override are excluded from Git and do not alter global configuration; `npm run setup:default` reverses the preset.

The downloader ships verified model configuration and license files in `bundled/`. ModelScope's main configuration differs from the already tested upstream revision, so it is deliberately not used as a substitute. Matching ModelScope weight URLs, fixed revisions, byte lengths and SHA256 checks are built in; users do not select them. Details are recorded in [bundled file provenance](./bundled/README.md).

Default home: `~/.g-studio/generation`. `config.json` contains separate direct-access and worker credentials. It is device-private and must not be committed or exported with a workspace. Configuration is generated on first service start. Model files live in `models/`, pinned upstream code in `vendor/`, temporary jobs in `jobs/`, and the isolated environment in `venv/`.

| Variable | Purpose |
| --- | --- |
| `GEN_HOME` | Override the full service data/cache location |
| `GEN_PORT` | Loopback HTTP port, default 8765 |
| `GEN_WEB_PORT` | Default development launcher web port, default 5173 |
| `GEN_ORIGINS` | Comma-separated exact allowed browser origins; default localhost/127.0.0.1 on 5173 |
| `GEN_DEVICE` | `cpu` to override GPU preference |
| `GEN_PYTHON` | Use an explicitly managed Python executable; dependencies must already be installed |
| `GEN_IMPORT_CACHE` | Import matching source/model files from an existing cache, with SHA256 verification |
| `GEN_MODEL_SOURCE` | Optional explicit source priority: `modelscope` or `huggingface`; normally set automatically by the project preset |
| `GEN_SKIP_MODEL` | `1` prepares only the lightweight algorithm provider; no Hunyuan download |
| `GEN_RELAY_URL` | Outbound `wss://.../generation/worker` endpoint |
| `GEN_PAIR` | `1` enables a new five-minute pairing session at this launch |
| `GEN_PAIR_CODE` | Optional eight-character alphanumeric code for that pairing session; never a permanent password |

Environment variables are optional; the default local workflow needs none. Python also reads `relayUrl` from its local `config.json`. For PowerShell use `$env:GEN_HOME = 'D:\GStudioCache'`; for a POSIX shell use `export GEN_HOME="$HOME/GStudioCache"`.

Existing experiment weights can be reused once with `GEN_IMPORT_CACHE` pointing to `experiments/hunyuan3d-local`; runtime does not depend on the experiments directory. Subsequent offline startup uses the verified cache. Download failures preserve resumable `.part` files. Corrupt files fail checksum verification and are re-downloaded. The download uses an OS-owned lock that is released automatically when its process exits; the lock file itself may remain safely.

The service has one active task and up to eight queued tasks. It accepts images up to 10MiB, 2048 pixels per side and four million pixels, and generates a 1,000–40,000-face shadow proxy (12,000 default). Source geometry may contain far more triangles. Single-image reconstruction can close real openings or invent hidden surfaces; inspect results before applying.

## Using a public website with your local machine

Direct mode: run the worker, add the exact public site origin to `GEN_ORIGINS`, enter `http://127.0.0.1:8765` and the direct token from `config.json` in that site's settings, then grant the browser's local-network permission if requested. Do not disable browser security. Browser compatibility varies; use relay mode if direct local-network access is unavailable.

Relay mode:

```sh
npm run generation:start -- --relay wss://your-domain.example/generation/worker --pair
```

The worker prints a five-minute code. Enter it in the website's relay settings, compare the request identifier, then type `y` in the worker terminal. The website receives a device-scoped browser grant, never the worker secret. Following launches can omit `--pair`; keep the same `GEN_HOME` and relay URL. Use the website's **Unbind and forget credentials** to revoke browser grants. Stop the local worker to stop accepting work. To retire the device identity completely, stop it, remove its local credentials and restart with a fresh identity; old grants remain tied to the old offline identity and cannot use the new one.

Only WSS is accepted for remote relay connections. Plain WS is allowed solely for localhost development. The worker never opens a public inbound port. Public relay files are temporary and readable by the relay operator; this is not end-to-end encryption. Final assets remain in the browser's part library and exports. Completed server task files expire after 24 hours or shortly after the client acknowledges durable receipt.

## Extension and license

Implement the [generation protocol](../../packages/generation-protocol/README.md) in any language, or register a Python `Provider` in `providers.py`. Pure algorithms do not require model weights. The service never manages scene assets or executes request-supplied code.

The G-Studio license does not replace the upstream code and model terms. Pinned downloads retain `vendor/Hunyuan3D-2/LICENSE`, `models/LICENSE` and `models/NOTICE`. Sources: [Hunyuan3D-2](https://github.com/Tencent-Hunyuan/Hunyuan3D-2), [Hunyuan3D-2mini weights](https://huggingface.co/tencent/Hunyuan3D-2mini), [Tencent mirror](https://modelscope.cn/models/Tencent-Hunyuan/Hunyuan3D-2mini). File versions, checksums and mirror URLs are listed in `model-manifest.json`.

## Verification

```sh
npm run test:generation
python tests/generation_service_test.py
```

Use the service's isolated Python for the second command. It runs actual temporary HTTP and relay servers plus the lightweight algorithm, tests pairing via the real terminal confirmation path, verifies GLB hashes and checks authorization. A real Hunyuan run is a separate multi-minute validation. Do not treat the algorithm test as evidence of AI reconstruction quality.
