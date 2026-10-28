"""Select exact compatible wheels from uv's resolved pylock (no network)."""
import json
import importlib.metadata
import platform
import sys
import tomllib
from urllib.parse import unquote, urlparse

sys.path.insert(0, sys.argv[1])  # Verified pure-Python packaging wheel; no install needed.
from packaging.tags import sys_tags, cpython_tags, compatible_tags, mac_platforms
from packaging.utils import parse_wheel_filename
from packaging.markers import Marker, default_environment
from packaging.version import Version, InvalidVersion
from packaging.utils import canonicalize_name

target = sys.argv[3]
environment = default_environment()
if target == "darwin-arm64" and sys.platform != "darwin":
    platforms = list(mac_platforms((11, 0), "arm64"))
    tags = list(cpython_tags((3, 12), platforms=platforms)) + list(compatible_tags((3, 12), "cp312", platforms))
    environment.update(sys_platform="darwin", platform_system="Darwin", platform_machine="arm64", python_version="3.12", python_full_version="3.12.12")
else:
    tags = list(sys_tags())
rank = {tag: i for i, tag in enumerate(tags)}
result = []
options = json.loads(sys.argv[4]) if len(sys.argv) > 4 else {}
local_wheels = {canonicalize_name(wheel["name"]): wheel for wheel in options.get("localWheels", [])}
repair = options.get("repairPackages")
forced = {canonicalize_name(name) for name in repair or []}
native_machine = platform.machine().lower()
native_target = f"{sys.platform}-{'arm64' if native_machine in ('arm64', 'aarch64') else 'x64'}"
with open(sys.argv[2], "rb") as handle:
    lock = tomllib.load(handle)
for package in lock["packages"]:
    if package.get("marker") and not Marker(package["marker"]).evaluate(environment):
        continue
    name = canonicalize_name(package["name"])
    if name in ("torch", "torchvision"):
        continue  # These verified local wheels were supplied to the resolver.
    # Only reuse installed distributions on the interpreter's own platform.
    # Forced entries include packages whose version matched but import failed.
    if repair is not None and target == native_target and name not in forced:
        try:
            installed = importlib.metadata.version(name)
            if installed and Version(installed) == Version(package["version"]):
                continue
        except (importlib.metadata.PackageNotFoundError, InvalidVersion):
            pass
    if name in local_wheels:
        result.append(local_wheels[name])
        continue
    candidates = []
    for wheel in package.get("wheels", []):
        filename = unquote(urlparse(wheel["url"]).path.rsplit("/", 1)[-1])
        _, _, _, wheel_tags = parse_wheel_filename(filename)
        priority = min((rank[tag] for tag in wheel_tags if tag in rank), default=None)
        if priority is not None:
            candidates.append((priority, filename, wheel))
    if not candidates:
        raise RuntimeError(f"No compatible binary wheel for {package['name']}=={package['version']}")
    _, filename, wheel = min(candidates, key=lambda entry: entry[0])
    result.append(dict(name=package["name"], filename=filename, url=wheel["url"], hash=wheel["hashes"]["sha256"]))
print(json.dumps(result))
