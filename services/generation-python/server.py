"""Generation-only HTTP service. Assets belong to the caller, never this service."""

import asyncio
import hashlib
import math
import io
import json
import os
from pathlib import Path
import secrets
import signal
import sys
import time
import uuid
from aiohttp import web
from config import DATA_HOME, config, atomic_json
from providers import PROVIDERS
from model_catalog import MODELS, enabled_models, image_encoder_precision
from policy import plan
from worker_client import WorkerClient
from network import allowed_origins, host_allowed, listen_host, service_urls

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
        self.wake = asyncio.Event()
        self.compute_lock = asyncio.Lock()
        self.children = set()
        self.residents = {}
        self.clocks = {}
        self.enabled = enabled_models()
        self.precision = None
        self.memory = {}
        self.policy = {}
        self.device = None
        self.backend = None
        self.device_reason = "Device detection in progress"
        self.process = None
        self.running = None
        self.provider_states = {
            p.id: {'state': ('preparing' if p.id in self.enabled else 'disabled') if p.needs_model else 'ready',
                   'error': None, 'acceptsJobs': not p.needs_model or p.id in self.enabled,
                   'tags': [MODELS[p.id]['tag']] if p.id in MODELS else []}
            for p in PROVIDERS.values()
        }
        self.tasks = []
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

    async def spawn(self, *command, **kwargs):
        process = await asyncio.create_subprocess_exec(*command, start_new_session=os.name != 'nt', **kwargs)
        self.children.add(process)
        return process

    def env(self, provider):
        return {**os.environ, 'GEN_DEVICE': self.backend or 'cpu', 'GEN_PROVIDER': provider,
                'GEN_PRECISION': self.precision or 'fp32', 'PYTORCH_ENABLE_MPS_FALLBACK': '0', 'PYTHONIOENCODING': 'utf-8'}

    async def read_json(self, command, env=None):
        process = await self.spawn(*command, env=env, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        try:
            out, error = await asyncio.wait_for(process.communicate(), 60)
            if process.returncode: raise RuntimeError(error.decode('utf-8', 'replace')[-1500:])
            return json.loads(out)
        finally:
            if process.returncode is None: await self.stop_process(process)
            self.children.discard(process)

    def provider_failed(self, id, error):
        self.provider_states[id].update(state='failed', error=error, acceptsJobs=False, tags=[MODELS[id]['tag']] if id in MODELS else [])
        for job in self.jobs.values():
            if job['providerId'] == id and job['status'] == 'queued':
                job.update(status='failed', phase='preparation-failed', error={'code': 'PREPARATION_FAILED', 'message': error, 'retryable': True})
                self.complete(job)
        self.wake.set()

    def print_table(self, detection=None):
        def memory(value): return f'{value / 1024**3:.2f} GiB' if value is not None else '未知'
        rows = [('操作系统', self.memory.get('os', sys.platform), ''),
                ('处理器', self.memory.get('processor', '未知'), ''),
                ('显卡', self.memory.get('gpu') or ', '.join((detection or {}).get('detected', [])) or '未知', ''),
                ('系统内存', memory(self.memory.get('systemTotal')), '当前可用 ' + memory(self.memory.get('systemAvailable'))),
                ('推理设备', self.device or '未确定', self.device_reason),
                ('计算后端', self.backend or '未确定', '启动固定；执行失败不切换'),
                ('采样/解码精度', self.precision or '未确定', '图像编码精度按模型另列'),
                ('输入预处理', 'CPU FP32', '固定抗锯齿缩放/裁剪/归一化；模型不切换设备'),
                ('容量预算', memory(self.policy.get('budgetBytes')), '统一内存不重复计入'),
                ('计划峰值', memory(self.policy.get('plannedPeakBytes')), '参数估计 + 工作区 + 加载余量；不是实测峰值')]
        for id in self.enabled:
            state = self.provider_states[id]
            rows += [('模型', PROVIDERS[id].name, state['state']),
                     ('运行策略', state.get('strategy', '未确定'), PROVIDERS[id].name),
                     ('图像编码精度', state.get('imageEncoderPrecision', '未确定'), PROVIDERS[id].name + '；启动固定'),
                     ('FlashVDM 配置', '关闭' if MODELS[id]['series'] == '2.1' else '开启', '完整 VAE 分层解码' if MODELS[id]['series'] == '2.1' else 'Turbo VAE + KV 裁剪')]
        rows += [('服务地址', url, 'HTTP 可用与模型就绪分开') for url in service_urls()]
        print('\n类别 | 当前值 | 备注\n' + '\n'.join(' | '.join(' '.join(str(value).splitlines()) for value in row) for row in rows), flush=True)
        print(f"[generation] Credentials/configuration: {DATA_HOME / 'config.json'}", flush=True)

    async def prepare(self):
        detection = None
        try:
            detection = await self.read_json([sys.executable, str(ROOT / 'device.py')])
            self.device, self.backend, self.device_reason = detection['deviceType'], detection['backend'], detection['reason']
            self.precision = os.environ.get('GEN_PRECISION', 'fp32' if self.backend == 'cpu' else 'fp16')
            available = []
            for id in self.enabled:
                started = time.monotonic()
                try:
                    process = await self.spawn(*PROVIDERS[id].prepare_command())
                    if await process.wait(): raise RuntimeError('Resource preparation failed; resolve the reported checksum/download error and restart')
                    self.children.discard(process)
                    self.provider_states[id]['preparationSeconds'] = time.monotonic() - started
                    available.append(id)
                except Exception as error: self.provider_failed(id, str(error))
            if available:
                self.memory = await self.read_json([sys.executable, str(ROOT / 'policy.py')], self.env(available[0]))
                self.policy = plan(available, self.backend, self.precision, self.memory, os.environ.get('GEN_STRATEGY', 'auto'))
                for id, error in self.policy['errors'].items(): self.provider_failed(id, error)
                for id, strategy in self.policy['strategies'].items():
                    self.provider_states[id]['strategy'] = strategy
                    self.provider_states[id]['precision'] = self.precision
                    self.provider_states[id]['imageEncoderPrecision'] = image_encoder_precision(id, self.backend, self.precision)
                    if id == 'hunyuan-mini' and strategy == 'resident' and self.backend == 'mps' and self.precision == 'fp16':
                        self.provider_states[id]['tags'] = ['推荐', MODELS[id]['tag']]
            self.print_table(detection)
            for id, strategy in self.policy.get('strategies', {}).items():
                state = self.provider_states[id]
                try:
                    if strategy == 'resident':
                        state['state'] = 'loading'
                        async with self.compute_lock:
                            client = WorkerClient(self, id, self.env(id))
                            self.residents[id] = client
                            state.update(await client.start())
                            state.pop('event', None)
                    state['state'] = 'ready'
                    print(f"[模型] {PROVIDERS[id].name} 已就绪 | {strategy}", flush=True)
                    self.wake.set()
                except Exception as error:
                    self.provider_failed(id, str(error))
                    if id in self.residents: await self.residents[id].close()
        except Exception as error:
            self.device_reason = str(error)
            for id in self.enabled: self.provider_failed(id, str(error))
            self.print_table(detection)

    def complete(self, job):
        if job.get('_logged'): return
        clock = self.clocks.pop(job['id'], None)
        if clock:
            now = time.monotonic()
            total = now - clock[0]
            execution = now - clock[1] if clock[1] is not None else 0.
            job['timings'] = dict(totalSeconds=total, executionSeconds=execution, queueSeconds=max(0., total-execution))
            if job.get('result'): job['result']['timings'] = job['timings']
            print(f"[任务 {job['id']}] {job['status']} | 总耗时 {total:.2f} 秒 | 执行 {execution:.2f} 秒" + (f" | {job['error']['message']}" if job.get('error') else ''), flush=True)
        job['expiresAt'] = time.time() + 86400
        job['_logged'] = True
        self.save(job)

    async def submit(self, request, image):
        received = time.monotonic()
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
        if not provider_state["acceptsJobs"]:
            raise Fault(
                "PROVIDER_NOT_READY",
                provider_state["error"] or provider_state["state"],
                503,
            )
        if sum(j["status"] == "queued" for j in self.jobs.values()) >= 8:
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
        self.clocks[id] = [received, None]
        print(f'[任务 {id}] 已排队，等待模型与执行空位', flush=True)
        self.wake.set()
        return job

    def get(self, id):
        if id not in self.jobs:
            raise Fault("NOT_FOUND", "Unknown task", 404)
        return self.jobs[id]

    async def cancel(self, id):
        job = self.get(id)
        if job['status'] in TERMINAL: return job
        if job['status'] == 'queued':
            job.update(status='cancelled', phase='cancelled')
            self.complete(job)
        else:
            job['status'] = 'cancel_requested'
            (JOBS / id / 'cancel').touch()
            self.save(job)
            if self.running == id and self.process: await self.stop_process(self.process)
        self.wake.set()
        return job

    async def stop_process(self, p=None):
        p = p or self.process
        if not p or p.returncode is not None: return
        if os.name == 'nt':
            killer = await asyncio.create_subprocess_exec('taskkill', '/PID', str(p.pid), '/T', '/F', stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
            await asyncio.wait_for(killer.wait(), 10)
        else:
            try: os.killpg(p.pid, signal.SIGTERM)
            except ProcessLookupError: pass
        try: await asyncio.wait_for(p.wait(), 5)
        except asyncio.TimeoutError:
            if os.name != 'nt':
                try: os.killpg(p.pid, signal.SIGKILL)
                except ProcessLookupError: pass
            else:
                p.kill()
            await asyncio.wait_for(p.wait(), 5)
        self.children.discard(p)

    async def staged(self, folder, job):
        self.process = await self.spawn(sys.executable, '-u', str(ROOT / 'generate.py'), str(folder),
            env=self.env(job['providerId']), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        if job['status'] == 'cancel_requested':
            await self.stop_process(self.process)
            return {'status': 'cancelled'}
        tail = []
        with (folder / 'execution.log').open('a') as log:
            async for raw in self.process.stdout:
                line = raw.decode('utf-8', 'replace').strip()
                log.write(line + '\n'); log.flush()
                tail = (tail + [line])[-30:]
                try:
                    event = json.loads(line)
                    if 'phase' in event:
                        job['phase'] = event['phase']; self.save(job)
                except (ValueError, TypeError): pass
        code = await self.process.wait()
        self.children.discard(self.process)
        if job['status'] == 'cancel_requested': return {'status': 'cancelled'}
        if code: raise RuntimeError('\n'.join(tail)[-1500:])
        return {'status': 'succeeded'}

    def result(self, folder, job):
        import struct
        meta = json.loads((folder / 'output.json').read_text())
        output_path = folder / 'shadow.glb'
        if not 20 <= output_path.stat().st_size <= 128*1024*1024: raise ValueError('Invalid GLB output size')
        output = output_path.read_bytes()
        if struct.unpack('<4sII', output[:12]) != (b'glTF', 2, len(output)):
            raise ValueError('Invalid GLB output')
        bounds = meta.get('bounds')
        if (type(meta.get('triangles')) is not int or not 1 <= meta['triangles'] <= job['parameters']['targetFaces']
            or not isinstance(bounds, list) or len(bounds) != 2 or any(not isinstance(row, list) or len(row) != 3 for row in bounds)
            or not all(type(v) in (int, float) and math.isfinite(v) for row in bounds for v in row)
            or any(bounds[0][i] > bounds[1][i] for i in range(3))):
            raise ValueError('Invalid geometry metadata')
        gpu = PROVIDERS[job['providerId']].supports_gpu and self.device == 'gpu'
        return {**meta, 'protocolVersion': 1, 'jobId': job['id'], 'providerId': job['providerId'],
            'providerVersion': PROVIDERS[job['providerId']].version, 'parameters': job['parameters'],
            'deviceType': 'gpu' if gpu else 'cpu', 'backend': self.backend if gpu else 'cpu',
            'precision': self.precision if PROVIDERS[job['providerId']].needs_model else 'fp32',
            'imageEncoderPrecision': image_encoder_precision(job['providerId'], self.backend, self.precision) if PROVIDERS[job['providerId']].needs_model else 'fp32',
            'strategy': self.provider_states[job['providerId']].get('strategy', 'staged'),
            'inputSha256': job['inputSha256'], 'outputs': [{'id': 'shadow', 'mime': 'model/gltf-binary', 'bytes': len(output), 'sha256': hashlib.sha256(output).hexdigest()}]}

    async def worker(self):
        while True:
            self.wake.clear()
            # A preparing model must not head-of-line block another ready model.
            job = next((j for j in self.jobs.values() if j['status'] == 'queued' and self.provider_states[j['providerId']]['state'] == 'ready'), None)
            if job is None:
                await self.wake.wait()
                continue
            async with self.compute_lock:
                if job['status'] != 'queued': continue
                if self.provider_states[job['providerId']]['state'] != 'ready': continue
                self.running = job['id']
                self.clocks[job['id']][1] = time.monotonic()
                job.update(status='running', phase='starting')
                self.save(job)
                print(f"[任务 {job['id']}] 开始生成", flush=True)
                folder = JOBS / job['id']
                try:
                    client = self.residents.get(job['providerId'])
                    event = await client.run(folder, job) if client else await self.staged(folder, job)
                    if event['status'] == 'cancelled' or job['status'] == 'cancel_requested':
                        job.update(status='cancelled', phase='cancelled')
                    elif event['status'] != 'succeeded': raise RuntimeError(event.get('error', 'Inference failed'))
                    else: job.update(status='succeeded', phase='complete', result=self.result(folder, job))
                except asyncio.CancelledError:
                    raise
                except Exception as error:
                    if job['status'] == 'cancel_requested': job.update(status='cancelled', phase='cancelled')
                    else: job.update(status='failed', phase='failed', error={'code': 'GENERATION_FAILED', 'message': str(error), 'retryable': True})
                finally:
                    if job['status'] in TERMINAL: self.complete(job)
                    self.process = None
                    self.running = None

    async def close(self):
        for task in self.tasks: task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        for client in self.residents.values(): await client.close()
        for process in list(self.children): await self.stop_process(process)
        for job in self.jobs.values():
            if job['status'] not in TERMINAL:
                job.update(status='failed', phase='interrupted', error={'code': 'INTERRUPTED', 'message': 'Service stopped; resubmit explicitly.', 'retryable': True})
                self.complete(job)

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
    origins = allowed_origins()
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
    local = request.transport.get_extra_info("sockname")
    if not local or not host_allowed(request.host, local[0]):
        return web.json_response({"error": {"code": "HOST_DENIED", "message": "Service host not allowed"}}, status=403, headers=headers)
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
    print("[生成服务] HTTP 接口启动；模型在后台准备", flush=True)
    service.tasks = [
        asyncio.create_task(service.prepare()),
        asyncio.create_task(service.worker()),
        asyncio.create_task(service.cleanup()),
    ]
    # Only explicit legacy clients opt into relay; saved config must not connect
    # a direct API deployment to an old relay in the background.
    if os.environ.get("GEN_RELAY_URL"):
        from relay import run_relay

        service.tasks.append(asyncio.create_task(run_relay(service)))


async def shutdown(app):
    await service.close()


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
    host = listen_host()
    allowed_origins()
    print(
        f"[generation] Configuration: {DATA_HOME / 'config.json'}; device detection starting",
        flush=True,
    )
    web.run_app(
        app,
        host=host,
        port=int(os.environ.get("GEN_PORT", "8765")),
        access_log=None,
    )
