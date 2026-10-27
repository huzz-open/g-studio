import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("pack_runtime", ROOT / "scripts/generation/pack_runtime.py")
pack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack)


class BundleTests(unittest.TestCase):
    def test_allowlist_excludes_machine_data_and_other_platforms(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary) / "source"
            home = project / "runtime/generation"
            files = ["start-generation.sh", "scripts/generation/start.mjs", "services/generation-python/server.py", "runtime/README.md",
                     "runtime/generation/platforms/win32-x64/node/node.exe", "runtime/generation/platforms/win32-x64/python-cpu/python/python.exe",
                     "runtime/generation/models/weight", "runtime/generation/vendor/LICENSE",
                     "runtime/generation/config.json", "runtime/generation/jobs/private.png", "runtime/generation/cache/download",
                     "runtime/generation/platforms/darwin-arm64/node/node", "runtime/generation-data/config.json",
                     "scripts/generation/__pycache__/pack.pyc"]
            for name in files:
                path = project / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("fixture")
            (project / ".generation-mirrors.local.json").write_text(json.dumps({"version": 1, "profile": "cn", "secret": "not-distributable"}))
            output = Path(temporary) / "package.zip"
            pack.package(project, home, "win32-x64", "cpu", output)
            with zipfile.ZipFile(output) as archive:
                names = archive.namelist()
                self.assertIn("runtime/generation/models/weight", names)
                self.assertFalse(any("config.json" in name or "jobs/" in name or "cache/" in name or "darwin" in name or "pycache" in name for name in names))
                self.assertNotIn("secret", archive.read(".generation-mirrors.local.json").decode())
                self.assertEqual(json.loads(archive.read("bundle.json"))["platform"], "win32-x64")


if __name__ == "__main__":
    unittest.main()
