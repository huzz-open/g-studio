"""Check relocated execution with system runtimes hidden, not visual quality.

The one-step real-model smoke test only checks transport and runtime execution.
Use the normal five-step settings and inspect the geometry to assess quality.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import time
import urllib.request


def verify(package, bash, output, real_model=False):
    project = Path(__file__).resolve().parents[1]
    output.mkdir(parents=True, exist_ok=True)
    env = {k: v for k, v in os.environ.items() if not k.startswith("GEN_")}
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    env.update(GEN_PORT=str(port), GEN_OFFLINE="1", PYTHONIOENCODING="utf-8")
    shell = 'export PATH=/usr/bin:/bin:/c/Windows/System32; for tool in node python python3 uv; do if command -v "$tool" >/dev/null 2>&1; then echo "Unexpected system runtime: $tool"; exit 1; fi; done; exec sh ./start-generation.sh --offline'
    log_path = output / "relocated-service.log"
    with log_path.open("wb") as log:
        process = subprocess.Popen([str(bash), "-c", shell], cwd=package, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=os.name != "nt")
        token = ""

        def request(path, body=None, headers=None):
            req = urllib.request.Request(f"http://127.0.0.1:{port}" + path, data=body, headers={"Authorization": "Bearer " + token, **(headers or {})})
            with urllib.request.urlopen(req, timeout=30) as response:
                raw = response.read()
                return json.loads(raw) if "json" in response.headers.get("Content-Type", "") else raw

        try:
            config = package / "runtime/generation-data/config.json"
            deadline = time.monotonic() + 180
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError("Portable launcher exited; inspect relocated-service.log")
                if config.exists():
                    token = json.loads(config.read_text())["token"]
                    try:
                        providers = request("/v1/capabilities")["providers"]
                        if any(p["providerId"] == "hunyuan-mini" and p["state"] == "ready" for p in providers):
                            break
                    except OSError:
                        pass
                time.sleep(1)
            else:
                raise RuntimeError("Portable model preparation timed out")
            print("Relocated bundle ready with GEN_OFFLINE=1 and system runtimes hidden", flush=True)
            binary = (project / "public/scene-lighting/vase.png").read_bytes()
            metadata = {"protocolVersion": 1, "providerId": "hunyuan-mini" if real_model else "silhouette", "clientRequestId": "portable-relocation-check", "inputSha256": hashlib.sha256(binary).hexdigest(), "targetFaces": 1000}
            if real_model:
                metadata.update(seed=12345, parameters={"steps": 1, "resolution": 128})
            boundary = "gstudio-portable-test"
            body = (f'--{boundary}\r\nContent-Disposition: form-data; name="request"\r\nContent-Type: application/json\r\n\r\n'.encode() + json.dumps(metadata).encode() + f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="vase.png"\r\nContent-Type: image/png\r\n\r\n'.encode() + binary + f'\r\n--{boundary}--\r\n'.encode())
            started = time.monotonic()
            job = request("/v1/jobs", body, {"Content-Type": "multipart/form-data; boundary=" + boundary})
            previous = None
            while time.monotonic() - started < 900:
                job = request("/v1/jobs/" + job["id"])
                progress = (job["status"], job["phase"])
                if progress != previous:
                    print("Job:", *progress, flush=True)
                    previous = progress
                if job["status"] in ("succeeded", "failed", "cancelled"):
                    break
                time.sleep(2)
            if job["status"] != "succeeded":
                raise RuntimeError("Generation failed: " + json.dumps(job.get("error", progress)))
            result = request("/v1/jobs/" + job["id"] + "/outputs/shadow")
            assert result[:4] == b"glTF"
            assert hashlib.sha256(result).hexdigest() == job["result"]["outputs"][0]["sha256"]
            (output / "relocated-result.glb").write_bytes(result)
            summary = {"offlineSetup": True, "systemRuntimesHidden": True, "provider": metadata["providerId"], "seconds": round(time.monotonic() - started, 2), "outputBytes": len(result), "parameters": metadata.get("parameters")}
            (output / "relocated-result.json").write_text(json.dumps(summary, indent=2))
            print(json.dumps(summary), flush=True)
        finally:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=20)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("package", type=Path)
    parser.add_argument("--bash", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--real-model", action="store_true")
    args = parser.parse_args()
    verify(args.package.resolve(), args.bash.resolve(), args.output.resolve(), args.real_model)
