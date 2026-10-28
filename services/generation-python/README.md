# Generation backend deployment

Run commands from the current repository root. Source checkout plus automatic mirror downloads is the supported startup workflow. For browser operations see the [model generation guide](../../docs/guides/model-generation.md) (Chinese); for code changes see the [development guide](../../CONTRIBUTING.md).

## Start

```sh
sh start-generation.sh --cpu
```

Use Git Bash on Windows, a terminal on macOS/Linux. WSL uses Linux resources. The launcher uses a compatible installed Node in its original location first. If none is available, it reuses the launcher's cached Node or downloads a verified official runtime. System Node executables are never copied into the project; Homebrew and other package-manager builds can depend on libraries in their original installation.

Backend preparation manages Python, dependencies and models independently of Node installation. Both `sh start-generation.sh` and the npm commands use their working Node directly, without preparing a portable Node copy or fetching its license. Old Node files under `runtime/generation/platforms/` are ignored when a compatible installed Node is available; no cache cleanup is required after updating the source.

For the default device policy omit `--cpu`. First launch prepares Python 3.12, dependencies, pinned inference source and about **4.23GB of model weights**, opens HTTP after Python setup, and prepares model resources in the background. Complete compatible resources are reused; missing or incompatible resources are repaired. Ctrl+C stops the processes launched by this command. Do not use `--offline` on a fresh installation: that flag forbids required downloads.

| Task | Command |
| --- | --- |
| Web app and backend, after `npm install` | `npm run dev` |
| Web app only | `npm run dev:web` |
| Backend only | `sh start-generation.sh` |
| Prepare and start the real model on CPU in one command | `sh start-generation.sh --cpu` |
| Prepare CPU resources without serving | `sh start-generation.sh prepare --cpu` |
| Prepare NVIDIA CUDA resources (also works on a CPU build host) | `sh start-generation.sh prepare --cuda` |
| Prepare Apple Silicon MPS/CPU resources on a Mac | `sh start-generation.sh prepare --mps` |
| Check environment and connectivity | `sh start-generation.sh doctor --cpu` |
| Lightweight algorithm backend, no model | `sh start-generation.sh --base` |

The backend launcher does not need or install frontend npm dependencies. Wait for the `hunyuan-mini` provider to become `ready`, then upload an image through the web app or authenticated API. `/health` alone does not prove model preparation is finished. Normal model parameters are 5 steps, resolution 256 and 12,000 target faces; a one-step trial is not a quality check. Development Vite supplies the local direct token to the browser; production builds do not embed it. Starting the backend does not upload an image or select AI automatically.

## Download sources

If Node/npm is available, optionally set the project preset once before starting (no frontend installation is required for backend-only use):

```sh
npm run setup:cn
```

This project-local preset configures npm to use npmmirror, ordinary Python packages to prefer Tsinghua, PyTorch to use NJU's matching CPU/CUDA channel, and model weights to prefer ModelScope. It persists across terminals and does not modify global configuration. Explicit environment overrides take precedence. Run `npm run setup:default` to restore the previous project npm settings and remove the preset; cached models remain.

uv tries Tsinghua's mirror of the official PyPI prebuilt wheel first, then the official GitHub release. Version, filenames, sizes and SHA256 values are pinned in `scripts/generation/uv-wheels.json`; extracting the native executable does not require Python. A valid cached uv remains first choice. PyTorch wheel resolution can fall back to SJTU and official PyTorch sources; ordinary wheels use exact filename/SHA256 matching across the configured, Aliyun and PyPI sources. Downloaded wheels are installed locally after verification. Node/Python runtime downloads and some license fetches can still use official sources; the preset is not a global proxy. GitHub-based npm dependencies are unaffected by npm registry settings.

Hunyuan shape inference code ships as the small, pinned [source wheel](./bundled/wheels/README.md) committed to this repository. Startup verifies its size/SHA256 and materializes it under `runtime/generation/vendor/Hunyuan3D-2/`, without fetching individual source files from GitHub. It is a G-Studio source distribution, not an official Tencent wheel or the full upstream texture pipeline. Model weights remain separately downloaded and verified.

The first dependency-resolution pass also prepares local PyTorch wheels, so cold disk/cache work can take more than a minute before index resolution. Each source attempt has a five-minute overall limit; HTTP requests retain their own timeouts. A resolution wait does not by itself mean a mirror is unavailable.

## External installation

The connection settings generate a command from the current website's origin and base path. For a site hosted under `/studio/`, the command has this form:

```sh
G_STUDIO_SITE='https://your-site.example/studio/'
curl -fsSL "$G_STUDIO_SITE"install-generation.sh | bash -s -- --site "$G_STUDIO_SITE" --host 0.0.0.0
```

Omit `--host 0.0.0.0` for loopback-only access. The installer defaults to `~/.g-studio/backend`; `--dir /absolute/path`, `--port`, repeated `--origin`, `--cpu` / `--cuda` / `--mps`, and `--mirror cn|default` are optional. It downloads a source archive from that same site, verifies SHA256, and calls its `start-generation.sh`. The site origin and localhost:5173 origins are allowed automatically. No Git, npm or preinstalled Python is required. Bash, curl, tar, and sha256sum or shasum are required; Windows uses Git Bash. The default mirror profile is `cn`.

Source versions live in `versions/<sha256>/`; `resources/` and private `data/` stay outside them. A repeat install reuses the completed source version, downloaded models and credentials. The generated `start.sh` retains network/device settings for subsequent starts. It runs in the foreground; keep the terminal open. A failed checksum does not replace the previous start command or private data. Existing checkouts should run their own `sh start-generation.sh` instead: that script never downloads or updates project source and reports missing project files before environment setup.

`npm run build` publishes `install-generation.sh`, `generation-source.sha256`, and a source archive named by its SHA256 alongside the website. This archive contains only the backend source and launcher, including the pinned inference source wheel. It contains no installed runtime, frontend dependencies, models or credentials. Vite development serves the same files. Publish the entire build output, including these assets, when hosting the frontend under a custom domain or subpath.

## Direct access from another device

```sh
sh start-generation.sh --host 0.0.0.0 --port 8765 --origin https://your-site.example
```

The default is `127.0.0.1`, which only accepts local connections. `0.0.0.0` listens on IPv4 interfaces; enter the backend computer's actual IP (for example `http://192.168.1.20:8765`) in the browser, never `0.0.0.0`. The terminal prints API addresses, the direct token, allowed origins and a restart command. Local/private IPs may use HTTP; public APIs require HTTPS at the service or a reverse proxy. The browser still enforces its own network permissions and mixed-content rules. Token authentication, exact CORS origins and Host validation remain enabled on all interfaces.

The webpage may be hosted on any server: direct requests originate from the user's browser, so it is the browser's network that must reach the API. New browsers start with an empty API address and do not probe localhost or load credentials until an address is supplied. For an explicitly configured loopback API in development, the local Vite endpoint may fill the token automatically. The settings expose direct APIs only; historical relay job snapshots remain readable for compatibility.

Model versions, file URLs, resume and SHA256 verification are built in; no user-selected hashes, ModelScope SDK or token are needed for these public weights. Verified configurations and notices ship in [bundled/](./bundled/README.md). Switching download mirrors does not substitute ModelScope's differing model configuration.

## Resources and private data

| Directory | Contents | Cleanup / sharing |
| --- | --- | --- |
| `runtime/generation/` | Shared models/source, platform runtimes and download caches | Keep during routine cleanup; excluded from Git |
| `runtime/generation-data/` | Device credentials and temporary jobs | Private; do not distribute |
| `runtime/archives/` | Retired local experiments | Historical only; not a runtime dependency |

Within the resource root, `models/` and `vendor/` are shared. uv, Python and the launcher's optional Node download cache live under `platforms/<os>-<arch>/`; Python variants are `base`, `cpu`, `cu124` and `mps`. Python is a self-contained interpreter tree, not a venv tied to a user's original path. Intel XPU and AMD ROCm are not advertised as supported variants.

If `GEN_HOME` is set without `GEN_DATA_HOME`, private data also uses the custom resource root for compatibility. Set both explicitly when separating a migrated installation. See [runtime directory notes](../../runtime/README.md).

Use `GEN_IMPORT_CACHE` for an existing directory containing matching `models/` and `vendor/`. Imports are verified; legacy credentials are not imported. Model hashing may take time even when no download is needed.

## Reusing resources offline

After online preparation succeeds, keep `runtime/generation/` and run the project's script:

```sh
sh start-generation.sh --offline --cpu
```

This reuses installed dependencies and verified models; missing resources fail clearly in offline mode. CPU, CUDA and MPS environments are selected from the requested device and platform, not archive metadata. Mac ARM64 uses the same environment for MPS and CPU. Packaging and cross-platform archive assembly commands have been removed.

## GPU and platform support

On Windows, automatic preparation selects CUDA only when NVIDIA hardware is detected; Intel/AMD GPUs use the CPU profile. Runtime probing distinguishes CUDA from HIP/ROCm, even though both expose `torch.cuda`, and never advertises ROCm/XPU as supported. On Apple Silicon, automatic preparation selects the standard Mac ARM64 PyTorch distribution and prefers MPS after a real device operation check. CPU remains available in the same distribution.

Force CPU with `--cpu`; use `--cuda` or `--mps` to prepare a specific environment. `GEN_DEVICE` accepts `auto`, `cpu`, `cuda`, `mps`. Explicit unavailable/unsupported devices fail clearly. Auto detection may choose CPU at startup; execution errors never retry on another backend/model/strategy. API device info includes `backend` and a diagnostic `reason`, and the UI identifies NVIDIA CUDA or Apple MPS when actually selected.

| Platform / device | Implemented behavior | Verification boundary |
| --- | --- | --- |
| Windows x64 CPU | CPU FP32, startup capacity policy | Historical Mini inference/relocation tested; new multi-model CPU path not re-benchmarked this round |
| Windows x64 NVIDIA | PyTorch 2.6.0 + CUDA 12.4, FP16; execution errors fail the task | CUDA dependencies can be prepared on CPU; NVIDIA GPU inference needs compatible-device validation. Not every new/old NVIDIA architecture is guaranteed by this pinned build |
| Apple Silicon, target macOS 14+ | ARM64 PyTorch 2.6.0, MPS preferred, FP16 sampling/decoding (Mini image encoder FP32) and CPU noise generator; execution errors fail the task | Current Apple M5 (24 GB, macOS 26.5.2) real runs and raw/final inspections are recorded separately; semantic/decimation limitations remain, other Macs unvalidated |
| Windows Intel/AMD GPUs | Production uses CPU | Experimental UHD 630 DirectML required adaptations and took 868 s versus 228 s CPU; Radeon 780M model inference failed. This does not establish that all Intel/AMD hardware is incapable |
| Intel macOS | Lightweight `--base` only | Pinned full-model PyTorch does not support macOS x64 |
| Linux x64/ARM64 | Preparation paths retained | Not validated on Linux hardware here |

NVIDIA GeForce MX150 (2 GB) is not supported for GPU inference with the current model. Use `--cpu`.

Weights are fixed data, while the runtime executes operators. CUDA, MPS and CPU have different kernels, supported dtypes, random generators and memory limits. The adapter does not retrain or modify weights; it chooses compatible execution behavior. The current service generates geometry only, not the upstream CUDA texture-rendering extensions.

New multi-model validation belongs to the [2026-10-28 record](../../docs/history/model-generation-upgrade-20261028.md). Historical environments and results belong to the dated [validation record](../../docs/history/model-generation-validation.md). CPU generation can take several minutes.

The historical 2026-10-27 Mini FP32 API vase task on Apple M5 took 84.5 s for generation (86.5 s including submission/polling), using 5 steps and resolution 256 without CPU fallback. Those settings describe historical Mini, not full 2.1 (50 steps by default): reducing only the steps to 1 produced severely distorted geometry and took about 202 s. The earlier 99 s minimal test established execution only, not acceptable geometry. Ordinary Windows integrated GPUs are not recommended for this backend: a desktop CPU may be faster, and driver/operator compatibility can prevent completion. These are specific workload observations, not a controlled cross-platform ranking. GPU speed-based automatic selection has not been implemented.

## Shape models and startup policy

The default enabled set remains Mini to preserve the 4.23 GB first-install footprint. Standard Turbo and full 2.1 Shape are independently pinned and can be enabled explicitly:

```sh
sh start-generation.sh prepare --models all --mps
sh start-generation.sh --models all --mps --precision fp16 --offline
# Allow one model to reside when the combined three-model budget would not fit:
sh start-generation.sh --models turbo --mps --offline
```

All three weight sets total 16,934,572,304 bytes; this is disk size, not runtime memory. Cached files are SHA256-verified and reused. Standard Turbo uses its own 3072-token VAE; Mini uses 512 tokens. Full 2.1 has 4096 tokens and its embedded full VAE/conditioner, with separate pinned shape source. There is no 2.1 Small, texture/PBR or additional inference backend.

HTTP is available during preparation, loading and bounded warmup. Enabled loading models accept queued requests; the UI shows two-character positioning tags separately from status. Cancelling queued tasks never interrupts public loading. Resident models are proactively loaded once and reused; staged-ready models have verified resources and load one phase per task. Running resident cancellation is checked between encoder blocks, diffusion steps and decoder chunks, with checks around simplification.

Startup capacity sums every resident model's weights AND workspace reserve, then adds the largest staged phase with its workspace, 5% parameter margin, 2 GiB system reserve and 1 GiB loading reserve. Workspace reserve per resident (and for the one staged process) is MPS 5 GiB FP16 / 9 GiB with an FP32 image encoder, CPU/CUDA 4 GiB. Mini on MPS always keeps its 1022-pixel DINO encoder in FP32; both its FP32 parameter bytes and larger workspace are included. This accounts for separate resident processes retaining graph/host allocator caches even though execution is serialized. MPS uses the smaller of available system memory after reserve and its recommended device budget, never their sum. These are conservative planning estimates, not measured peak guarantees; PyTorch driver caches and different inputs can still exhaust memory. Insufficient capacity reports failure, without substituting a different configuration. Auto strategy is chosen once, never retuned after the first task.

Input resizing/cropping/normalization is always CPU FP32; the transformer, diffusion network and VAE stay on the selected inference device. This fixed adapter avoids the pinned MPS antialiased-resize operator gap without error-triggered CPU fallback. The 2.1 full-VAE hierarchical adapter preserves floating coordinate spacing; it does not use Turbo weights or adaptive KV selection. Warmup covers a synthetic image, one sampling step and a resolution-15 volume; full-resolution kernels and different inputs can still have first-use overhead.

Startup prints a three-column current configuration table. Credentials remain in the private config path printed by the service. Every task logs its result and monotonic total/execution time. Per-task sampled process/device memory is reported separately because unified memory cannot be added across those counters.

## Configuration

All variables are optional for the default local workflow.

| Variable | Purpose |
| --- | --- |
| `GEN_HOME` | Override the resource root (default project `runtime/generation`) |
| `GEN_DATA_HOME` | Override private credentials/job storage |
| `GEN_OFFLINE` | `1` forbids setup downloads; incomplete resources produce a clear error |
| `GEN_HOST` | Listen IP, default 127.0.0.1; use 0.0.0.0 to accept other devices |
| `GEN_PORT` | HTTP port, default 8765 |
| `GEN_HOST_NAME` | Optional exact hostname accepted behind a reverse proxy |
| `GEN_WEB_PORT` | Default development launcher web port, default 5173 |
| `GEN_ORIGINS` | Comma-separated exact allowed browser origins; default localhost/127.0.0.1 on 5173 |
| `GEN_DEVICE` | `auto`, `cpu`, `cuda`, or `mps`; explicit unavailable/unsupported devices fail |
| `GEN_PYTHON` | Use an explicitly managed Python executable; dependencies must already be installed |
| `GEN_IMPORT_CACHE` | Import matching source/model files from an existing cache, with SHA256 verification |
| `GEN_MODEL_SOURCE` | Optional explicit source priority: `modelscope` or `huggingface`; normally set automatically by the project preset |
| `GEN_MODELS` | Enabled set: `mini` (default), `turbo`, `2.1`, comma-separated combinations or `all`; also `--models` |
| `GEN_PRECISION` | `fp16` (GPU default) or `fp32` (CPU required); also `--precision`; fixed for sampling/decoding; Mini on MPS always uses an FP32 image encoder, reported separately |
| `GEN_STRATEGY` | `auto` (default), `resident` or `staged`; also `--strategy`; forced residency must fit aggregate startup capacity |
| `GEN_SKIP_MODEL` | `1` prepares only the lightweight algorithm provider; no Hunyuan download |
| `GEN_RELAY_URL` | Outbound `wss://.../generation/worker` endpoint |
| `GEN_PAIR` | `1` enables a new five-minute pairing session at this launch |
| `GEN_PAIR_CODE` | Optional ten-character code using uppercase A–Z and digits 0–9; possession grants access, valid for five minutes and one use |

PowerShell example: `$env:GEN_HOME = 'D:\GStudioCache'`. POSIX example: `export GEN_HOME="$HOME/GStudioCache"`. Python also reads `relayUrl` from its private `config.json`.

The service permits one active and eight queued tasks. Image and result limits are exposed by the [capabilities API](../../packages/generation-protocol/README.md); clients may impose tighter import limits.

## Public websites

For direct access, allow the exact site origin with `--origin` or `GEN_ORIGINS`, configure the backend address reachable from the user's browser and its direct token, and grant browser local-network permission if requested. The website's server does not forward these requests. An HTTPS website calling an HTTP local API is subject to browser-specific permission/mixed-content behavior; the app cannot override browser policy. For a public API use an HTTPS reverse proxy with a trusted certificate matching that API's hostname.

Legacy relay deployment is retained for existing clients and is no longer offered in the current settings. An explicitly opted-in legacy worker can use the [relay service](../generation-relay/README.md):

```sh
sh start-generation.sh --relay wss://your-domain.example/generation/worker --pair
```

Legacy clients follow the [relay authorization protocol](../generation-relay/README.md#authorization). Current connection settings migrate to direct APIs. A saved `relayUrl` alone no longer starts a background relay connection; legacy workers must opt in explicitly through `--relay` or `GEN_RELAY_URL`.

Remote connections require WSS; plain WS is limited to localhost development. The worker opens no public inbound port. Relay operators can read temporary files; this is not end-to-end encryption. Authorization and retention rules are maintained in the [relay deployment guide](../generation-relay/README.md).

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Setup downloads recur | Keep the resource root; inspect missing/incompatible files, selected platform and CPU/CUDA variant |
| Port already in use | Stop the existing service or set `GEN_PORT`; set `GEN_WEB_PORT` for combined development |
| Browser connection rejected | Exact `GEN_ORIGINS`, correct direct token, and browser local-network permission |
| Offline preparation fails | Prepare the same platform/variant online, then repeat the offline check |
| Windows extraction fails | Use a short path and an extractor supporting ZIP64 |
| CPU selected unexpectedly | Read the backend and reason in diagnostics. CUDA requires compatible NVIDIA hardware; MPS requires Apple Silicon. Intel/AMD GPUs deliberately use CPU |

## Extension and verification

Implement the [generation protocol](../../packages/generation-protocol/README.md), or register a Python Provider. The runner handles temporary tasks and result normalization; providers do not manage frontend assets.

Test commands and environment prerequisites are in the [development guide](../../CONTRIBUTING.md#python-与真实推理). Lightweight algorithm checks do not establish AI reconstruction quality.

## License

The project license does not replace upstream code or model terms. Hunyuan shape source is shipped as a small, checked-in [source wheel](./bundled/wheels/README.md), verified and unpacked locally during model preparation; startup no longer downloads individual upstream source files. Its upstream LICENSE and NOTICE remain in the wheel's `.dist-info/licenses/` directory. Model downloads retain `models/LICENSE` and `models/NOTICE`; [model-manifest.json](./model-manifest.json) records model versions and hashes, and [source-manifest.json](./bundled/wheels/source-manifest.json) records the pinned source inputs.

Sources: [Hunyuan3D-2](https://github.com/Tencent-Hunyuan/Hunyuan3D-2), [Hunyuan3D-2mini](https://huggingface.co/tencent/Hunyuan3D-2mini), [Tencent ModelScope mirror](https://modelscope.cn/models/Tencent-Hunyuan/Hunyuan3D-2mini). Bundled runtime notices are documented [here](../../scripts/generation/licenses/README.md).

Mini on MPS uses a fixed FP32 image encoder even with `--precision fp16`. The current real test found finite but incorrect FP16 conditioning and box-like meshes; merely promoting attention or VAE precision did not fix it. This adapter is selected before loading, never as an error-triggered retry. `imageEncoderPrecision` reports the actual encoder precision; `precision` describes sampling/decoding. Standard Turbo and 2.1 retain the selected precision.

Mini correctness/performance remains an open issue: the FP32 encoder is a workaround, and the estimated 15.94 GiB residency threshold is neither an official minimum nor proof that a 24 GiB Mac cannot keep Mini resident. Root-cause isolation, an upstream comparison and measured residency calibration are required before closing it. See the [Mini investigation and acceptance criteria](../../docs/design/mini-inference-investigation.md). CUDA has not yet been hardware-validated for this change.
