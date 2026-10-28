"""Build a reproducible pure-Python wheel from the pinned shape inference sources.

Uses only the standard library. Existing cache files must pass the source manifest;
otherwise the pinned upstream URL is fetched. No model weights enter the wheel.
"""
import argparse
import base64
import csv
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "services/generation-python/bundled/wheels"
NAME = "g_studio_hunyuan_shape"
VERSION = "2.0.2+f8db63096c82"
DIST = f"{NAME}-{VERSION}.dist-info"


def build(cache):
    manifest = json.loads((OUTPUT / "source-manifest.json").read_text())
    contents = {}
    for item in manifest["files"]:
        path = cache / item["path"]
        data = path.read_bytes() if path.exists() else b""
        if len(data) != item["size"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
            with urllib.request.urlopen(item["urls"][0], timeout=60) as response:
                data = response.read()
        if len(data) != item["size"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
            raise ValueError(f"Source verification failed: {item['path']}")
        name = item["path"].removeprefix(manifest.get("prefix", "vendor/Hunyuan3D-2/"))
        if name in ("LICENSE", "NOTICE"):
            name = f"{DIST}/licenses/{name}"
        contents[name] = data
    contents[f"{DIST}/METADATA"] = (
        f"Metadata-Version: 2.4\nName: {NAME.replace('_', '-')}\nVersion: {VERSION}\n"
        "Summary: G-Studio vendored Hunyuan3D shape inference sources\n"
        "Requires-Python: >=3.10\nLicense-File: licenses/LICENSE\n"
        f"Project-URL: Source, {manifest['repository']}/tree/{manifest['revision']}\n\n"
        "Unmodified shape inference subset, not an official Tencent distribution.\n"
        "Runtime dependencies are managed by G-Studio requirements-model.lock.\n"
    ).encode()
    contents[f"{DIST}/WHEEL"] = b"Wheel-Version: 1.0\nGenerator: g-studio\nRoot-Is-Purelib: true\nTag: py3-none-any\n"
    contents[f"{DIST}/source-manifest.json"] = (json.dumps(manifest, indent=2) + "\n").encode()
    record = io.StringIO(newline="")
    writer = csv.writer(record, lineterminator="\n")
    for name, data in sorted(contents.items()):
        digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
        writer.writerow([name, f"sha256={digest}", len(data)])
    writer.writerow([f"{DIST}/RECORD", "", ""])
    contents[f"{DIST}/RECORD"] = record.getvalue().encode()
    wheel = OUTPUT / f"{NAME}-{VERSION}-py3-none-any.whl"
    with zipfile.ZipFile(wheel, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(contents.items()):
            info = zipfile.ZipInfo(name, date_time=(2025, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    metadata = {"filename": wheel.name, "size": wheel.stat().st_size,
                "sha256": hashlib.sha256(wheel.read_bytes()).hexdigest(),
                "revision": manifest["revision"]}
    (OUTPUT / "wheel.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=ROOT / "runtime/generation")
    parser.add_argument("--series", choices=["2.0", "2.1"], default="2.0")
    args = parser.parse_args()
    if args.series == "2.1":
        OUTPUT = OUTPUT.with_name("wheels-2.1")
        NAME = "g_studio_hunyuan21_shape"
        VERSION = "2.1.0+82920d643c0d"
        DIST = f"{NAME}-{VERSION}.dist-info"
    build(args.cache)
