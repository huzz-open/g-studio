"""Pinned downloads, resumable staging, checksum verification and a process lock."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import time
import urllib.request
from urllib.parse import urlparse
from config import HOME

MANIFEST = json.loads(
    Path(__file__).with_name("model-manifest.json").read_text("utf-8")
)


def preferred_source():
    source = os.environ.get("GEN_MODEL_SOURCE")
    if source is None:
        profile = Path(__file__).resolve().parents[2] / ".generation-mirrors.local.json"
        if profile.exists():
            value = json.loads(profile.read_text("utf-8"))
            if value.get("version") != 1 or value.get("profile") not in (
                "cn",
                "default",
            ):
                raise RuntimeError("Invalid project mirror profile")
            source = "modelscope" if value["profile"] == "cn" else "huggingface"
        else:
            source = "huggingface"
    if source not in ("modelscope", "huggingface"):
        raise RuntimeError("GEN_MODEL_SOURCE must be modelscope or huggingface")
    return source


def ordered_urls(item):
    host = "modelscope.cn" if preferred_source() == "modelscope" else "huggingface.co"
    return sorted(
        item["urls"], key=lambda url: 0 if urlparse(url).hostname == host else 1
    )


def valid(path, item):
    if not path.exists() or path.stat().st_size != item["size"]:
        return False
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest() == item["sha256"]


def download(item):
    dest = HOME / item["path"]
    dest.parent.mkdir(parents=True, exist_ok=True)
    if valid(dest, item):
        return
    bundled = Path(__file__).with_name("bundled") / item["path"]
    if valid(bundled, item):
        staging = dest.with_suffix(dest.suffix + ".bundled")
        shutil.copyfile(bundled, staging)
        staging.replace(dest)
        print(
            "[generation] Bundled configuration/license verified: " + item["path"],
            flush=True,
        )
        return
    import_source = os.environ.get("GEN_IMPORT_CACHE")
    if import_source:
        existing = Path(import_source).resolve() / item["path"]
        if valid(existing, item):
            shutil.copyfile(existing, dest)
            print("[generation] Imported verified cache: " + item["path"], flush=True)
            return
    part = dest.with_suffix(dest.suffix + ".part")
    print(
        "[generation] download "
        + item["path"]
        + f" ({item['size'] / 1024**2:.1f} MiB)",
        flush=True,
    )
    error = None
    for url in ordered_urls(item) * 2:
        try:
            print(
                "[generation] Source: "
                + str(urlparse(url).hostname)
                + " / "
                + item["path"],
                flush=True,
            )
            offset = part.stat().st_size if part.exists() else 0
            if offset >= item["size"]:
                part.unlink()
                offset = 0
            headers = {"User-Agent": "G-Studio-Generation/1"}
            if offset:
                headers["Range"] = f"bytes={offset}-"
            with urllib.request.urlopen(
                urllib.request.Request(url, headers=headers), timeout=30
            ) as response:
                append = offset > 0 and response.status == 206
                if append and not response.headers.get("Content-Range", "").startswith(
                    f"bytes {offset}-"
                ):
                    raise ValueError("Invalid range response")
                count = offset if append else 0
                last = time.monotonic()
                with part.open("ab" if append else "wb") as out:
                    while chunk := response.read(1024 * 1024):
                        count += len(chunk)
                        if count > item["size"]:
                            raise ValueError("Download exceeds manifest size")
                        out.write(chunk)
                        if time.monotonic() - last > 5:
                            print(
                                f"[generation] {dest.name}: {count}/{item['size']} bytes",
                                flush=True,
                            )
                            last = time.monotonic()
            if not valid(part, item):
                part.unlink(missing_ok=True)
                raise ValueError("SHA256/size verification failed")
            part.replace(dest)
            return
        except Exception as e:
            error = e
            print("[generation] download retry: " + str(e), flush=True)
    raise RuntimeError(f"Download failed: {item['path']}: {error}")


def main():
    # OS-owned locks are released after a crash; a leftover file is harmless.
    lock = (HOME / "download.lock").open("a+b")
    if lock.tell() == 0:
        lock.write(b"0")
        lock.flush()
    acquired = False
    for _ in range(120):
        try:
            lock.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            acquired = True
            break
        except OSError:
            time.sleep(1)
    if not acquired:
        lock.close()
        raise RuntimeError("Another download is running; retry later")
    try:
        missing = sum(
            i["size"] for i in MANIFEST["files"] if not (HOME / i["path"]).exists()
        )
        if shutil.disk_usage(HOME).free < missing + 512 * 1024**2:
            raise RuntimeError("Insufficient disk space for model preparation")
        for item in MANIFEST["files"]:
            download(item)
        print("[generation] model source and weights verified", flush=True)
    finally:
        lock.close()


if __name__ == "__main__":
    main()
