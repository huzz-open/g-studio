# Local runtime storage — retain when cleaning the project

`generation/` contains reusable model weights, upstream source, and platform-specific
Node, uv, Python and installed packages. It is deliberately excluded from Git.
Keep this directory: deleting required files causes the next normal start to
download them again. `sh start-generation.sh` validates and reuses complete resources.

`generation-data/` contains this machine's private credentials and temporary jobs.
Do not share it. Use the current project's `sh start-generation.sh --cpu` with
the configured mirrors. `archives/` preserves
retired local experiments; it is not used by the production service.
`verification/` holds temporary files used for runtime checks; it
is not needed at runtime and may be removed when those checks are no longer needed.

These folders are independent of build output (`dist/`) and frontend `node_modules/`.
Profiles currently include Windows CPU, Windows NVIDIA CUDA 12.4, and Apple
Silicon MPS/CPU. Intel/AMD GPU acceleration is not enabled. Apple M5
(24 GB, macOS 26.5.2) passed offline startup and API generation in
84.5 seconds (5 steps, resolution 256), with MPS and a visually checked vase.
Other Macs remain untested. Apple Silicon uses one environment for MPS and CPU.
Keep complete resources to use `sh start-generation.sh --offline --cpu`.
Do not include `runtime/` in routine build-clean commands. See
[generation deployment](../services/generation-python/README.md) for preparation,
supported platforms and offline checks.
