"""Real HTTP + outbound relay integration, with the CPU silhouette provider."""

import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import ssl
import shutil
import sys
import tempfile
import time
import unittest
import urllib.request
import urllib.error
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CLIENT_CONTEXT = None


def call(base, path, token="", method="GET", data=None, headers=None):
    h = {**(headers or {})}
    if token:
        h["Authorization"] = "Bearer " + token
    if isinstance(data, dict):
        data = json.dumps(data).encode()
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(base + path, data=data, method=method, headers=h)
    try:
        r = urllib.request.urlopen(req, timeout=40, context=CLIENT_CONTEXT)
    except urllib.error.HTTPError as e:
        r = e
    body = r.read()
    ctype = r.headers.get("Content-Type", "")
    return r.status, json.loads(body) if "json" in ctype else body


def multipart(request, image):
    boundary = "generation-integration-boundary"
    data = (
        (
            f'--{boundary}\r\nContent-Disposition: form-data; name="request"\r\n\r\n'
            + json.dumps(request)
            + f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="input.png"\r\nContent-Type: image/png\r\n\r\n'
        ).encode()
        + image
        + f"\r\n--{boundary}--\r\n".encode()
    )
    return data, {"Content-Type": "multipart/form-data; boundary=" + boundary}


class GenerationIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        global CLIENT_CONTEXT
        cls.temp = tempfile.TemporaryDirectory(prefix="g-studio-generation-")
        cls.home = Path(cls.temp.name)
        cls.base = "http://127.0.0.1:18765"
        cls.relay = "http://127.0.0.1:18787"
        cls.processes = []
        env = {
            **os.environ,
            "GEN_HOME": str(cls.home / "resources"),
            "GEN_DATA_HOME": str(cls.home / "worker"),
            "GEN_PORT": "18765",
            "GEN_SKIP_MODEL": "1",
            "GEN_RELAY_URL": "ws://127.0.0.1:18787/generation/worker",
            "GEN_PAIR": "1",
            "GEN_PAIR_CODE": "TEST8765AB",
            "PYTHONIOENCODING": "utf-8",
            "RELAY_HOME": str(cls.home / "relay"),
            "RELAY_PORT": "18787",
        }
        if os.environ.get("GENERATION_TEST_TLS") == "1":
            executable = shutil.which("openssl")
            if not executable:
                git = shutil.which("git")
                candidate = (
                    Path(git).parents[1] / "usr/bin/openssl.exe"
                    if git
                    else Path("missing")
                )
                if candidate.exists():
                    executable = str(candidate)
            if not executable:
                raise RuntimeError(
                    "TLS test requires OpenSSL (Git for Windows includes it)"
                )
            cert = cls.home / "test-cert.pem"
            key = cls.home / "test-key.pem"
            cnf = cls.home / "openssl.cnf"
            cnf.write_text("[req]\ndistinguished_name=dn\n[dn]\n")
            subprocess.run(
                [
                    executable,
                    "req",
                    "-x509",
                    "-newkey",
                    "rsa:2048",
                    "-nodes",
                    "-days",
                    "1",
                    "-keyout",
                    str(key),
                    "-out",
                    str(cert),
                    "-subj",
                    "/CN=localhost",
                    "-addext",
                    "subjectAltName=DNS:localhost,IP:127.0.0.1",
                    "-config",
                    str(cnf),
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            CLIENT_CONTEXT = ssl.create_default_context(cafile=str(cert))
            cls.relay = "https://127.0.0.1:18787"
            env.update(
                GEN_RELAY_URL="wss://127.0.0.1:18787/generation/worker",
                RELAY_TLS_CERT=str(cert),
                RELAY_TLS_KEY=str(key),
                SSL_CERT_FILE=str(cert),
            )
        cls.logs = []
        recovered = cls.home / "worker/jobs/00000000-0000-4000-8000-000000000001"
        recovered.mkdir(parents=True)
        (recovered / "job.json").write_text(
            json.dumps(
                {
                    "id": recovered.name,
                    "status": "running",
                    "phase": "encode",
                    "clientRequestId": "interrupted-fixture",
                    "fingerprint": "fixture",
                    "createdAt": time.time(),
                    "expiresAt": None,
                }
            )
        )

        def start(args, name):
            log = (cls.home / name).open("w", encoding="utf-8")
            cls.logs.append(log)
            p = subprocess.Popen(
                args,
                cwd=ROOT,
                env=env,
                stdin=subprocess.PIPE,
                stdout=log,
                stderr=subprocess.STDOUT,
            )
            cls.processes.append(p)
            return p

        cls.start_process = staticmethod(start)
        cls.relay_process = start(
            ["node", "--import", "tsx", "services/generation-relay/server.ts"],
            "relay.log",
        )
        cls.worker = start(
            [sys.executable, "-u", "services/generation-python/server.py"], "worker.log"
        )
        for base in [cls.base, cls.relay]:
            deadline = time.time() + 90
            while True:
                try:
                    if call(base, "/health")[0] == 200:
                        break
                except Exception:
                    pass
                if time.time() > deadline:
                    raise RuntimeError("Service startup timed out: " + base)
                time.sleep(0.2)
        cls.token = json.loads((cls.home / "worker/config.json").read_text())["token"]
        out = io.BytesIO()
        Image.new("RGBA", (12, 16), (150, 100, 80, 255)).save(out, format="PNG")
        cls.image = out.getvalue()
        cls.request = {
            "protocolVersion": 1,
            "providerId": "silhouette",
            "clientRequestId": "direct-idempotency",
            "inputSha256": hashlib.sha256(cls.image).hexdigest(),
            "targetFaces": 1000,
        }

    @classmethod
    def tearDownClass(cls):
        for p in cls.processes:
            p.terminate()
            try:
                p.wait(timeout=10)
            except subprocess.TimeoutExpired:
                p.kill()
                p.wait()
        for log in cls.logs:
            log.close()
        # Keep logs for failed-run diagnosis and publish only a summary in CI output.
        print("Integration artifacts:", cls.home)
        cls.temp.cleanup()

    def wait_job(self, base, token, id):
        deadline = time.time() + 90
        while time.time() < deadline:
            code, j = call(base, "/v1/jobs/" + id, token)
            self.assertEqual(code, 200, j)
            if j["status"] in ["succeeded", "failed", "cancelled"]:
                return j
            time.sleep(0.25)
        self.fail("Task timed out")

    def test_01_direct_contract_and_idempotency(self):
        code, recovered = call(
            self.base, "/v1/jobs/00000000-0000-4000-8000-000000000001", self.token
        )
        self.assertEqual(code, 200)
        self.assertEqual(recovered["status"], "failed")
        self.assertEqual(recovered["error"]["code"], "INTERRUPTED")
        self.assertGreater(recovered["expiresAt"], time.time())
        self.assertEqual(call(self.base, "/v1/info")[0], 401)
        self.assertEqual(
            call(
                self.base,
                "/v1/info",
                self.token,
                headers={"Origin": "https://untrusted.example"},
            )[0],
            403,
        )
        self.assertEqual(
            call(self.base, "/v1/info?providerId=silhouette", self.token),
            (200, {"deviceType": "cpu"}),
        )
        payload, headers = multipart(self.request, self.image)
        code, job = call(self.base, "/v1/jobs", self.token, "POST", payload, headers)
        self.assertEqual(code, 202, job)
        code, again = call(self.base, "/v1/jobs", self.token, "POST", payload, headers)
        self.assertEqual(again["id"], job["id"])
        other, h = multipart({**self.request, "seed": 42}, self.image)
        self.assertEqual(
            call(self.base, "/v1/jobs", self.token, "POST", other, h)[0], 409
        )
        done = self.wait_job(self.base, self.token, job["id"])
        self.assertEqual(done["status"], "succeeded", done)
        code, binary = call(
            self.base, "/v1/jobs/" + job["id"] + "/outputs/shadow", self.token
        )
        self.assertEqual(code, 200)
        self.assertEqual(binary[:4], b"glTF")
        self.assertEqual(
            hashlib.sha256(binary).hexdigest(), done["result"]["outputs"][0]["sha256"]
        )

        malformed, h = multipart(
            {**self.request, "clientRequestId": "bad", "parameters": {"arbitrary": 1}},
            self.image,
        )
        self.assertEqual(
            call(self.base, "/v1/jobs", self.token, "POST", malformed, h)[0], 400
        )

    def test_02_relay_pairing_output_and_isolation(self):
        # Do not consume the invalid-code rate limit while the worker connects.
        deadline = time.time() + 30
        while "Pairing registration ready" not in (self.home / "worker.log").read_text():
            if time.time() > deadline:
                self.fail("Worker did not register the pairing code")
            time.sleep(0.1)
        deadline = time.time() + 30
        while True:
            code, pair = call(
                self.relay, "/v1/pair", method="POST", data={"code": "TEST8765AB"}
            )
            if code == 200:
                break
            if time.time() > deadline:
                self.fail(str(pair))
            time.sleep(1)
        approval = pair
        self.assertEqual(approval["state"], "approved", approval)
        token = approval["token"]
        device = approval["deviceId"]
        self.assertEqual(
            call(self.relay, f"/v1/devices/{device}/info?providerId=silhouette", token),
            (200, {"deviceType": "cpu"}),
        )
        payload, h = multipart(
            {**self.request, "clientRequestId": "relay-task"}, self.image
        )
        code, job = call(self.relay, "/v1/jobs", token, "POST", payload, h)
        self.assertEqual(code, 202, job)
        done = self.wait_job(self.relay, token, job["id"])
        self.assertFalse((self.home / "relay" / (job["id"] + ".input")).exists())
        worker_secret = json.loads((self.home / "worker/config.json").read_text())["deviceSecret"]
        self.assertEqual(call(self.relay, "/worker/files/" + job["id"] + "/input", worker_secret)[0], 410)
        self.assertEqual(done["status"], "succeeded", done)
        self.assertEqual(
            call(self.relay, "/v1/jobs/" + job["id"], "wrong-token")[0], 401
        )
        code, binary = call(
            self.relay, "/v1/jobs/" + job["id"] + "/outputs/shadow", token
        )
        self.assertEqual(code, 200, binary)
        self.assertEqual(binary[:4], b"glTF")
        self.assertFalse((self.home / "relay" / (job["id"] + ".output")).exists())
        # Delivery releases the public buffer; retry re-fetches from the local worker.
        again_code, again = call(self.relay, "/v1/jobs/" + job["id"] + "/outputs/shadow", token)
        self.assertEqual(again_code, 200)
        self.assertEqual(again, binary)
        self.assertEqual(
            hashlib.sha256(binary).hexdigest(), done["result"]["outputs"][0]["sha256"]
        )
        self.relay_process.terminate()
        self.relay_process.wait(timeout=10)
        type(self).relay_process = self.start_process(
            ["node", "--import", "tsx", "services/generation-relay/server.ts"],
            "relay-restart.log",
        )
        deadline = time.time() + 40
        while True:
            try:
                code, info = call(
                    self.relay,
                    f"/v1/devices/{device}/info?providerId=silhouette",
                    token,
                )
                if code == 200:
                    break
            except Exception:
                pass
            if time.time() > deadline:
                self.fail("Worker did not reconnect after relay restart")
            time.sleep(0.5)
        self.assertEqual(info, {"deviceType": "cpu"})
        code, replayed = call(self.relay, "/v1/jobs", token, "POST", payload, h)
        self.assertEqual(code, 202, replayed)
        self.assertEqual(replayed["id"], job["id"])
        self.assertEqual(
            call(self.relay, f"/v1/devices/{device}", token, "DELETE")[0], 200
        )
        self.assertEqual(call(self.relay, f"/v1/devices/{device}/info", token)[0], 401)

    def test_03_cancellation_and_input_limits(self):
        jobs = []
        for i in range(3):
            body, h = multipart(
                {
                    **self.request,
                    "clientRequestId": "cancel-" + str(i),
                    "targetFaces": 40000,
                },
                self.image,
            )
            code, job = call(self.base, "/v1/jobs", self.token, "POST", body, h)
            self.assertEqual(code, 202, job)
            jobs.append(job)
        code, cancelled = call(
            self.base, "/v1/jobs/" + jobs[-1]["id"] + "/cancel", self.token, "POST"
        )
        self.assertEqual(code, 200)
        self.assertEqual(cancelled["status"], "cancelled")
        self.assertEqual(
            call(
                self.base, "/v1/jobs/" + jobs[-1]["id"] + "/cancel", self.token, "POST"
            )[1]["status"],
            "cancelled",
        )
        for job in jobs[:-1]:
            call(self.base, "/v1/jobs/" + job["id"] + "/cancel", self.token, "POST")
        out = io.BytesIO()
        Image.new("RGB", (8, 8)).save(out, format="BMP")
        image = out.getvalue()
        body, h = multipart(
            {
                **self.request,
                "clientRequestId": "bmp",
                "inputSha256": hashlib.sha256(image).hexdigest(),
            },
            image,
        )
        self.assertEqual(
            call(self.base, "/v1/jobs", self.token, "POST", body, h)[0], 400
        )

        body, h = multipart(
            {**self.request, "clientRequestId": "digest", "inputSha256": "0" * 64},
            self.image,
        )
        self.assertEqual(
            call(self.base, "/v1/jobs", self.token, "POST", body, h)[0], 400
        )

    def test_04_pair_failures_block_ip_and_ignore_untrusted_forwarded_header(self):
        responses = []
        for i in range(5):
            code, data = call(self.relay, "/v1/pair", method="POST", data={"code": "INVALID!"})
            responses.append((code, data))
        self.assertEqual(responses[-1][0], 429)
        self.assertEqual(responses[-1][1]["error"]["code"], "PAIR_BLOCKED")
        code, data = call(self.relay, "/v1/pair", method="POST", data={"code":"TEST8765AB"}, headers={"X-Forwarded-For":"203.0.113.42"})
        self.assertEqual(code, 429)
        self.assertEqual(data["error"]["code"], "PAIR_BLOCKED")



if __name__ == "__main__":
    unittest.main(verbosity=2)
