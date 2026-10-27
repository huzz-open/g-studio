"""Materialize the checked-in pure-Python source wheel into the private vendor dir.

This is deliberately not a general wheel installer: only our source-only wheel is
accepted, with no scripts, binary extensions or .data installation schemes.
"""
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import zipfile

BUNDLE = Path(__file__).with_name("bundled") / "wheels"


def prepare_source(home, bundle=BUNDLE):
    metadata = json.loads((bundle / "wheel.json").read_text("utf-8"))
    wheel = bundle / metadata["filename"]
    data = wheel.read_bytes()
    if len(data) != metadata["size"] or hashlib.sha256(data).hexdigest() != metadata["sha256"]:
        raise RuntimeError("Bundled Hunyuan source wheel failed SHA256/size verification")
    target = home / "vendor/Hunyuan3D-2"
    repaired = 0
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = []
        for entry in archive.infolist():
            name = PurePosixPath(entry.filename)
            if (name.is_absolute() or ".." in name.parts or "\\" in entry.filename
                    or ":" in entry.filename or not name.parts
                    or not (name.parts[0] == "hy3dgen" or name.parts[0].endswith(".dist-info"))):
                raise RuntimeError(f"Invalid bundled wheel member: {entry.filename}")
            if entry.is_dir():
                continue
            destination = target.joinpath(*name.parts)
            if not destination.resolve().is_relative_to(target.resolve()):
                raise RuntimeError("Source wheel destination escapes vendor directory")
            entries.append((destination, archive.read(entry)))
        for destination, content in entries:
            if destination.is_file() and destination.read_bytes() == content:
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            staging = destination.with_name(destination.name + ".wheel-part")
            staging.write_bytes(content)
            staging.replace(destination)
            repaired += 1
    print(f"[generation] Bundled Hunyuan source verified; {repaired} files installed/repaired (no network)", flush=True)
    return target
