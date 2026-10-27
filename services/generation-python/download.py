"""Pinned downloads, resumable staging, checksum verification and a process lock."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import threading
import time
import urllib.request
from urllib.parse import urlparse
from config import HOME

MANIFEST = json.loads(
    Path(__file__).with_name("model-manifest.json").read_text("utf-8")
)
PROGRESS_INTERVAL = 5


class Progress:
    """A heartbeat independent of blocking network reads, hashing or file copies."""

    def __init__(self, label, total=None, initial=0):
        self.label, self.total = label, total
        self.initial = self.count = initial
        self.result = "complete"
        self.started = self.updated = time.monotonic()
        self.stopped = threading.Event()

    def report(self, status="running"):
        now = time.monotonic()
        elapsed = max(now - self.started, 0.001)
        detail = f"elapsed {elapsed:.0f}s"
        if self.total is not None:
            rate = (self.count - self.initial) / elapsed
            percent = self.count / self.total * 100 if self.total else 100
            eta = f"{(self.total - self.count) / rate:.0f}s" if rate > 0 else "--"
            detail = (
                f"{percent:.1f}% | {self.count / 1024**2:.2f}/{self.total / 1024**2:.2f} MiB"
                f" | {rate / 1024**2:.2f} MiB/s | ETA {eta} | {detail}"
            )
            if status == "running" and now - self.updated >= PROGRESS_INTERVAL:
                detail += f" | waiting for data, no progress for {now - self.updated:.0f}s"
        print(f"[generation] {self.label}: {status} | {detail}", flush=True)

    def advance(self, size):
        self.count += size
        self.updated = time.monotonic()

    def __enter__(self):
        self.report("starting")
        self.thread = threading.Thread(target=self._heartbeat, daemon=True)
        self.thread.start()
        return self

    def _heartbeat(self):
        while not self.stopped.wait(PROGRESS_INTERVAL):
            self.report()

    def __exit__(self, exc_type, exc, traceback):
        self.stopped.set()
        self.thread.join()
        self.report("failed" if exc_type else self.result)


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
    with Progress(f"SHA256 {path.name}", item["size"]) as progress:
        digest = hashlib.sha256()
        with path.open("rb") as f:
            while chunk := f.read(1024 * 1024):
                digest.update(chunk)
                progress.advance(len(chunk))
        matches = digest.hexdigest() == item["sha256"]
        progress.result = "verified" if matches else "MISMATCH"
        return matches


def download(item):
    dest = HOME / item["path"]
    dest.parent.mkdir(parents=True, exist_ok=True)
    print("[generation] Checking local cache: " + item["path"], flush=True)
    if valid(dest, item):
        print("[generation] Cached file verified; skipping download: " + item["path"], flush=True)
        return
    bundled = Path(__file__).with_name("bundled") / item["path"]
    if valid(bundled, item):
        staging = dest.with_suffix(dest.suffix + ".bundled")
        with Progress("Copying bundled file: " + item["path"]):
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
            with Progress("Importing cache: " + item["path"]):
                shutil.copyfile(existing, dest)
            print("[generation] Imported verified cache: " + item["path"], flush=True)
            return
    # Reuse verified caches from previous local launches. Never move credentials.
    project = Path(__file__).resolve().parents[2]
    for cache in (project / ".generation-test/bootstrap-clean", project / ".generation-test", Path.home() / ".g-studio/generation"):
        existing = cache / item["path"]
        if existing.resolve() == dest.resolve():
            continue
        if valid(existing, item):
            with Progress("Importing previous cache: " + item["path"]):
                staging = dest.with_suffix(dest.suffix + ".import")
                shutil.copyfile(existing, staging)
                staging.replace(dest)
            return
    if os.environ.get("GEN_OFFLINE") == "1":
        raise RuntimeError("Offline: missing or invalid resource: " + item["path"])
    part = dest.with_suffix(dest.suffix + ".part")
    print(
        "[generation] download "
        + item["path"]
        + f" ({item['size'] / 1024**2:.1f} MiB)",
        flush=True,
    )
    error = None
    urls = ordered_urls(item) * 2
    for attempt, url in enumerate(urls, 1):
        try:
            print(
                "[generation] Source: "
                + str(urlparse(url).hostname)
                + " / "
                + item["path"]
                + f" (attempt {attempt}/{len(urls)})",
                flush=True,
            )
            offset = part.stat().st_size if part.exists() else 0
            if offset >= item["size"]:
                part.unlink()
                offset = 0
            headers = {"User-Agent": "G-Studio-Generation/1"}
            if offset:
                headers["Range"] = f"bytes={offset}-"
                print(f"[generation] Resuming from {offset / 1024**2:.2f} MiB", flush=True)
            with Progress("Connecting to " + str(urlparse(url).hostname)):
                response = urllib.request.urlopen(
                    urllib.request.Request(url, headers=headers), timeout=30
                )
            with response:
                append = offset > 0 and response.status == 206
                if append and not response.headers.get("Content-Range", "").startswith(
                    f"bytes {offset}-"
                ):
                    raise ValueError("Invalid range response")
                count = offset if append else 0
                if offset and not append:
                    print("[generation] Server did not honor resume; restarting this file", flush=True)
                with (
                    Progress("Downloading " + dest.name, item["size"], count) as progress,
                    part.open("ab" if append else "wb") as out,
                ):
                    while chunk := response.read(1024 * 1024):
                        count += len(chunk)
                        if count > item["size"]:
                            raise ValueError("Download exceeds manifest size")
                        out.write(chunk)
                        progress.advance(len(chunk))
                    if count != item["size"]:
                        raise ValueError("Incomplete download; keeping partial file for resume")
            if not valid(part, item):
                part.unlink(missing_ok=True)
                raise ValueError("SHA256/size verification failed")
            print("[generation] Saving verified file: " + item["path"], flush=True)
            part.replace(dest)
            print("[generation] File ready: " + item["path"], flush=True)
            return
        except Exception as e:
            error = e
            print("[generation] download retry: " + str(e), flush=True)
    raise RuntimeError(f"Download failed: {item['path']}: {error}")


def main():
    started = time.monotonic()
    print(f"[generation] Model: {MANIFEST['model']} | files: {len(MANIFEST['files'])} | cache: {HOME}", flush=True)
    print("[generation] Acquiring model download lock", flush=True)
    # OS-owned locks are released after a crash; a leftover file is harmless.
    lock = (HOME / "download.lock").open("a+b")
    if lock.tell() == 0:
        lock.write(b"0")
        lock.flush()
    acquired = False
    for waiting in range(120):
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
            if waiting % 5 == 0:
                print(f"[generation] Waiting for another download to release the lock ({waiting}/120s)", flush=True)
            time.sleep(1)
    if not acquired:
        lock.close()
        raise RuntimeError("Another download is running; retry later")
    try:
        print("[generation] Download lock acquired; checking disk space", flush=True)
        missing = sum(
            i["size"] for i in MANIFEST["files"] if not (HOME / i["path"]).exists()
        )
        free = shutil.disk_usage(HOME).free
        print(f"[generation] Disk space: {free / 1024**3:.2f} GiB free; missing files: {missing / 1024**3:.2f} GiB", flush=True)
        if free < missing + 512 * 1024**2:
            raise RuntimeError("Insufficient disk space for model preparation")
        for index, item in enumerate(MANIFEST["files"], 1):
            print(f"[generation] File {index}/{len(MANIFEST['files'])}: {item['path']}", flush=True)
            download(item)
        print(f"[generation] model source and weights verified (elapsed {time.monotonic() - started:.0f}s)", flush=True)
    finally:
        lock.close()
        print("[generation] Download lock released", flush=True)


if __name__ == "__main__":
    main()
