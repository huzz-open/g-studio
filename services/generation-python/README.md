# Generation backend deployment

Run commands from the repository root or an extracted backend package. For browser operations see the [model generation guide](../../docs/guides/model-generation.md) (Chinese); for code changes see the [development guide](../../CONTRIBUTING.md).

## Start

```sh
sh start-generation.sh
```

Use Git Bash on Windows, a terminal on macOS/Linux. WSL uses Linux resources. The launcher uses bundled Node, then a compatible installed Node, or downloads a verified runtime.

First launch prepares Python 3.12, dependencies, pinned inference source and about **4.23GB of model weights**. Complete compatible resources are reused; missing or incompatible resources are repaired. Ctrl+C stops the processes launched by this command.

| Task | Command |
| --- | --- |
| Web app and backend, after `npm install` | `npm run dev` |
| Web app only | `npm run dev:web` |
| Backend only | `sh start-generation.sh` |
| Prepare CPU resources without serving | `sh start-generation.sh prepare --cpu` |
| Prepare NVIDIA CUDA resources (also works on a CPU build host) | `sh start-generation.sh prepare --cuda` |
| Prepare Apple Silicon MPS/CPU resources on a Mac | `sh start-generation.sh prepare --mps` |
| Check environment and connectivity | `sh start-generation.sh doctor --cpu` |
| Lightweight algorithm backend, no model | `sh start-generation.sh --base` |

The backend launcher does not install frontend npm dependencies. Development Vite supplies the local direct token to the browser; production builds do not embed it. Starting the backend does not upload an image or select AI automatically.

## Download sources

Before `npm install`, optionally run:

```sh
npm run setup:cn
```

This project-local preset configures npm to use npmmirror, ordinary Python packages to use Tsinghua, and model weights to prefer ModelScope. It persists across terminals and does not modify global configuration. Run `npm run setup:default` to restore the previous project npm settings and remove the preset; cached models remain.

uv always tries Tsinghua's mirror of the official PyPI prebuilt wheel first, then the official GitHub release. Version, filenames, sizes and SHA256 values are pinned in `scripts/generation/uv-wheels.json`; extracting the native executable does not require Python. A valid cached uv remains first choice. Python, PyTorch and upstream source retain their configured official sources. GitHub-based npm dependencies are unaffected by npm registry settings.

Model versions, file URLs, resume and SHA256 verification are built in; no user-selected hashes, ModelScope SDK or token are needed for these public weights. Verified configurations and notices ship in [bundled/](./bundled/README.md). Switching download mirrors does not substitute ModelScope's differing model configuration.

## Resources and private data

| Directory | Contents | Cleanup / sharing |
| --- | --- | --- |
| `runtime/generation/` | Shared models/source, platform runtimes and download caches | Keep during routine cleanup; excluded from Git |
| `runtime/generation-data/` | Device credentials and temporary jobs | Private; do not distribute |
| `runtime/bundles/` | Portable archives | Distributable; excluded from Git |
| `runtime/archives/` | Retired local experiments | Historical only; not a runtime dependency |

Within the resource root, `models/` and `vendor/` are shared. Node, uv and Python live under `platforms/<os>-<arch>/`; Python variants are `base`, `cpu`, `cu124` and `mps`. Python is a self-contained interpreter tree, not a venv tied to a user's original path. Intel XPU and AMD ROCm are not advertised as supported variants.

If `GEN_HOME` is set without `GEN_DATA_HOME`, private data also uses the custom resource root for compatibility. Set both explicitly when separating a migrated installation. See [runtime directory notes](../../runtime/README.md).

Use `GEN_IMPORT_CACHE` for an existing directory containing matching `models/` and `vendor/`. Imports are verified; legacy credentials are not imported. Model hashing may take time even when no download is needed.

## Portable packages

Three archives are prepared under local `runtime/bundles/`: Windows `win32-x64-cu124` (NVIDIA + CPU, about 9.68 GB), optional smaller `win32-x64-cpu` (about 6.18 GB), and Mac `darwin-arm64-mps` (MPS + CPU, about 5.29 GB). Full filenames follow `g-studio-generation-<platform>-<variant>.zip`. These are backend packages; connect the separately hosted web app. They are not Git-hosted downloads.

For distribution, one CUDA archive covers both compatible NVIDIA and CPU execution on Windows; one MPS archive covers MPS and CPU on Apple Silicon. Recipients do not need both Windows packages. Platform binaries remain separate; builds reuse the same model weights and upstream inference source from the resource root. The standalone CPU archive is retained to reduce download size on CPU-only machines.

On the target platform:

```sh
sh start-generation.sh pack --cpu
sh start-generation.sh pack --cuda
# Run on an Apple Silicon Mac:
sh start-generation.sh pack --mps
```

The launcher prepares resources and writes `runtime/bundles/g-studio-generation-<platform>-<variant>.zip`. CUDA preparation does not require a GPU on the build host: all CUDA Python dependencies can be assembled and imported there, but real CUDA inference requires compatible NVIDIA hardware and drivers. The package contains backend code, Node, Python, dependencies, model files, source and notices; credentials, jobs, download caches and other platforms are excluded.

`sh start-generation.sh pack-mac` can also assemble a Mac ARM64 package from official prebuilt distributions on another OS. It checks dependency versions, wheel platform tags and ARM64 Mach-O executables; it cannot execute Mac code on Windows. Such a package is explicitly marked `cross-platform-static` in `bundle.json`. A Mac startup and real MPS generation check remain required before claiming hardware validation.

Recipients extract it and run:

```sh
sh start-generation.sh
```

Add `--offline` to prohibit setup downloads: `sh start-generation.sh --offline`. Use Git Bash on Windows and Terminal on Mac; the archive includes Node and Python, not a Windows shell. Windows CPU relocation and real HTTP inference have passed; the CUDA runtime is checked but GPU inference remains unverified. The complete Mac package passed offline startup, API generation and visual inspection on Apple M5 (24 GB, macOS 26.5.2).

A complete compatible package selects its packaged CPU/CUDA/MPS profile and requires no preinstalled Python, Node or uv and no setup downloads. Explicit `--cpu`, `--cuda` or `--mps` overrides that preference. Missing resources still trigger normal repair. For an explicit offline completeness check:

On Mac ARM64, CPU and MPS share the same `python-mps` distribution. In a packaged NVIDIA bundle, CPU can also use the included CUDA distribution. In both cases, `--cpu` changes the execution preference without downloading another environment. Packages record this preference separately from the dependency variant.

```sh
GEN_OFFLINE=1 sh start-generation.sh prepare
```

- Build separate packages for each OS/architecture. Shared model weights do not make binary dependencies portable across platforms.
- ZIP64 archives exceed 4GB; avoid FAT32. On Windows use a short extraction path such as `E:\GStudio` to avoid older extractors' path-length limits. Spaces are supported.
- Do not extract a package inside another copy's `runtime/`.
- OS libraries and NVIDIA drivers remain host requirements.

## GPU and platform support

On Windows, automatic preparation selects CUDA only when NVIDIA hardware is detected; Intel/AMD GPUs use the CPU profile. Runtime probing distinguishes CUDA from HIP/ROCm, even though both expose `torch.cuda`, and never advertises ROCm/XPU as supported. On Apple Silicon, automatic preparation selects the standard Mac ARM64 PyTorch distribution and prefers MPS after a real device operation check. CPU remains available in the same distribution.

Force CPU with `--cpu`; use `--cuda` or `--mps` to prepare a specific environment. `GEN_DEVICE` accepts `auto`, `cpu`, `cuda`, `mps`; explicit `xpu`/`rocm` requests currently fall back to CPU with an explanation. A recoverable CUDA/MPS task failure retries once on CPU using the same original upload. API device info includes `backend` and a diagnostic `reason`, and the UI identifies NVIDIA CUDA or Apple MPS when actually selected.

| Platform / device | Implemented behavior | Verification boundary |
| --- | --- | --- |
| Windows x64 CPU | Full local inference and portable package | Real inference and relocation tested |
| Windows x64 NVIDIA | PyTorch 2.6.0 + CUDA 12.4, FP16; device failure falls back to CPU | Runtime package can be built on CPU; NVIDIA GPU inference needs compatible-device validation. Not every new/old NVIDIA architecture is guaranteed by this pinned build |
| Apple Silicon, target macOS 14+ | ARM64 PyTorch 2.6.0, MPS preferred, FP32 and CPU noise generator; unsupported MPS operations/OOM can retry the complete task on CPU | Full offline package startup, API generation and vase geometry inspection passed on Apple M5 (24 GB, macOS 26.5.2); other Macs remain unvalidated |
| Windows Intel/AMD GPUs | Production uses CPU; no integrated-GPU package | Experimental UHD 630 DirectML required adaptations and took 868 s versus 228 s CPU; Radeon 780M model inference failed. This does not establish that all Intel/AMD hardware is incapable |
| Intel macOS | Lightweight `--base` only | Pinned full-model PyTorch does not support macOS x64 |
| Linux x64/ARM64 | Preparation paths retained | Not validated on Linux hardware here |

NVIDIA GeForce MX150 (2 GB) is not supported for GPU inference with the current model. Use `--cpu`.

Weights are fixed data, while the runtime executes operators. CUDA, MPS and CPU have different kernels, supported dtypes, random generators and memory limits. The adapter does not retrain or modify weights; it chooses compatible execution behavior. The current service generates geometry only, not the upstream CUDA texture-rendering extensions.

Measured environments and results belong to the dated [validation record](../../docs/history/model-generation-validation.md). CPU generation can take several minutes.

The complete API vase task on Apple M5 took 84.5 s for generation (86.5 s including submission/polling), using 5 steps and resolution 256 without CPU fallback. Keep those defaults for quality checks: reducing only the steps to 1 produced severely distorted geometry and took about 202 s. The earlier 99 s minimal test established execution only, not acceptable geometry. Ordinary Windows integrated GPUs are not recommended for this backend: a desktop CPU may be faster, and driver/operator compatibility can prevent completion. These are specific workload observations, not a controlled cross-platform ranking. GPU speed-based automatic selection has not been implemented.

## Configuration

All variables are optional for the default local workflow.

| Variable | Purpose |
| --- | --- |
| `GEN_HOME` | Override the resource root (default project `runtime/generation`) |
| `GEN_DATA_HOME` | Override private credentials/job storage |
| `GEN_OFFLINE` | `1` forbids setup downloads; incomplete resources produce a clear error |
| `GEN_PORT` | Loopback HTTP port, default 8765 |
| `GEN_WEB_PORT` | Default development launcher web port, default 5173 |
| `GEN_ORIGINS` | Comma-separated exact allowed browser origins; default localhost/127.0.0.1 on 5173 |
| `GEN_DEVICE` | `auto`, `cpu`, `cuda`, or `mps`; unsupported XPU/ROCm requests fall back to CPU |
| `GEN_PYTHON` | Use an explicitly managed Python executable; dependencies must already be installed |
| `GEN_IMPORT_CACHE` | Import matching source/model files from an existing cache, with SHA256 verification |
| `GEN_MODEL_SOURCE` | Optional explicit source priority: `modelscope` or `huggingface`; normally set automatically by the project preset |
| `GEN_SKIP_MODEL` | `1` prepares only the lightweight algorithm provider; no Hunyuan download |
| `GEN_RELAY_URL` | Outbound `wss://.../generation/worker` endpoint |
| `GEN_PAIR` | `1` enables a new five-minute pairing session at this launch |
| `GEN_PAIR_CODE` | Optional eight-character alphanumeric code for that pairing session; never a permanent password |

PowerShell example: `$env:GEN_HOME = 'D:\GStudioCache'`. POSIX example: `export GEN_HOME="$HOME/GStudioCache"`. Python also reads `relayUrl` from its private `config.json`.

The service permits one active and eight queued tasks. Image and result limits are exposed by the [capabilities API](../../packages/generation-protocol/README.md); clients may impose tighter import limits.

## Public websites

For direct local access, allow the exact public site origin in `GEN_ORIGINS`, configure `http://127.0.0.1:8765` and the direct token from private `config.json` in the website, and grant browser local-network permission if requested. If that browser cannot connect, use a relay.

For relay mode, deploy the [relay service](../generation-relay/README.md), then run:

```sh
sh start-generation.sh --relay wss://your-domain.example/generation/worker --pair
```

Complete the [browser pairing steps](../../docs/guides/model-generation.md#通过公网中转). Subsequent launches can omit `--pair`; retain the same private credential directory (`GEN_DATA_HOME`, or custom `GEN_HOME` when it also holds data) and relay URL.

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
