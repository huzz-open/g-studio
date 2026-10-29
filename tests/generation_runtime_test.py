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
            version=types.SimpleNamespace(cuda="12.4", hip=None),
            ones=ones,
            cuda=types.SimpleNamespace(
                is_available=lambda: available,
                synchronize=lambda: None,
                empty_cache=lambda: None,
            ),
        )

    def test_rocm_is_not_mistaken_for_nvidia_cuda(self):
        torch = self.fake_torch()
        torch.version.hip = "7.2.1"
        with patch.dict(os.environ, {"GEN_DEVICE": "auto"}), patch.dict(sys.modules, {"torch": torch}):
            result = device.probe()
        self.assertEqual(result["backend"], "cpu")
        self.assertIn("not supported", result["reason"])

    def test_apple_silicon_mps_probe_and_cpu_override(self):
        torch = self.fake_torch()
        torch.version.cuda = None
        torch.backends = types.SimpleNamespace(mps=types.SimpleNamespace(is_available=lambda: True))
        torch.mps = types.SimpleNamespace(synchronize=lambda: None, empty_cache=lambda: None)
        with patch("device.platform.system", return_value="Darwin"), patch("device.platform.machine", return_value="arm64"), patch.dict(sys.modules, {"torch": torch}):
            with patch.dict(os.environ, {"GEN_DEVICE": "mps"}):
                self.assertEqual(device.probe()["backend"], "mps")
            with patch.dict(os.environ, {"GEN_DEVICE": "cpu"}):
                self.assertEqual(device.probe()["backend"], "cpu")

    def test_unsupported_explicit_gpu_requests_fail(self):
        for requested in ("xpu", "rocm"):
            with patch.dict(os.environ, {"GEN_DEVICE": requested}):
                with self.assertRaises(RuntimeError): device.probe()

    def test_mps_uses_cpu_noise_generator_and_fixed_precision(self):
        from compute import inference_dtype, noise_generator
        seen = {}
        def generator(device):
            seen["device"] = device
            return types.SimpleNamespace(manual_seed=lambda seed: seen.update(seed=seed))
        torch = types.SimpleNamespace(Generator=generator, float16="fp16", float32="fp32")
        noise_generator(torch, "mps", 42)
        self.assertEqual(seen, {"device": "cpu", "seed": 42})
        self.assertEqual(inference_dtype(torch, "mps"), "fp16")
        self.assertEqual(inference_dtype(torch, "cuda"), "fp16")

    def test_gpu_preferred_after_runtime_validation(self):
        with (
            patch("device.platform.system", return_value="Windows"),
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

    def test_auto_selected_gpu_init_failure_does_not_fall_back_to_cpu(self):
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
            with self.assertRaisesRegex(RuntimeError, 'CUDA initialization failed'):
                device.probe()

    def test_explicit_unavailable_or_failed_device_does_not_select_cpu(self):
        for torch in [self.fake_torch(available=False), self.fake_torch(error=True)]:
            with patch("device.platform.system",return_value="Windows"), patch.dict(os.environ,GEN_DEVICE="cuda"), patch.dict(sys.modules,{"torch":torch}):
                with self.assertRaises(RuntimeError): device.probe()

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
    def test_explicit_resubmission_preserves_the_original_upload(self):
        import generate
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / "input.png").write_bytes(b"original upload")
            def fail_after_preview(*args, **kwargs):
                (folder / "input.png").write_bytes(b"normalized preview")
                raise RuntimeError("MPS backend operation failed")
            with patch("generate.subprocess.run", side_effect=fail_after_preview):
                with self.assertRaises(RuntimeError): generate.hunyuan(folder, {})
            with patch("generate.subprocess.run"):
                generate.hunyuan(folder, {})
            self.assertEqual((folder / "original.png").read_bytes(), b"original upload")

    def test_progress_continues_during_blocked_reads_and_preserves_resume(self):
        with (
            tempfile.TemporaryDirectory(prefix="generation-progress-") as directory,
            patch.dict(os.environ, {"GEN_HOME": directory, "GEN_IMPORT_CACHE": ""}),
        ):
            import config
            importlib.reload(config)
            import download
            importlib.reload(download)
            payload = b"progress fixture" * 100
            offset = 71
            item = {
                "path": "weights/progress.bin", "size": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
                "urls": ["https://example.invalid/weights"],
            }
            target = Path(directory) / item["path"]
            target.parent.mkdir()
            target.with_suffix(".bin.part").write_bytes(payload[:offset])
            connected = threading.Event()
            receiving = threading.Event()
            messages = []

            def capture(message, **kwargs):
                messages.append(message)
                if "Connecting to" in message and message.startswith("\r"):
                    connected.set()
                if "MiB/s" in message and message.startswith("\r"):
                    receiving.set()

            class Terminal(io.StringIO):
                def isatty(self):
                    return True

                def write(self, message):
                    capture(message)
                    return super().write(message)

            class Response(io.BytesIO):
                status = 206
                headers = {"Content-Range": f"bytes {offset}-{len(payload)-1}/{len(payload)}"}

                def read(self, size):
                    if not receiving.wait(2):
                        raise AssertionError("No progress while network read is blocked")
                    return super().read(size)

            def fetch(request, **kwargs):
                self.assertEqual(request.get_header("Range"), f"bytes={offset}-")
                self.assertTrue(connected.wait(2), "No progress while connecting")
                return Response(payload[offset:])

            with (
                patch.object(download, "PROGRESS_INTERVAL", 0.01),
                patch("builtins.print", side_effect=capture),
                patch("sys.stderr", Terminal()),
                patch("download.urllib.request.urlopen", side_effect=fetch) as network,
            ):
                download.download(item)
            self.assertEqual(network.call_count, 1)
            self.assertEqual(target.read_bytes(), payload)
            self.assertTrue(any(m.startswith("\r\x1b[2K") for m in messages))
            self.assertFalse(any(": running" in m for m in messages))
            self.assertTrue(any("100.0%" in m and "ETA 0s" in m for m in messages))
            self.assertTrue(any("SHA256 progress.bin.part: verified" in m for m in messages))

    def test_progress_failure_stops_heartbeat_and_resume_speed_excludes_cached_bytes(self):
        with (
            tempfile.TemporaryDirectory(prefix="generation-progress-") as directory,
            patch.dict(os.environ, {"GEN_HOME": directory}),
        ):
            import config
            importlib.reload(config)
            import download
            importlib.reload(download)
            output = io.StringIO()
            with patch("sys.stderr", output), patch.dict(os.environ, {"GEN_PROGRESS": "0"}):
                with self.assertRaisesRegex(OSError, "read failed"):
                    with download.Progress("network stage") as progress:
                        raise OSError("read failed")
                self.assertTrue(progress.thread is None or not progress.thread.is_alive())
                with patch.object(download.time, "monotonic", side_effect=[0, 1, 1]):
                    progress = download.Progress("resume", 10 * 1024**2, 9 * 1024**2)
                    progress.advance(1024**2)
                    progress.report("complete")
            self.assertIn("network stage: failed", output.getvalue())
            self.assertNotIn("network stage: complete", output.getvalue())
            self.assertIn("1.00 MiB/s", output.getvalue())

    def test_progress_plain_logs_and_stalled_speed(self):
        import download
        output = io.StringIO()
        with patch.dict(os.environ, {"GEN_PROGRESS": "0"}):
            with download.Progress("plain log", stream=output) as progress:
                progress.report()
                progress.report()
                self.assertIsNone(progress.thread)
        self.assertEqual(len(output.getvalue().splitlines()), 2)
        self.assertNotIn("\x1b", output.getvalue())
        self.assertNotIn("\r", output.getvalue())

        class Terminal(io.StringIO):
            def isatty(self):
                return True

        output = Terminal()
        with patch.object(download.time, "monotonic", return_value=0):
            progress = download.Progress("download", 10 * 1024**2, stream=output)
        with patch.object(download.time, "monotonic", return_value=1):
            progress.advance(1024**2)
            progress.report()
        self.assertIn("1.00 MiB/s", output.getvalue())
        output.seek(0)
        output.truncate()
        with patch.object(download.time, "monotonic", return_value=6):
            progress.report()
        self.assertIn("0.00 MiB/s", output.getvalue())
        self.assertIn("waiting 5s", output.getvalue())
        self.assertNotIn("\n", output.getvalue())

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
