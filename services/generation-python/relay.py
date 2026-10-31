"""Outbound authenticated worker connection; no public inbound port needed."""

import asyncio
import json
import os
import random
import secrets
import socket
from urllib.parse import urlparse
from aiohttp import ClientSession, ClientTimeout, WSMsgType
from config import config, DATA_HOME


async def run_relay(service):
    url = os.environ.get("GEN_RELAY_URL") or config.get("relayUrl")
    parsed = urlparse(url)
    if parsed.scheme != "wss" and not (
        parsed.scheme == "ws" and parsed.hostname in ("localhost", "127.0.0.1")
    ):
        print("[relay] Refusing non-TLS remote relay", flush=True)
        return
    base = ("https" if parsed.scheme == "wss" else "http") + "://" + parsed.netloc
    headers = {"Authorization": "Bearer " + config["deviceSecret"]}
    pairing = os.environ.get("GEN_PAIR") == "1"
    paired = False
    async with ClientSession(timeout=ClientTimeout(total=120)) as http:
        while True:
            try:
                async with http.ws_connect(
                    url, heartbeat=20, max_msg_size=256 * 1024
                ) as ws:
                    await ws.send_json(
                        {
                            "type": "auth",
                            "deviceId": config["deviceId"],
                            "secret": config["deviceSecret"],
                            "name": socket.gethostname(),
                        }
                    )
                    tasks = set()

                    async def handle(m):
                        args = m.get("args", {})
                        method = m.get("method")
                        try:
                            if method == "info":
                                result = service.info(
                                    args.get("providerId", "hunyuan-mini")
                                )
                            elif method == "capabilities":
                                result = service.capabilities()
                            elif method == "submit":
                                async with http.get(
                                    base
                                    + "/worker/files/"
                                    + args["relayJobId"]
                                    + "/input",
                                    headers=headers,
                                    allow_redirects=False,
                                ) as r:
                                    r.raise_for_status()
                                    chunks = []
                                    size = 0
                                    async for chunk in r.content.iter_chunked(65536):
                                        size += len(chunk)
                                        if size > 10 * 1024 * 1024:
                                            raise ValueError("Input too large")
                                        chunks.append(chunk)
                                    data = b"".join(chunks)
                                # Relay scopes each idempotency key to a task owned by one browser.
                                request = {
                                    **args["request"],
                                    "clientRequestId": "relay:" + args["relayJobId"],
                                }
                                result = await service.submit(request, data)
                            elif method == "status":
                                result = service.get(args["id"])
                            elif method == "cancel":
                                result = await service.cancel(args["id"])
                            elif method == "delete":
                                service.delete(args["id"])
                                result = {"ok": True}
                            elif method == "upload":
                                JOBS = DATA_HOME / "jobs"
                                job = service.get(args["id"])
                                if job["status"] != "succeeded":
                                    raise ValueError("Output not ready")
                                with (JOBS / job["id"] / "shadow.glb").open("rb") as f:
                                    async with http.post(
                                        base
                                        + "/worker/files/"
                                        + args["relayJobId"]
                                        + "/output",
                                        data=f,
                                        headers=headers,
                                        allow_redirects=False,
                                    ) as r:
                                        r.raise_for_status()
                                result = {"ok": True}
                            else:
                                raise ValueError("Unsupported relay operation")
                            await ws.send_json(
                                {"type": "rpc.result", "id": m["id"], "result": result}
                            )
                        except Exception as e:
                            await ws.send_json(
                                {
                                    "type": "rpc.result",
                                    "id": m["id"],
                                    "error": {
                                        "code": getattr(e, "code", "WORKER_ERROR"),
                                        "message": getattr(e, "message", str(e)),
                                        "status": getattr(e, "status", 502),
                                    },
                                }
                            )

                    async for raw in ws:
                        if raw.type != WSMsgType.TEXT:
                            continue
                        m = json.loads(raw.data)
                        if m["type"] == "authenticated":
                            print("[relay] Connected and authenticated", flush=True)
                            if pairing and not paired:
                                code = (
                                    os.environ.get("GEN_PAIR_CODE")
                                    or "".join(
                                        secrets.choice(
                                            "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
                                        )
                                        for _ in range(10)
                                    )
                                ).upper()
                                await ws.send_json({"type": "pair.code", "code": code})
                                print(
                                    "[relay] Pairing code (5 minutes, one use; grants access to this worker): " + code,
                                    flush=True,
                                )
                        elif m["type"] == "error":
                            print("[relay] " + m["message"], flush=True)
                        elif m["type"] == "pair.ready":
                            print("[relay] Pairing registration ready", flush=True)
                        elif m["type"] == "pair.used":
                            paired = True
                            print("[relay] Browser connected. The pairing code has been used.", flush=True)
                        elif m["type"] == "rpc":
                            t = asyncio.create_task(handle(m))
                            tasks.add(t)
                            t.add_done_callback(tasks.discard)
                    # Finish in-flight local actions; their durable job IDs survive reconnects.
                    if tasks:
                        await asyncio.gather(*tasks, return_exceptions=True)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                print("[relay] Reconnecting: " + str(e), flush=True)
            await asyncio.sleep(3 + random.random() * 3)
