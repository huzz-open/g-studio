"""Shape imports and staged, strictly checked weight loading for CPU, CUDA and MPS."""

import gc
import json
import os
from pathlib import Path
import sys
import types
import time
from compute import inference_dtype

ROOT = Path(os.environ.get("GEN_HOME", Path(__file__).resolve().parents[2] / "runtime/generation")).resolve()
SOURCE = ROOT / "vendor/Hunyuan3D-2"
MODEL = ROOT / "models/hunyuan3d-dit-v2-mini-turbo"
VAE = ROOT / "models/hunyuan3d-vae-v2-mini-turbo"
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HY3DGEN_DEBUG"] = "0"
os.environ["USE_SAGEATTN"] = "0"


def initialize():
    sys.path.insert(0, str(SOURCE))
    # Package __init__ eagerly imports optional MeshLab postprocessors. We do not
    # use these; import the official shape modules directly through their package.
    import hy3dgen

    package = types.ModuleType("hy3dgen.shapegen")
    package.__path__ = [str(SOURCE / "hy3dgen/shapegen")]
    package.__package__ = "hy3dgen.shapegen"
    sys.modules["hy3dgen.shapegen"] = package
    hy3dgen.shapegen = package
    import torch

    torch.set_num_threads(4)
    from hy3dgen.shapegen.pipelines import (
        Hunyuan3DDiTFlowMatchingPipeline,
        instantiate_from_config,
    )
    import yaml

    config = yaml.safe_load((MODEL / "config.yaml").read_text(encoding="utf-8"))
    return torch, Hunyuan3DDiTFlowMatchingPipeline, instantiate_from_config, config


def load_module(config, filename, prefix, instantiate):
    """Load one module at a time; no full float32 checkpoint copies in memory."""
    import torch
    from safetensors import safe_open

    started = time.perf_counter()
    module = instantiate(config).cpu().float().eval().requires_grad_(False)
    if prefix == "" and config["target"].endswith("ShapeVAE"):
        # Official turbo checkpoint contains only the inference decoder. The
        # upstream loader uses strict=False for its unused encoder/pre_kl keys.
        module.encoder = None
        module.pre_kl = None
        gc.collect()
    states = module.state_dict()
    with safe_open(str(filename), framework="pt", device="cpu") as checkpoint:
        source = {
            k[len(prefix) :]: k for k in checkpoint.keys() if k.startswith(prefix)
        }
        missing = set(states) - set(source)
        extra = set(source) - set(states)
        if missing or extra:
            raise RuntimeError(
                f"Checkpoint mismatch: missing={sorted(missing)[:8]}, extra={sorted(extra)[:8]}"
            )
        with torch.no_grad():
            for name, target in states.items():
                tensor = checkpoint.get_tensor(source[name])
                if target.shape != tensor.shape:
                    raise RuntimeError(f"Wrong shape: {name}")
                target.copy_(tensor)
                del tensor
    del states
    print(
        f"Loaded {prefix or 'vae'}: {sum(p.numel() for p in module.parameters()):,} parameters in {time.perf_counter() - started:.1f}s",
        flush=True,
    )
    device = os.environ.get("GEN_DEVICE", "cpu")
    return module.to(
        device=device, dtype=inference_dtype(torch, device)
    )


def write_stats(folder, phase, start, extra=None):
    import psutil

    memory = psutil.Process().memory_info()
    stats = {
        "phase": phase,
        "elapsed_seconds": time.perf_counter() - start,
        "rss_bytes": memory.rss,
        "peak_working_set_bytes": getattr(memory, "peak_wset", None),
        **(extra or {}),
    }
    (folder / f"{phase}-stats.json").write_text(
        json.dumps(stats, indent=2), encoding="utf-8"
    )
    print(json.dumps(stats), flush=True)
