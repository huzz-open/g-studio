"""Validate supported compute backends. Intel XPU and AMD ROCm deliberately use CPU."""
import json
import os
import platform
import subprocess


def probe():
    hardware = []
    try:
        result = subprocess.run(["nvidia-smi", "--query-gpu=name,driver_version", "--format=csv,noheader"], capture_output=True, text=True, timeout=10)
        hardware = result.stdout.strip().splitlines() if result.returncode == 0 else []
    except (OSError, subprocess.TimeoutExpired):
        pass
    if not hardware and os.name == "nt":
        try:
            result = subprocess.run(["powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_VideoController).Name"], capture_output=True, text=True, timeout=15)
            hardware = result.stdout.strip().splitlines() if result.returncode == 0 else []
        except (OSError, subprocess.TimeoutExpired):
            pass
    requested = os.environ.get("GEN_DEVICE") or "auto"
    if requested not in ("auto", "cpu", "cuda", "mps"):
        raise RuntimeError("Unsupported requested device: " + requested)
    result = {"deviceType": "cpu", "backend": "cpu", "detected": hardware, "reason": "No supported NVIDIA CUDA or Apple MPS device; Intel/AMD GPUs use CPU"}
    if requested == "cpu":
        result["reason"] = os.environ.get("GEN_DEVICE_REASON") or "CPU explicitly configured"
        return result
    try:
        import torch
        # ROCm intentionally exposes torch.cuda too. Do not advertise it as CUDA.
        if getattr(torch.version, "hip", None):
            result["reason"] = "AMD ROCm GPU inference is not supported; using CPU"
            if requested != "auto": raise RuntimeError(result["reason"])
            return result
        apple = platform.system() == "Darwin" and platform.machine().lower() in ("arm64", "aarch64")
        names = " ".join(hardware).lower()
        if not apple and "nvidia" not in names and any(vendor in names for vendor in ("intel", "amd", "radeon")):
            result["reason"] = "Intel/AMD GPU inference is not supported; using CPU"
            if requested != "auto": raise RuntimeError(result["reason"])
            return result
        backend = None
        if requested in ("auto", "mps") and apple and torch.backends.mps.is_available():
            backend = "mps"
        elif requested in ("auto", "cuda") and not apple and torch.version.cuda and torch.cuda.is_available():
            backend = "cuda"
        if backend:
            x = torch.ones(8, device=backend)
            (x * x).sum().item()
            device_module = getattr(torch, backend)
            device_module.synchronize()
            del x
            device_module.empty_cache()
            if not hardware:
                hardware.append("Apple Silicon GPU (MPS)" if backend == "mps" else "NVIDIA CUDA GPU")
            result.update(deviceType="gpu", backend=backend, reason=f"{backend.upper()} device operation passed")
        elif requested in ("cuda", "mps"):
            result["reason"] = f"Requested {requested.upper()} is unavailable"
    except Exception as error:
        if requested != "auto":
            raise RuntimeError(f"Requested {requested.upper()} initialization failed: {error}") from error
        result["reason"] = f"GPU initialization failed: {type(error).__name__}: {error}; using CPU"
    if requested in ("cuda", "mps") and result["backend"] != requested:
        raise RuntimeError(f"Requested {requested.upper()} unavailable: {result['reason']}")
    return result


if __name__ == "__main__":
    print(json.dumps(probe(), ensure_ascii=False))
