# Pinned model configuration and notices

Provenance reference. Setup instructions are maintained in [backend deployment](../deployment.md#download-sources).

## Model manifests

The downloader selects a manifest for each enabled model. Configurations and upstream notices are bundled; large weights are downloaded separately and verified against the same manifest.

| Model | Pinned revision | Manifest |
| --- | --- | --- |
| Mini Turbo | `f90a0f7df7d5e6f71109cf333f6a95a0ae3194a6` | [model-manifest.json](../model-manifest.json) |
| Standard Turbo | `9cd649ba6913f7a852e3286bad86bfa9a2d83dcf` | [model-manifest-turbo.json](../model-manifest-turbo.json) |
| Full 2.1 Shape | `0b94677654c57bb9a6b6845cd7b704ccf551d327` | [model-manifest-2.1.json](../model-manifest-2.1.json) |

Mini is enabled by default; Turbo and 2.1 are integrated and enabled through `--models`. Source code is distributed separately in [2.0 and 2.1 source wheels](wheels/README.md).

## Compatible Mini mirror weights

The matching Tencent ModelScope repository is [Tencent-Hunyuan/Hunyuan3D-2mini](https://modelscope.cn/models/Tencent-Hunyuan/Hunyuan3D-2mini), revision `0d1901d5f6300a268615cff3aff885c4fd494ff5`. Both mini-Turbo and Turbo-VAE safetensors have the same recorded size and SHA256 as the pinned Hugging Face files. Range requests to both ModelScope weight URLs returned HTTP 206 and the expected total byte lengths during the original verification; this records that check, not current source availability.

## Configuration differences

The main ModelScope configuration at that revision differs: its image encoder uses 518 instead of 1022, its image preprocessor uses 512 instead of 1022, and its main VAE declaration uses 512 instead of 3072 latent tokens. G-Studio already loads the separate Turbo VAE with 512 tokens; changing the main image configuration would still alter tested preprocessing. The known-mismatching ModelScope main-config URL is therefore excluded from fallback, rather than accepting a different digest or silently changing inference settings.

## Notices

ModelScope's LICENSE and NOTICE bytes also differ at that revision. The preset keeps the original pinned notices shipped here. Selecting the China preset only changes the preferred source of compatible downloads; it does not select different weights, relax verification, or change model configuration.
