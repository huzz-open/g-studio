"""Offline regressions for incremental repair and prebuilt source exceptions."""
import contextlib
import importlib.metadata
import io
import json
from pathlib import Path
import platform
import runpy
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services/generation-python"))
from check_environment import check


class DependencySelectionTests(unittest.TestCase):
    def select(self, installed, repair, local=False, target=None):
        native = f"{sys.platform}-{'arm64' if platform.machine().lower() in ('arm64', 'aarch64') else 'x64'}"
        with tempfile.TemporaryDirectory() as directory:
            lock = Path(directory) / "pylock.toml"
            lock.write_text('''lock-version = "1.0"
[[packages]]
name = "demo"
version = "1.0"
''' + ('' if local else '''wheels = [{url = "https://example.test/demo-1.0-py3-none-any.whl", hashes = {sha256 = "abc"}}]
'''))
            options = {"repairPackages": repair, "localWheels": [{"name": "demo", "path": "/cache/demo.whl"}] if local else []}
            args = ["select-wheels.py", directory, str(lock), target or native, json.dumps(options)]
            output = io.StringIO()
            with patch.object(sys, "argv", args), patch.object(sys, "path", sys.path.copy()), patch(
                "importlib.metadata.version", side_effect=installed if isinstance(installed, Exception) else None,
                return_value=installed,
            ), contextlib.redirect_stdout(output):
                runpy.run_path(str(ROOT / "scripts/generation/select-wheels.py"), run_name="__main__")
            return json.loads(output.getvalue())

    def test_matching_installed_package_is_not_downloaded_or_reinstalled(self):
        self.assertEqual(self.select("1.0", []), [])

    def test_missing_mismatched_and_damaged_packages_are_selected(self):
        for installed in [importlib.metadata.PackageNotFoundError("demo"), "0.9", None, "invalid"]:
            with self.subTest(installed=installed):
                self.assertEqual(self.select(installed, [])[0]["filename"], "demo-1.0-py3-none-any.whl")

    def test_import_failure_forces_repair_even_when_version_matches(self):
        self.assertEqual(self.select("1.0", ["demo"])[0]["name"], "demo")

    def test_locally_built_wheel_does_not_need_a_registry_wheel(self):
        self.assertEqual(self.select(None, [], local=True), [{"name": "demo", "path": "/cache/demo.whl"}])
        self.assertEqual(self.select("1.0", [], local=True), [])

    def test_full_download_and_cross_platform_selection_do_not_reuse_host_packages(self):
        self.assertEqual(len(self.select("1.0", None)), 1)
        target = "darwin-arm64" if sys.platform != "darwin" else "win32-x64"
        self.assertEqual(len(self.select("1.0", [], target=target)), 1)

    def test_environment_probe_reports_incomplete_metadata_instead_of_crashing(self):
        with tempfile.TemporaryDirectory() as directory:
            requirements = Path(directory) / "requirements.txt"
            requirements.write_text("demo==1.0\n")
            with patch("importlib.metadata.version", return_value=None), patch("importlib.import_module"):
                report = check(requirements, "base")
            self.assertFalse(report["ok"])
            self.assertIn({"package": "demo", "reason": "missing version metadata"}, report["issues"])


if __name__ == "__main__":
    unittest.main()
