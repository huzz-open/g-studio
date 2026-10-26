"""Pinned downloads, resumable staging, checksum verification and a process lock."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import time
import urllib.request
from config import HOME

MANIFEST = json.loads(
    Path(__file__).with_name("model-manifest.json").read_text("utf-8")
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
    for url in item["urls"] * 2:
        try:
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
