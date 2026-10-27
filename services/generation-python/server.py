"""Generation-only HTTP service. Assets belong to the caller, never this service."""

import asyncio
import hashlib
import math
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import sys
import time
import uuid
from aiohttp import web
from config import HOME, DATA_HOME, config, atomic_json
from providers import PROVIDERS
from compute import recoverable_accelerator_error

ROOT = Path(__file__).resolve().parent
JOBS = DATA_HOME / "jobs"
JOBS.mkdir(exist_ok=True)
LIMIT = 10 * 1024 * 1024
TERMINAL = {"succeeded", "failed", "cancelled", "expired"}


class Fault(Exception):
    def __init__(self, code, message, status=400):
        self.code = code
        self.message = message
        self.status = status


class Service:
    def __init__(self):
        self.jobs = {}
        self.queue = asyncio.Queue()
        self.device = None
        self.backend = "cpu"
        self.device_reason = "Device detection in progress"
        self.process = None
        self.running = None
        self.provider_states = {
            p.id: {"state": "preparing" if p.needs_model else "ready", "error": None}
            for p in PROVIDERS.values()
        }
        self.tasks = []
        self.preparation_process = None
        for path in JOBS.glob("*/job.json"):
            try:
                job = json.loads(path.read_text("utf-8"))
                if job["status"] not in TERMINAL:
                    job.update(
                        status="failed",
                        phase="interrupted",
                        expiresAt=time.time() + 86400,
                        error={
                            "code": "INTERRUPTED",
                            "message": "Worker restarted; resubmit explicitly.",
                            "retryable": True,
                        },
                    )
                self.jobs[job["id"]] = job
                self.save(job)
            except (ValueError, KeyError):
                pass

    def save(self, job):
        atomic_json(JOBS / job["id"] / "job.json", job)

    def info(self, provider="hunyuan-mini"):
        if provider not in PROVIDERS:
            raise Fault("UNSUPPORTED_PROVIDER", "Unknown provider", 400)
        if not PROVIDERS[provider].supports_gpu:
            return {"deviceType": "cpu"}
        if not self.device:
            raise Fault("DEVICE_NOT_READY", "Device detection in progress", 503)
        return {"deviceType": self.device, "backend": self.backend, "reason": self.device_reason}

    def capabilities(self):
        return {
            "protocolVersion": 1,
            "providers": [
                {
                    **p.describe(),
                    **self.provider_states[p.id],
                }
                for p in PROVIDERS.values()
            ],
            "limits": {
                "inputBytes": LIMIT,
                "inputDimension": 2048,
                "outputBytes": 128 * 1024 * 1024,
                "concurrency": 1,
                "queue": 8,
            },
            "inputFormats": ["image/png", "image/jpeg", "image/webp"],
            "formats": ["model/gltf-binary"],
            "targetFaces": {"min": 1000, "max": 40000, "default": 12000},
            "cancel": True,
        }

    async def prepare(self):
        p = await asyncio.create_subprocess_exec(
            sys.executable,
            str(ROOT / "device.py"),
            stdout=asyncio.subprocess.PIPE,
            start_new_session=os.name != "nt",
        )
        self.preparation_process = p
        try:
            out, _ = await asyncio.wait_for(p.communicate(), timeout=60)
        except asyncio.TimeoutError:
            await self.stop_process(p)
            out = b""
        try:
            d = json.loads(out)
            self.device = d["deviceType"]
            self.backend = d.get("backend", "cpu")
            self.device_reason = d["reason"]
            print(
                "[generation] detected: CPU; GPU: "
                + (", ".join(d["detected"]) or "none"),
                flush=True,
            )
            print("[generation] runtime: " + d["reason"], flush=True)
            print("[generation] selected device: " + self.backend.upper(), flush=True)
        except Exception:
            self.device = "cpu"
            self.backend = "cpu"
            self.device_reason = "Device probe failed; using CPU"
            print("[generation] GPU probe failed; selected device: CPU", flush=True)
        self.preparation_process = None
        for provider in PROVIDERS.values():
            if not provider.needs_model:
                continue
            state = self.provider_states[provider.id]
            if os.environ.get("GEN_SKIP_MODEL") == "1":
                state["state"] = "not-installed"
                continue
            try:
                command = provider.prepare_command()
                if not command:
                    raise RuntimeError("Provider has no preparation implementation")
                p = await asyncio.create_subprocess_exec(
                    *command, start_new_session=os.name != "nt"
                )
                self.preparation_process = p
                if await p.wait():
                    raise RuntimeError(
                        "Model preparation failed; retry after resolving download errors"
                    )
                state["state"] = "ready"
            except Exception as e:
                state.update(state="failed", error=str(e))
            finally:
                self.preparation_process = None

    async def submit(self, request, image):
        if not isinstance(request, dict):
            raise Fault("INVALID_REQUEST", "JSON object required")
        allowed = {
            "protocolVersion",
            "clientRequestId",
            "providerId",
            "inputSha256",
            "targetFaces",
            "seed",
            "parameters",
        }
        if set(request) - allowed:
            raise Fault("UNSUPPORTED_PARAMETER", "Unknown request field")
        if (
            type(request.get("protocolVersion")) is not int
            or request.get("protocolVersion") != 1
            or not isinstance(request.get("providerId"), str)
            or request.get("providerId") not in PROVIDERS
        ):
            raise Fault("UNSUPPORTED_PROVIDER", "Unsupported protocol/provider")
        cid = request.get("clientRequestId", "")
        if not isinstance(cid, str) or not 1 <= len(cid) <= 100:
            raise Fault("INVALID_REQUEST", "clientRequestId required")
        if not image or len(image) > LIMIT:
            raise Fault("INPUT_LIMIT", "Image too large", 413)
        digest = hashlib.sha256(image).hexdigest()
        if request.get("inputSha256") != digest:
            raise Fault("DIGEST_MISMATCH", "Input digest does not match")
        for key, default, lo, hi in [
            ("targetFaces", 12000, 1000, 40000),
            ("seed", 12345, 0, 2147483647),
        ]:
            value = request.setdefault(key, default)
            if type(value) != int or not lo <= value <= hi:
                raise Fault("INVALID_PARAMETER", key)
        params = request.setdefault("parameters", {})
        if not isinstance(params, dict):
            raise Fault("INVALID_PARAMETER", "parameters must be an object")
        supported = PROVIDERS[request["providerId"]].parameters
        for k, v in params.items():
            if (
                k not in supported
                or type(v) not in (int, float)
                or not math.isfinite(v)
                or (supported[k].get("integer", False) and type(v) != int)
                or not supported[k]["min"] <= v <= supported[k]["max"]
            ):
                raise Fault("INVALID_PARAMETER", k)
        fingerprint = hashlib.sha256(
            json.dumps(request, sort_keys=True).encode() + image
        ).hexdigest()
        for job in self.jobs.values():
            if job["clientRequestId"] == cid:
                if job["fingerprint"] != fingerprint:
                    raise Fault(
                        "IDEMPOTENCY_CONFLICT",
                        "Request ID already used for different input",
                        409,
                    )
                return job
        provider_state = self.provider_states[request["providerId"]]
        if provider_state["state"] != "ready":
            raise Fault(
                "PROVIDER_NOT_READY",
                provider_state["error"] or provider_state["state"],
                503,
            )
        if self.queue.qsize() >= 8:
            raise Fault("QUEUE_FULL", "Queue is full", 429)
        from PIL import Image

        try:
            im = Image.open(io.BytesIO(image))
            if im.format not in ("PNG", "JPEG", "WEBP"):
                raise ValueError("Only PNG, JPEG and WebP are supported")
            if im.width > 2048 or im.height > 2048 or im.width * im.height > 4000000:
                raise ValueError("Image dimensions exceed limit")
            im = im.convert("RGBA")
            im.load()
        except Exception as e:
            raise Fault("INVALID_IMAGE", str(e))
        id = str(uuid.uuid4())
        folder = JOBS / id
        folder.mkdir()
        im.save(folder / "input.png")
        atomic_json(folder / "request.json", request)
        job = {
            "id": id,
            "clientRequestId": cid,
            "fingerprint": fingerprint,
            "providerId": request["providerId"],
            "status": "queued",
            "phase": "queued",
            "createdAt": time.time(),
            "inputSha256": digest,
            "parameters": request,
            "expiresAt": None,
        }
        self.jobs[id] = job
        self.save(job)
        await self.queue.put(id)
        return job

    def get(self, id):
        if id not in self.jobs:
            raise Fault("NOT_FOUND", "Unknown task", 404)
        return self.jobs[id]

    async def cancel(self, id):
        job = self.get(id)
        if job["status"] in TERMINAL:
            return job
        job["status"] = "cancel_requested"
        self.save(job)
        if self.running == id and self.process:
            await self.stop_process()
        job.update(status="cancelled", phase="cancelled", expiresAt=time.time() + 86400)
        self.save(job)
        return job

    async def stop_process(self, p=None):
        p = p or self.process
        if not p or p.returncode is not None:
            return
        if os.name == "nt":
            killer = await asyncio.create_subprocess_exec(
                "taskkill",
                "/PID",
                str(p.pid),
                "/T",
                "/F",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await killer.wait()
        else:
            try:
                os.killpg(p.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        await p.wait()

    async def worker(self):
        while True:
            id = await self.queue.get()
            job = self.jobs[id]
            if job["status"] != "queued":
                continue
            self.running = id
            job.update(status="running", phase="starting")
            self.save(job)
            folder = JOBS / id
            try:
                for attempt in range(2):
                    use_gpu = (
                        self.device == "gpu"
                        and PROVIDERS[job["providerId"]].supports_gpu
                    )
                    backend = self.backend if use_gpu else "cpu"
                    env = {
                        **os.environ,
                        "GEN_DEVICE": backend,
                        "PYTHONIOENCODING": "utf-8",
                    }
                    opts = {} if os.name == "nt" else {"start_new_session": True}
                    self.process = await asyncio.create_subprocess_exec(
                        sys.executable,
                        "-u",
                        str(ROOT / "generate.py"),
                        str(folder),
                        env=env,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.STDOUT,
                        **opts,
                    )
                    tail = []
                    with (folder / "execution.log").open("a", encoding="utf-8") as log:
                        async for raw in self.process.stdout:
                            line = raw.decode("utf-8", "replace").strip()
                            log.write(line + "\n")
                            log.flush()
                            tail.append(line)
                            tail = tail[-30:]
                            try:
                                event = json.loads(line)
                                if "phase" in event:
                                    job["phase"] = event["phase"]
                                    self.save(job)
                            except (ValueError, TypeError):
                                pass
                    code = await self.process.wait()
                    if job["status"] in ("cancel_requested", "cancelled"):
                        break
                    if code == 0:
                        break
                    detail = "\n".join(tail)
                    if (
                        attempt == 0
                        and use_gpu
                        and recoverable_accelerator_error(backend, detail)
                    ):
                        self.device = "cpu"
                        self.backend = "cpu"
                        self.device_reason = "Accelerator failed during inference; retried on CPU"
                        job["phase"] = "fallback-cpu"
                        self.save(job)
                        print(
                            "[generation] GPU failed; selected device: CPU; retrying task once",
                            flush=True,
                        )
                    else:
                        raise RuntimeError(detail[-1500:])
                if job["status"] in ("cancel_requested", "cancelled"):
                    continue
                meta = json.loads((folder / "output.json").read_text("utf-8"))
                output = folder / "shadow.glb"
                if output.stat().st_size > 128 * 1024 * 1024:
                    raise ValueError("Output exceeds limit")
                job.update(
                    status="succeeded",
                    phase="complete",
                    expiresAt=time.time() + 86400,
                    result={
                        **meta,
                        "protocolVersion": 1,
                        "jobId": id,
                        "providerId": job["providerId"],
                        "providerVersion": PROVIDERS[job["providerId"]].version,
                        "parameters": job["parameters"],
                        "deviceType": "gpu" if use_gpu else "cpu",
                        "backend": backend,
                        "inputSha256": job["inputSha256"],
                        "outputs": [
                            {
                                "id": "shadow",
                                "mime": "model/gltf-binary",
                                "bytes": output.stat().st_size,
                                "sha256": hashlib.sha256(
                                    output.read_bytes()
                                ).hexdigest(),
                            }
                        ],
                    },
                )
            except Exception as e:
                if job["status"] != "cancelled":
                    job.update(
                        status="failed",
                        error={
                            "code": "GENERATION_FAILED",
                            "message": str(e),
                            "retryable": True,
                        },
                        expiresAt=time.time() + 86400,
                    )
            finally:
                self.save(job)
                self.process = None
                self.running = None

    async def cleanup(self):
        while True:
            for job in list(self.jobs.values()):
                try:
                    if (
                        job.get("expiresAt")
                        and job["expiresAt"] < time.time() - 86400
                        and job["status"] == "expired"
                    ):
                        folder = JOBS / job["id"]
                        for file in folder.iterdir():
                            if file.is_file():
                                file.unlink(missing_ok=True)
                        folder.rmdir()
                        del self.jobs[job["id"]]
                        continue
                    if (
                        job.get("expiresAt")
                        and job["expiresAt"] < time.time()
                        and job["status"] in TERMINAL
                    ):
                        job["status"] = "expired"
                        self.save(job)
                        for file in (JOBS / job["id"]).iterdir():
                            if file.name != "job.json" and file.is_file():
                                file.unlink(missing_ok=True)
                except OSError:
                    # A download may still hold a file open on Windows. Retry later.
                    pass
            await asyncio.sleep(60)


service = Service()


@web.middleware
async def security(request, handler):
    origins = os.environ.get(
        "GEN_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    origin = request.headers.get("Origin")
    headers = {}
    if origin and origin not in origins:
        return web.json_response(
            {"error": {"code": "ORIGIN_DENIED", "message": "Origin not allowed"}},
            status=403,
        )
    if origin:
        headers = {
            "Access-Control-Allow-Origin": origin,
            "Vary": "Origin",
            "Access-Control-Allow-Headers": "Authorization,Content-Type",
            "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        }
    if request.host.split(":")[0] not in (
        "127.0.0.1",
        "localhost",
        "[",
        os.environ.get("GEN_HOST_NAME", ""),
    ):
        return web.Response(status=403)
    if request.method == "OPTIONS":
        return web.Response(headers=headers)
    if request.path != "/health" and not secrets.compare_digest(
        request.headers.get("Authorization", ""), "Bearer " + config["token"]
    ):
        return web.json_response(
            {"error": {"code": "UNAUTHORIZED", "message": "Access token required"}},
            status=401,
            headers=headers,
        )
    try:
        response = await handler(request)
    except Fault as e:
        response = web.json_response(
            {
                "error": {
                    "code": e.code,
                    "message": e.message,
                    "retryable": e.status >= 500,
                }
            },
            status=e.status,
        )
    except (ValueError, KeyError, json.JSONDecodeError):
        response = web.json_response(
            {"error": {"code": "INVALID_REQUEST", "message": "Invalid request"}},
            status=400,
        )
    response.headers.update(headers)
    response.headers["Cache-Control"] = "no-store"
    return response


async def health(r):
    return web.json_response(
        {"status": "ok", "protocol": "g-studio/generation", "version": 1}
    )


async def info(r):
    return web.json_response(service.info(r.query.get("providerId", "hunyuan-mini")))


async def capabilities(r):
    return web.json_response(service.capabilities())


async def submit(r):
    reader = await r.multipart()
    metadata = None
    image = None
    while field := await reader.next():
        limit = LIMIT if field.name == "image" else 65536
        value = bytearray()
        while chunk := await field.read_chunk():
            value.extend(chunk)
            if len(value) > limit:
                raise Fault("INPUT_LIMIT", "Multipart field too large", 413)
        if field.name == "request":
            metadata = json.loads(value)
        elif field.name == "image":
            image = bytes(value)
        else:
            raise Fault("INVALID_REQUEST", "Unknown multipart field")
    return web.json_response(await service.submit(metadata, image), status=202)


async def status(r):
    return web.json_response(service.get(r.match_info["id"]))


async def cancel(r):
    return web.json_response(await service.cancel(r.match_info["id"]))


async def output(r):
    job = service.get(r.match_info["id"])
    if job["status"] != "succeeded" or r.match_info["output"] != "shadow":
        raise Fault("OUTPUT_UNAVAILABLE", "Output not available", 410)
    return web.FileResponse(
        JOBS / job["id"] / "shadow.glb", headers={"Content-Type": "model/gltf-binary"}
    )


async def ack(r):
    job = service.get(r.match_info["id"])
    if job["status"] == "succeeded":
        job["expiresAt"] = time.time() + 60
        service.save(job)
    return web.json_response({"ok": True})


async def startup(app):
    service.tasks = [
        asyncio.create_task(service.prepare()),
        asyncio.create_task(service.worker()),
        asyncio.create_task(service.cleanup()),
    ]
    if os.environ.get("GEN_RELAY_URL") or config.get("relayUrl"):
        from relay import run_relay

        service.tasks.append(asyncio.create_task(run_relay(service)))


async def shutdown(app):
    await service.stop_process()
    if service.preparation_process:
        await service.stop_process(service.preparation_process)
    for task in service.tasks:
        task.cancel()
    await asyncio.gather(*service.tasks, return_exceptions=True)


app = web.Application(middlewares=[security], client_max_size=LIMIT + 65536)
app.add_routes(
    [
        web.get("/health", health),
        web.get("/v1/info", info),
        web.get("/v1/capabilities", capabilities),
        web.post("/v1/jobs", submit),
        web.get("/v1/jobs/{id}", status),
        web.post("/v1/jobs/{id}/cancel", cancel),
        web.get("/v1/jobs/{id}/outputs/{output}", output),
        web.post("/v1/jobs/{id}/ack", ack),
    ]
)
app.on_startup.append(startup)
app.on_cleanup.append(shutdown)
if __name__ == "__main__":
    print(
        f"[generation] Configuration: {DATA_HOME / 'config.json'}; device detection starting",
        flush=True,
    )
    web.run_app(
        app,
        host="127.0.0.1",
        port=int(os.environ.get("GEN_PORT", "8765")),
        access_log=None,
    )
