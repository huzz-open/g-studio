# Pinned model configuration and notices

Provenance reference. Setup instructions are maintained in [backend deployment](../README.md#download-sources).

## Pinned upstream files

These four small files are copied without modification from `tencent/Hunyuan3D-2mini` at Hugging Face revision `f90a0f7df7d5e6f71109cf333f6a95a0ae3194a6`. Their sizes and SHA256 values are recorded in `../model-manifest.json`; the downloader verifies them before copying them to the runtime cache. Upstream LICENSE and NOTICE remain alongside the configurations.

## Compatible mirror weights

The matching Tencent ModelScope repository is [Tencent-Hunyuan/Hunyuan3D-2mini](https://modelscope.cn/models/Tencent-Hunyuan/Hunyuan3D-2mini), revision `0d1901d5f6300a268615cff3aff885c4fd494ff5`. Both mini-Turbo and Turbo-VAE safetensors have the same recorded size and SHA256 as the pinned Hugging Face files. Range requests to both ModelScope weight URLs returned HTTP 206 and the expected total byte lengths during the original verification; this records that check, not current source availability.

## Configuration differences

The main ModelScope configuration at that revision differs: its image encoder uses 518 instead of 1022, its image preprocessor uses 512 instead of 1022, and its main VAE declaration uses 512 instead of 3072 latent tokens. G-Studio already loads the separate Turbo VAE with 512 tokens; changing the main image configuration would still alter tested preprocessing. The known-mismatching ModelScope main-config URL is therefore excluded from fallback, rather than accepting a different digest or silently changing inference settings.

## Notices

ModelScope's LICENSE and NOTICE bytes also differ at that revision. The preset keeps the original pinned notices shipped here. Selecting the China preset only changes the preferred source of compatible downloads; it does not select different weights, relax verification, or change model configuration.
