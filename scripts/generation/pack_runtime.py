"""Package an explicit allowlist; user credentials, jobs and caches never enter it."""
import argparse
import json
import os
from pathlib import Path
import zipfile


def package(project, home, platform, variant, output):
    platform_root = home / "platforms" / platform
    sources = [(project / "start-generation.sh", "start-generation.sh"),
               (project / "scripts/generation", "scripts/generation"),
               (project / "services/generation-python", "services/generation-python"),
               (project / "runtime/README.md", "runtime/README.md")]
    for name in ["node", f"python-{variant}"]:
        source = platform_root / name
        if not source.is_dir():
            raise RuntimeError(f"Missing required platform resource: {source}")
        sources.append((source, f"runtime/generation/platforms/{platform}/{name}"))
    if (platform_root / "tools").is_dir():
        sources.append((platform_root / "tools", f"runtime/generation/platforms/{platform}/tools"))
    if variant != "base":
        for name in ["models", "vendor"]:
            source = home / name
            if not source.is_dir():
                raise RuntimeError(f"Missing required model resource: {source}")
            sources.append((source, f"runtime/generation/{name}"))
    entries = []
    for source, target in sources:
        if not source.exists():
            raise RuntimeError(f"Missing package input: {source}")
        for path in sorted(source.rglob("*")) if source.is_dir() else [source]:
            if not path.is_file() or "__pycache__" in path.parts or ".git" in path.parts or path.suffix == ".pyc" or path.name == "environment.lock":
                continue
            name = str(Path(target) / path.relative_to(source)) if source.is_dir() else target
            entries.append((path, name.replace("\\", "/")))
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = output.with_suffix(output.suffix + ".part")
    with zipfile.ZipFile(staging, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
        for index, (path, name) in enumerate(entries, 1):
            archive.write(path, name)
            if index % 1000 == 0:
                print(f"[generation] Packed {index}/{len(entries)} files", flush=True)
        marker = platform_root / f"python-{variant}" / "environment.json"
        validation = json.loads(marker.read_text()).get("validation", "runtime-imports-checked") if marker.exists() else "unknown"
        defaults = {"cpu": "cpu", "base": "cpu", "cu124": "cuda", "mps": "mps"}
        preferred = os.environ.get("GEN_BUNDLE_DEVICE", defaults[variant])
        if preferred not in ("cpu", defaults[variant]): preferred = defaults[variant]
        archive.writestr("bundle.json", json.dumps({"format": "g-studio/generation-bundle", "version": 1, "platform": platform, "variant": variant, "preferredDevice": preferred, "files": len(entries), "validation": validation, "acceleratorInferenceTested": False}, indent=2))
        archive.writestr("START-HERE.txt", "Run: sh start-generation.sh\nWindows: Git Bash. macOS/Linux: terminal.\nWindows: extract into a short directory, e.g. E:\\GStudio, to avoid legacy ZIP path limits.\nRetain runtime/generation; it contains the reusable runtime and models.\nPrivate configuration is created on first start in runtime/generation-data.\nA compatible complete package uses its packaged CPU/CUDA/MPS variant and makes no setup downloads. Missing resources are repaired online.\nIntel/AMD GPU acceleration is not supported; those devices use CPU.\nMac ARM64 targets macOS 14+. Cross-platform-static validation does not certify Mac/MPS inference. NVIDIA CUDA also needs compatible hardware and drivers.\nSee services/generation-python/README.md for the support and validation matrix.\nUse GEN_OFFLINE=1 for a strict no-network setup check.\n")
        profile = project / ".generation-mirrors.local.json"
        if profile.exists():
            value = json.loads(profile.read_text())
            if value.get("version") == 1 and value.get("profile") in ("cn", "default"):
                archive.writestr(profile.name, json.dumps({"version": 1, "profile": value["profile"]}))
    staging.replace(output)
    return [name for _, name in entries]


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("project", type=Path)
    parser.add_argument("home", type=Path)
    parser.add_argument("platform", choices=["win32-x64", "darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"])
    parser.add_argument("variant", choices=["base", "cpu", "cu124", "mps"])
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    package(args.project.resolve(), args.home.resolve(), args.platform, args.variant, args.output.resolve())
