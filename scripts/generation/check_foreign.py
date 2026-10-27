"""Static dependency/tag checks for a Mac package assembled on another OS."""
import argparse
import importlib.metadata
import json
from pathlib import Path


def check(site, requirements):
    distributions = list(importlib.metadata.distributions(path=[str(site)]))
    normalize = lambda name: name.lower().replace("_", "-")
    versions = {normalize(d.metadata["Name"]): d.version for d in distributions}
    expected = dict(line.strip().split("==") for line in requirements.read_text().splitlines() if "==" in line and not line.startswith("#"))
    expected.update(torch="2.6.0", torchvision="0.21.0")
    errors = [f"{name}: expected {version}, found {versions.get(normalize(name))}" for name, version in expected.items() if versions.get(normalize(name), "").split("+")[0] != version]
    for distribution in distributions:
        wheel = distribution.read_text("WHEEL") or ""
        tags = [line[5:].strip() for line in wheel.splitlines() if line.startswith("Tag:")]
        if not tags or not any(tag.endswith("-any") or ("macosx" in tag and ("arm64" in tag or "universal2" in tag)) for tag in tags):
            errors.append(f"Wrong platform tag: {distribution.metadata['Name']} {tags}")
    return {"ok": not errors, "errors": errors, "packages": len(distributions), "validation": "static-only; requires macOS runtime/inference validation"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("site", type=Path)
    parser.add_argument("requirements", type=Path)
    args = parser.parse_args()
    report = check(args.site, args.requirements)
    print(json.dumps(report))
    raise SystemExit(0 if report["ok"] else 1)
