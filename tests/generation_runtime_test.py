"""Device selection and downloader tests; mocked GPU is not a hardware benchmark."""

import hashlib
import io
import json
import importlib
import os
from pathlib import Path
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services/generation-python"))
import device


class Tensor:
    def __mul__(self, other):
        return self

    def sum(self):
        return self

    def item(self):
        return 8


class DeviceTests(unittest.TestCase):
    def fake_torch(self, available=True, error=False):
        def ones(*a, **kw):
            if error:
                raise RuntimeError("CUDA initialization error")
            return Tensor()

        return types.SimpleNamespace(
            ones=ones,
            cuda=types.SimpleNamespace(
                is_available=lambda: available,
                synchronize=lambda: None,
                empty_cache=lambda: None,
            ),
        )

    def test_gpu_preferred_after_runtime_validation(self):
        with (
            patch.dict(os.environ, {"GEN_DEVICE": ""}),
            patch(
                "device.subprocess.run",
                return_value=types.SimpleNamespace(
                    returncode=0, stdout="NVIDIA test adapter, driver\n"
                ),
            ),
            patch.dict(sys.modules, {"torch": self.fake_torch()}),
        ):
            self.assertEqual(device.probe()["deviceType"], "gpu")

    def test_gpu_init_failure_is_explicit_cpu_fallback(self):
        with (
            patch.dict(os.environ, {"GEN_DEVICE": ""}),
            patch(
                "device.subprocess.run",
                return_value=types.SimpleNamespace(
                    returncode=0, stdout="NVIDIA test adapter\n"
                ),
            ),
            patch.dict(sys.modules, {"torch": self.fake_torch(error=True)}),
        ):
            result = device.probe()
            self.assertEqual(result["deviceType"], "cpu")
            self.assertIn("initialization failed", result["reason"])

    def test_cpu_override(self):
        with (
            patch.dict(os.environ, {"GEN_DEVICE": "cpu"}),
            patch(
                "device.subprocess.run",
                return_value=types.SimpleNamespace(
                    returncode=0, stdout="NVIDIA test adapter\n"
                ),
            ),
            patch.dict(sys.modules, {"torch": self.fake_torch()}),
        ):
            result = device.probe()
            self.assertEqual(result["deviceType"], "cpu")
            self.assertIn("explicit", result["reason"])


class DownloadTests(unittest.TestCase):
    def test_modelscope_priority_and_checksum_fallback(self):
        with (
            tempfile.TemporaryDirectory(prefix="generation-mirror-") as directory,
            patch.dict(
                os.environ,
                {
                    "GEN_HOME": directory,
                    "GEN_MODEL_SOURCE": "modelscope",
                    "GEN_IMPORT_CACHE": "",
                },
            ),
        ):
            import config

            importlib.reload(config)
            import download

            importlib.reload(download)
            payload = b"verified-model-data"
            item = {
                "path": "models/test.bin",
                "size": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
                "urls": ["https://huggingface.co/test", "https://modelscope.cn/test"],
            }
            self.assertEqual(download.ordered_urls(item), list(reversed(item["urls"])))

            class Response(io.BytesIO):
                status = 200
                headers = {}

            with patch(
                "download.urllib.request.urlopen",
                side_effect=[Response(b"x" * len(payload)), Response(payload)],
            ) as fetch:
                download.download(item)
                self.assertEqual(
                    fetch.call_args_list[0].args[0].full_url,
                    "https://modelscope.cn/test",
                )
                self.assertEqual(
                    fetch.call_args_list[1].args[0].full_url,
                    "https://huggingface.co/test",
                )
            self.assertEqual((Path(directory) / item["path"]).read_bytes(), payload)

    def test_pinned_configuration_and_licenses_are_available_without_network(self):
        with (
            tempfile.TemporaryDirectory(prefix="generation-bundle-") as directory,
            patch.dict(
                os.environ,
                {
                    "GEN_HOME": directory,
                    "GEN_MODEL_SOURCE": "modelscope",
                    "GEN_IMPORT_CACHE": "",
                },
            ),
        ):
            import config

            importlib.reload(config)
            import download

            importlib.reload(download)
            selected = [
                i
                for i in download.MANIFEST["files"]
                if i["path"].startswith("models/")
                and not i["path"].endswith(".safetensors")
            ]
            self.assertEqual(len(selected), 4)
            with patch(
                "download.urllib.request.urlopen",
                side_effect=AssertionError(
                    "Bundled files must not need a network request"
                ),
            ):
                for item in selected:
                    download.download(item)
                    self.assertTrue(
                        download.valid(Path(directory) / item["path"], item)
                    )
            config_item = next(
                i
                for i in selected
                if i["path"] == "models/hunyuan3d-dit-v2-mini-turbo/config.yaml"
            )
            self.assertFalse(any("modelscope.cn" in u for u in config_item["urls"]))

    def test_resume_and_digest_validation(self):
        with (
            tempfile.TemporaryDirectory(prefix="generation-download-") as directory,
            patch.dict(os.environ, {"GEN_HOME": directory, "GEN_IMPORT_CACHE": ""}),
        ):
            import config

            importlib.reload(config)
            import download

            importlib.reload(download)
            payload = b"G-Studio fixture bytes" * 100
            ranges = []

            class Handler(BaseHTTPRequestHandler):
                def do_GET(self):
                    start = int(self.headers.get("Range", "bytes=0-")[6:].split("-")[0])
                    ranges.append(start)
                    self.send_response(206 if start else 200)
                    self.send_header("Content-Length", str(len(payload) - start))
                    if start:
                        self.send_header(
                            "Content-Range",
                            f"bytes {start}-{len(payload) - 1}/{len(payload)}",
                        )
                    self.end_headers()
                    self.wfile.write(payload[start:])

                def log_message(self, *a):
                    pass

            server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                item = {
                    "path": "weights/test.bin",
                    "size": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                    "urls": [f"http://127.0.0.1:{server.server_port}/file"],
                }
                target = Path(directory) / item["path"]
                target.parent.mkdir()
                target.with_suffix(".bin.part").write_bytes(payload[:71])
                download.download(item)
                self.assertEqual(ranges, [71])
                self.assertEqual(target.read_bytes(), payload)
                download.download(item)
                self.assertEqual(ranges, [71])
                target.write_bytes(b"corrupt")
                download.download(item)
                self.assertEqual(target.read_bytes(), payload)
                self.assertEqual(ranges[-1], 0)
            finally:
                server.shutdown()
                server.server_close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
