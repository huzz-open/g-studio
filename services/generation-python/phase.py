"""Each inference phase has its own process so all large allocations are released."""

import argparse
import os
import json
from pathlib import Path
import time
import types

from runtime import ROOT, MODEL, VAE, initialize, load_module, write_stats


def main():
    p = argparse.ArgumentParser()
    p.add_argument("phase", choices=["encode", "sample", "mesh"])
    p.add_argument("folder", type=Path)
    p.add_argument("--steps", type=int, default=5)
    p.add_argument("--resolution", type=int, default=380)
    p.add_argument("--chunks", type=int, default=2048)
    p.add_argument("--seed", type=int, default=12345)
    a = p.parse_args()
    start = time.perf_counter()
    torch, Pipeline, instantiate, config = initialize()
    pipeline = Pipeline.__new__(Pipeline)
    device = os.environ.get("GEN_DEVICE", "cpu")
    pipeline.device = torch.device(device)
    pipeline.dtype = torch.float16 if device == "cuda" else torch.float32
    pipeline.kwargs = {}
    pipeline.image_processor = instantiate(config["image_processor"])
    checkpoint = MODEL / "model.fp16.safetensors"
    with torch.inference_mode():
        if a.phase == "encode":
            from PIL import Image
            import numpy as np

            image = Image.open(a.folder / "original.png").convert("RGBA")
            prepared = pipeline.prepare_image(image)
            actual = prepared["image"][0].permute(1, 2, 0).cpu().float().numpy()
            Image.fromarray(np.clip((actual + 1) * 127.5, 0, 255).astype("uint8")).save(
                a.folder / "input.png"
            )
            pipeline.conditioner = load_module(
                config["conditioner"], checkpoint, "conditioner.", instantiate
            )
            attention = pipeline.conditioner.main_image_encoder.model.encoder.layer[
                0
            ].attention
            print(
                f"Image attention implementation: {type(attention).__name__}",
                flush=True,
            )
            for index, block in enumerate(
                pipeline.conditioner.main_image_encoder.model.encoder.layer
            ):
                if (index + 1) % 10 == 0:
                    block.register_forward_hook(
                        lambda _m, _i, _o, index=index: print(
                            f"Image encoder block {index + 1}/40", flush=True
                        )
                    )
            cond = pipeline.encode_cond(
                prepared["image"],
                {k: v for k, v in prepared.items() if k != "image"},
                False,
                False,
            )
            torch.save(
                {"condition": cond, "prepared": prepared}, a.folder / "condition.pt"
            )
            write_stats(
                a.folder, "encode", start, {"input_size": list(prepared["image"].shape)}
            )
        elif a.phase == "sample":
            cache = torch.load(
                a.folder / "condition.pt", map_location=device, weights_only=True
            )
            pipeline.model = load_module(
                config["model"], checkpoint, "model.", instantiate
            )
            pipeline.scheduler = instantiate(config["scheduler"])
            # Turbo VAE uses 512 latent tokens, as in upstream enable_flashvdm().
            import yaml

            vae_config = yaml.safe_load(
                (VAE / "config.yaml").read_text(encoding="utf-8")
            )
            pipeline.vae = types.SimpleNamespace(
                latent_shape=(
                    vae_config["params"]["num_latents"],
                    vae_config["params"]["embed_dim"],
                )
            )
            pipeline.prepare_image = lambda _: dict(cache["prepared"])
            pipeline.encode_cond = lambda **_: cache["condition"]

            def progress(step, t, output):
                print(f"Diffusion step {step + 1}/{a.steps}", flush=True)

            latents = pipeline(
                image=None,
                num_inference_steps=a.steps,
                guidance_scale=5.0,
                generator=torch.Generator(device=device).manual_seed(a.seed),
                output_type="latent",
                callback=progress,
                callback_steps=1,
                enable_pbar=False,
            )
            torch.save(latents, a.folder / "latents.pt")
            write_stats(
                a.folder,
                "sample",
                start,
                {
                    "steps": a.steps,
                    "seed": a.seed,
                    "latent_shape": list(latents.shape),
                    "guidance_scale": 5.0,
                },
            )
        else:
            import yaml

            vae_config = yaml.safe_load(
                (VAE / "config.yaml").read_text(encoding="utf-8")
            )
            pipeline.vae = load_module(
                vae_config, VAE / "model.fp16.safetensors", "", instantiate
            )
            pipeline.vae.enable_flashvdm_decoder(
                enabled=True,
                adaptive_kv_selection=True,
                topk_mode="merge",
                mc_algo="mc",
            )
            latents = torch.load(
                a.folder / "latents.pt", map_location=device, weights_only=True
            )
            outputs = pipeline._export(
                latents,
                output_type="trimesh",
                octree_resolution=a.resolution,
                num_chunks=a.chunks,
                mc_algo="mc",
                enable_pbar=True,
            )
            mesh = outputs[0]
            if mesh is None or not len(mesh.faces):
                raise RuntimeError("No valid surface extracted")
            mesh.export(a.folder / "raw.glb")
            write_stats(
                a.folder,
                "mesh",
                start,
                {
                    "resolution": a.resolution,
                    "faces": len(mesh.faces),
                    "vertices": len(mesh.vertices),
                    "bounds": mesh.bounds.tolist(),
                },
            )


if __name__ == "__main__":
    main()
