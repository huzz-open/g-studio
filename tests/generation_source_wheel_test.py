"""Offline source preparation, corruption repair and standard wheel compatibility."""
import base64
import csv
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SERVICE = Path(__file__).resolve().parents[1] / "services/generation-python"
sys.path.insert(0, str(SERVICE))
from source_wheel import BUNDLE, prepare_source


class SourceWheelTests(unittest.TestCase):
    def test_offline_prepare_reuse_and_repair(self):
        with tempfile.TemporaryDirectory() as directory, patch(
            "urllib.request.urlopen", side_effect=AssertionError("network forbidden")
        ):
            home = Path(directory)
            target = prepare_source(home)
            pipeline = target / "hy3dgen/shapegen/pipelines.py"
            original = pipeline.read_bytes()
            modified = pipeline.stat().st_mtime_ns
            prepare_source(home)
            self.assertEqual(pipeline.stat().st_mtime_ns, modified)
            pipeline.write_bytes(b"corrupted")
            (target / "hy3dgen/__init__.py").unlink()
            prepare_source(home)
            self.assertEqual(pipeline.read_bytes(), original)
            source = json.loads((BUNDLE / "source-manifest.json").read_text())
            for item in source["files"]:
                name = item["path"].removeprefix("vendor/Hunyuan3D-2/")
                path = next(target.glob(f"*.dist-info/licenses/{name}")) if name in ("LICENSE", "NOTICE") else target / name
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), item["sha256"])

    def test_corrupt_wheel_rejected_before_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            metadata = json.loads((BUNDLE / "wheel.json").read_text())
            (home / "wheel.json").write_text(json.dumps(metadata))
            (home / metadata["filename"]).write_bytes(b"bad archive")
            with self.assertRaisesRegex(RuntimeError, "SHA256"):
                prepare_source(home, bundle=home)
            self.assertFalse((home / "vendor").exists())

    def test_wheel_record_and_no_weights(self):
        metadata = json.loads((BUNDLE / "wheel.json").read_text())
        with zipfile.ZipFile(BUNDLE / metadata["filename"]) as archive:
            record = next(name for name in archive.namelist() if name.endswith("/RECORD"))
            rows = list(csv.reader(io.StringIO(archive.read(record).decode())))
            self.assertEqual({row[0] for row in rows}, set(archive.namelist()))
            for name, digest, size in rows:
                self.assertFalse(name.endswith((".safetensors", ".pt", ".pth")))
                if name == record:
                    continue
                data = archive.read(name)
                self.assertEqual(len(data), int(size))
                self.assertEqual(digest, "sha256=" + base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode())
        manifest = json.loads((SERVICE / "model-manifest.json").read_text())
        self.assertEqual(len(manifest["files"]), 6)
        self.assertTrue(all(item["path"].startswith("models/") for item in manifest["files"]))


if __name__ == "__main__":
    unittest.main()
