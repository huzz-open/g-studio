"""Select exact compatible wheels from uv's resolved pylock (no network)."""
import json
import sys
import tomllib
from urllib.parse import unquote, urlparse

sys.path.insert(0, sys.argv[1])  # Verified pure-Python packaging wheel; no install needed.
from packaging.tags import sys_tags, cpython_tags, compatible_tags, mac_platforms
from packaging.utils import parse_wheel_filename
from packaging.markers import Marker, default_environment

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
with open(sys.argv[2], "rb") as handle:
    lock = tomllib.load(handle)
for package in lock["packages"]:
    if package.get("marker") and not Marker(package["marker"]).evaluate(environment):
        continue
    if package["name"] in ("torch", "torchvision"):
        continue  # These verified local wheels were supplied to the resolver.
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
