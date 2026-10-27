# Local runtime storage — retain when cleaning the project

`generation/` contains reusable model weights, upstream source, and platform-specific
Node, uv, Python and installed packages. It is deliberately excluded from Git.
Keep this directory: deleting required files causes the next normal start to
download them again. `sh start-generation.sh` validates and reuses complete resources.

`generation-data/` contains this machine's private credentials and temporary jobs.
Do not share it. `bundles/` contains distributable archives. `archives/` preserves
retired local experiments; it is not used by the production service.
`verification/` holds temporary extracted copies used for relocation checks; it
is not needed at runtime and may be removed when those checks are no longer needed.

These folders are independent of build output (`dist/`) and frontend `node_modules/`.
Profiles currently include Windows CPU, Windows NVIDIA CUDA 12.4, and Apple
Silicon MPS/CPU. Intel/AMD GPU acceleration is not enabled. Cross-assembled Mac
packages retain their static build validation marker. The complete package was
subsequently started on Apple M5 (24 GB, macOS 26.5.2): API generation passed in
84.5 seconds (5 steps, resolution 256), with MPS and a visually checked vase.
Other Macs remain untested. Windows CUDA packages also run on CPU;
Apple Silicon packages share one environment for MPS and CPU. Keep the optional
smaller Windows CPU package when download size matters.
Do not include `runtime/` in routine build-clean commands. See
[generation deployment](../services/generation-python/README.md) for preparation,
packing, supported platforms and offline checks.
