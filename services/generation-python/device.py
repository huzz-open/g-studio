"""Probe actual runtime in an isolated process before advertising GPU."""

import json
import os
import subprocess


def probe():
    hardware = []
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,driver_version", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        hardware = result.stdout.strip().splitlines() if result.returncode == 0 else []
    except (OSError, subprocess.TimeoutExpired):
        pass
    if not hardware and os.name == "nt":
        try:
            r = subprocess.run(
                [
                    "powershell",
                    "-NoProfile",
                    "-Command",
                    "(Get-CimInstance Win32_VideoController).Name",
                ],
                capture_output=True,
                text=True,
                timeout=15,
            )
            hardware = r.stdout.strip().splitlines()
        except (OSError, subprocess.TimeoutExpired):
            pass
    reason = "No compatible CUDA device"
    selected = "cpu"
    if os.environ.get("GEN_DEVICE") == "cpu":
        reason = "CPU explicitly configured"
    else:
        try:
            import torch

            if torch.cuda.is_available():
                x = torch.ones(8, device="cuda")
                (x * x).sum().item()
                torch.cuda.synchronize()
                del x
                torch.cuda.empty_cache()
                selected = "gpu"
                reason = "CUDA device operation passed"
            elif hardware:
                reason = "CUDA unavailable in installed runtime; unsupported GPU or driver/runtime mismatch"
        except Exception as e:
            reason = f"GPU initialization failed: {type(e).__name__}: {e}"
    return {"deviceType": selected, "detected": hardware, "reason": reason}


if __name__ == "__main__":
    print(json.dumps(probe(), ensure_ascii=False))
