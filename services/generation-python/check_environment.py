"""Read-only runtime validation; never installs packages or accesses the network."""
import argparse
import importlib
import importlib.metadata
import json
from pathlib import Path
import sys


def check(requirements, variant):
    issues = []
    if sys.version_info[:2] != (3, 12):
        issues.append({"package": "python", "reason": "Python 3.12 is required"})
    pins = {}
    for line in Path(requirements).read_text().splitlines():
        if "==" in line and not line.startswith("#"):
            name, version = line.strip().split("==")
            pins[name] = version
    if variant != "base":
        pins.update(torch="2.6.0", torchvision="0.21.0")
    for name, expected in pins.items():
        try:
            actual = importlib.metadata.version(name).split("+")[0]
            if actual != expected:
                issues.append({"package": name, "reason": f"expected {expected}, found {actual}"})
        except importlib.metadata.PackageNotFoundError:
            issues.append({"package": name, "reason": "missing"})
    modules = {"aiohttp": "aiohttp", "pillow": "PIL.Image", "numpy": "numpy", "trimesh": "trimesh", "fast-simplification": "fast_simplification"}
    if variant != "base":
        modules.update({"torch": "torch", "torchvision": "torchvision", "transformers": "transformers", "diffusers": "diffusers", "safetensors": "safetensors", "scipy": "scipy", "scikit-image": "skimage", "numba": "numba", "opencv-python-headless": "cv2", "timm": "timm", "omegaconf": "omegaconf"})
    for name, module in modules.items():
        try:
            loaded = importlib.import_module(module)
            if name == "torch":
                loaded.ones(1).sum().item()
                cuda = loaded.version.cuda
                hip = getattr(loaded.version, "hip", None)
                if hip or (variant == "cu124" and cuda != "12.4") or (variant in ("cpu", "mps") and cuda is not None):
                    raise RuntimeError(f"wrong PyTorch runtime: CUDA={cuda}")
                if variant == "mps" and not loaded.backends.mps.is_built():
                    raise RuntimeError("This PyTorch distribution does not include MPS")
        except Exception as error:
            issues.append({"package": name, "reason": str(error)})
    return {"ok": not issues, "issues": issues, "base": sys.base_prefix, "prefix": sys.prefix}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("requirements")
    parser.add_argument("variant", choices=["cpu", "cu124", "mps", "base"])
    args = parser.parse_args()
    print(json.dumps(check(args.requirements, args.variant)))
