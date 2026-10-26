"""Device-private configuration. Never imported by the workspace asset store."""

import json
import os
from pathlib import Path
import secrets

HOME = Path(
    os.environ.get("GEN_HOME", Path.home() / ".g-studio" / "generation")
).resolve()
HOME.mkdir(parents=True, exist_ok=True)
CONFIG = HOME / "config.json"


def atomic_json(path, value):
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)
    try:
        path.chmod(0o600)
    except OSError:
        pass


def load_config():
    value = json.loads(CONFIG.read_text("utf-8")) if CONFIG.exists() else {}
    changed = False
    for key in ("token", "deviceSecret"):
        if not value.get(key):
            value[key] = secrets.token_urlsafe(32)
            changed = True
    if not value.get("deviceId"):
        value["deviceId"] = secrets.token_hex(16)
        changed = True
    if changed:
        atomic_json(CONFIG, value)
    return value


config = load_config()
