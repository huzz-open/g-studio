import http from "node:http";
import https from "node:https";
import { WebSocketServer, WebSocket } from "ws";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { EphemeralFiles } from "./ephemeral-files.js";
import { PairFailureGuard, clientAddress } from "./pair-security.js";

const home = resolve(
  process.env.RELAY_HOME || join(homedir(), ".g-studio/relay"),
);
mkdirSync(home, { recursive: true });
const dbFile = join(home, "state.json"),
  db: any = existsSync(dbFile)
    ? JSON.parse(readFileSync(dbFile, "utf8"))
    : { devices: {}, sessions: {}, jobs: {} };
const hash = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
function save() {
  writeFileSync(dbFile + ".tmp", JSON.stringify(db));
  renameSync(dbFile + ".tmp", dbFile);
}
const connections = new Map<string, WebSocket>(),
  pending = new Map<
    string,
    {
      device: string;
      resolve: (v: any) => void;
      reject: (e: any) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
const codes = new Map<
    string,
    { device: string; expires: number }
  >(),
  usedCodes = new Map<string, number>(),
  rates = new Map<string, { count: number; reset: number }>();
function fail(code: string, message: string, status = 400): never {
  throw Object.assign(Error(message), { code, status });
}
const storageLimit = Number(process.env.RELAY_MAX_MEMORY_MB || process.env.RELAY_MAX_STORAGE_MB || 512) * 1024 * 1024;
const payloads = new EphemeralFiles(storageLimit);
const pairFailures = new PairFailureGuard();
const trustedProxies = (process.env.RELAY_TRUSTED_PROXIES || '').split(',').filter(Boolean);
const outputTransfers = new Map<string, Promise<any>>();
const uploading = new Set<string>();
// Remove only known legacy relay payloads when upgrading from disk transfers.
for (const j of Object.values<any>(db.jobs)) {
  if (!/^[a-f0-9-]{36}$/.test(j.id)) continue;
  for (const suffix of ['input', 'output', 'output.tmp']) {
    const file = join(home, j.id + '.' + suffix);
    if (existsSync(file)) unlinkSync(file);
  }
}
function clearPayloads(id: string) { payloads.delete(id+'.input'); payloads.delete(id+'.output'); }
function sendPayload(res: http.ServerResponse, key: string, type: string, consume: boolean) {
  const lease = payloads.acquire(key);
  if (!lease) fail('TRANSFER_EXPIRED', 'Transfer buffer expired; retry the upload', 410);
  let released = false;
  const done = () => {
    if (released) return;
    released = true;
    if (consume) payloads.delete(key);
    lease.release();
  };
  res.once('close', done);
  res.writeHead(200, { 'Content-Type':type, 'Content-Length':lease.data.length, 'Cache-Control':'no-store', 'X-Accel-Buffering':'no' });
  res.end(lease.data, done);
}
function rpc(device: string, method: string, args: any = {}): Promise<any> {
  const ws = connections.get(device);
  if (!ws || ws.readyState !== WebSocket.OPEN)
    return Promise.reject(
      Object.assign(Error("Device offline"), {
        code: "DEVICE_OFFLINE",
        status: 503,
      }),
    );
  return new Promise((resolve, reject) => {
    const id = randomUUID(),
      timer = setTimeout(() => {
        pending.delete(id);
        reject(
          Object.assign(Error("Worker response timed out"), {
            code: "DEVICE_TIMEOUT",
            status: 504,
          }),
        );
      }, 30000);
    pending.set(id, { device, resolve, reject, timer });
    ws.send(JSON.stringify({ type: "rpc", id, method, args }));
  });
}
async function bytes(req: http.IncomingMessage, max: number) {
  const parts: Buffer[] = [];
  let length = 0;
  for await (const p of req) {
    length += p.length;
    if (length > max) fail("INPUT_LIMIT", "Request too large", 413);
    parts.push(p);
  }
  return Buffer.concat(parts);
}
const bearer = (req: http.IncomingMessage) =>
  (req.headers.authorization || "").replace(/^Bearer /, "");
function session(req: http.IncomingMessage) {
  const s = db.sessions[hash(bearer(req))];
  if (!s || s.expires < Date.now())
    fail("UNAUTHORIZED", "Pair this browser first", 401);
  return s;
}
function owner(req: http.IncomingMessage, device: string) {
  const s = session(req);
  if (s.device !== device)
    fail("FORBIDDEN", "Device belongs to another session", 403);
  return s;
}
function worker(req: http.IncomingMessage, device: string) {
  const d = db.devices[device];
  if (!d || d.secretHash !== hash(bearer(req)))
    fail("UNAUTHORIZED", "Worker authentication failed", 401);
}
function jobFor(req: http.IncomingMessage, id: string) {
  const j = db.jobs[id];
  if (!j) fail("NOT_FOUND", "Unknown job", 404);
  const s = owner(req, j.device);
  if (j.session !== s.id)
    fail("FORBIDDEN", "Task belongs to another session", 403);
  return j;
}
function json(res: http.ServerResponse, value: any, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}
function limited(key: string, limit = 20) {
  const now = Date.now();
  let r = rates.get(key);
  if (!r || r.reset < now) {
    r = { count: 0, reset: now + 60000 };
    rates.set(key, r);
  }
  if (++r.count > limit) fail("RATE_LIMIT", "Too many attempts", 429);
}
async function dispatch(j: any) {
  const response = await rpc(j.device, "submit", {
    relayJobId: j.id,
    request: j.request,
  });
  payloads.delete(j.id + ".input");
  j.workerId = response.id;
  j.snapshot = response;
  save();
  return { ...response, id: j.id };
}
async function handler(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const origin = req.headers.origin,
      allowed = (
        process.env.RELAY_ORIGINS ||
        "http://127.0.0.1:5173,http://localhost:5173"
      ).split(",");
    if (origin && !allowed.includes(origin))
      fail("ORIGIN_DENIED", "Origin not allowed", 403);
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization,Content-Type",
      );
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const u = new URL(req.url!, "http://relay"),
      p = u.pathname;
    if (p === "/health") {
      json(res, { status: "ok", protocol: "g-studio/relay", version: 1 });
      return;
    }
    if (p === "/v1/pair" && req.method === "POST") {
      const ip = clientAddress(req.socket.remoteAddress || '', typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : undefined, trustedProxies);
      pairFailures.check(ip);
      limited("pair:" + ip, 10);
      limited("pair-global", 100);
      let key: string;
      try { key = String(JSON.parse((await bytes(req, 4096)).toString()).code || '').trim().toUpperCase(); }
      catch { pairFailures.failed(ip); fail('PAIR_INVALID', 'Invalid pairing request', 400); }
      const entry = codes.get(key);
      if (!/^[A-Z0-9]{10}$/.test(key) || !entry || entry.expires < Date.now()) {
        pairFailures.failed(ip);
        fail("PAIR_INVALID", "Invalid or expired pairing code", 404);
      }
      const ws = connections.get(entry.device);
      if (!ws || ws.readyState !== WebSocket.OPEN) fail("DEVICE_OFFLINE", "Device offline", 503);
      // Consuming a code and granting access happen without awaiting another task:
      // two concurrent claimants cannot both use the same code.
      codes.delete(key);
      usedCodes.set(hash(key), entry.expires);
      const token = randomBytes(32).toString("base64url");
      db.sessions[hash(token)] = {
        id: randomUUID(), device: entry.device, expires: Date.now() + 30 * 86400000,
      };
      save();
      ws.send(JSON.stringify({ type: 'pair.used' }));
      json(res, { state: 'approved', token, deviceId: entry.device });
      return;
    }
    if (p === "/v1/devices" && req.method === "GET") {
      const s = session(req),
        d = db.devices[s.device];
      json(res, {
        devices: d
          ? [{ id: s.device, name: d.name, online: connections.has(s.device) }]
          : [],
      });
      return;
    }
    const deviceMatch = p.match(
      /^\/v1\/devices\/([a-f0-9]+)(?:\/(info|capabilities))?$/,
    );
    if (deviceMatch) {
      const [, id, action] = deviceMatch;
      const grant = owner(req, id!);
      if (req.method === "DELETE") {
        for (const [k, s] of Object.entries<any>(db.sessions))
          if (s.id === grant.id) delete db.sessions[k];
        for (const j of Object.values<any>(db.jobs))
          if (j.session === grant.id && j.workerId) {
            j.cancelRequested = true;
            j.revoked = true;
            void rpc(id!, "cancel", { id: j.workerId })
              .then((result) => {
                j.snapshot = result;
                j.cancelRequested = false;
                if (j.revoked) delete db.jobs[j.id];
                save();
              })
              .catch(() => {});
          }
        for (const j of Object.values<any>(db.jobs)) if (j.session === grant.id) { clearPayloads(j.id); if (!j.cancelRequested) delete db.jobs[j.id]; }
        save();
        json(res, { ok: true });
        return;
      }
      if (req.method === "GET" && action) {
        json(
          res,
          await rpc(id!, action, {
            providerId: u.searchParams.get("providerId") || "hunyuan-mini",
          }),
        );
        return;
      }
    }
    if (p === "/v1/jobs" && req.method === "POST") {
      const s = session(req);
      limited("jobs:" + s.id, 15);
      const releaseInput = payloads.reserve(48 * 1024 * 1024);
      try {
        const body = await bytes(req, 11 * 1024 * 1024),
          form = await new Request("http://local", {
            method: "POST",
            headers: { "content-type": req.headers["content-type"] || "" },
            body: new Uint8Array(body),
          }).formData();
        const request = JSON.parse(String(form.get("request"))),
          image = form.get("image");
        if (!(image instanceof File) || image.size > 10 * 1024 * 1024)
          fail("INPUT_LIMIT", "Image required and must be <=10MiB", 413);
        const imageBytes = Buffer.from(await image.arrayBuffer()),
          fingerprint = hash(JSON.stringify(request) + hash(imageBytes));
        let j = Object.values<any>(db.jobs).find(
          (j) =>
            j.session === s.id &&
            j.request.clientRequestId === request.clientRequestId,
        );
        if (j && j.fingerprint !== fingerprint)
          fail("IDEMPOTENCY_CONFLICT", "Request ID content differs", 409);
        if (!j) {
          if (
            Object.values<any>(db.jobs).filter(
              (j) => j.session === s.id && j.expires > Date.now(),
            ).length >= 20
          )
            fail("QUEUE_FULL", "Temporary job quota reached", 429);
          const id = randomUUID();
          j = {
            id,
            session: s.id,
            device: s.device,
            request,
            fingerprint,
            expires: Date.now() + 3600000,
          };
          db.jobs[id] = j;
          save();
        }
        releaseInput();
        if (!j.workerId && !payloads.has(j.id + ".input")) payloads.set(j.id + ".input", imageBytes);
        if (j.workerId) {
          json(res, { ...j.snapshot, id: j.id }, 202);
          return;
        }
        json(res, await dispatch(j), 202);
        return;
      } finally { releaseInput(); }
    }
    const jm = p.match(
      /^\/v1\/jobs\/([a-f0-9-]+)(?:\/(cancel|ack|outputs\/shadow))?$/,
    );
    if (jm) {
      const j = jobFor(req, jm[1]!),
        action = jm[2];
      if (j.expires < Date.now())
        fail("EXPIRED", "Temporary result expired", 410);
      if (action === "outputs/shadow" && req.method === "GET") {
        if (!payloads.has(j.id + ".output")) {
          if (!j.workerId) fail("NOT_READY", "No output", 409);
          let transfer = outputTransfers.get(j.id);
          if (!transfer) {
            transfer = rpc(j.device, "upload", {
              id: j.workerId,
              relayJobId: j.id,
            }).finally(() => outputTransfers.delete(j.id));
            outputTransfers.set(j.id, transfer);
          }
          await transfer;
        }
        if (res.destroyed) { payloads.delete(j.id + '.output'); return; }
        sendPayload(res, j.id + '.output', 'model/gltf-binary', true);
        return;
      }
      if (action === "ack" && req.method === "POST") {
        clearPayloads(j.id);
        if (j.workerId) await rpc(j.device, "ack", { id: j.workerId });
        j.expires = Date.now();
        save();
        json(res, { ok: true });
        return;
      }
      if (action === "cancel" && req.method === "POST") {
        if (j.workerId)
          j.snapshot = await rpc(j.device, "cancel", { id: j.workerId });
        else j.snapshot = { status: "cancelled", phase: "cancelled" };
        clearPayloads(j.id);
        save();
        json(res, { ...j.snapshot, id: j.id });
        return;
      }
      if (!action && req.method === "GET") {
        if (!j.workerId) {
          json(res, await dispatch(j));
          return;
        }
        j.snapshot = await rpc(j.device, "status", { id: j.workerId });
        if (!["succeeded", "failed", "cancelled", "expired"].includes(j.snapshot.status)) j.expires = Date.now() + 3600000;
        if (["failed", "cancelled", "expired"].includes(j.snapshot.status)) clearPayloads(j.id);
        save();
        json(res, { ...j.snapshot, id: j.id });
        return;
      }
    }
    const fm = p.match(/^\/worker\/files\/([a-f0-9-]+)\/(input|output)$/);
    if (fm) {
      const j = db.jobs[fm[1]!];
      if (!j || j.expires < Date.now()) fail("NOT_FOUND", "Unknown job", 404);
      worker(req, j.device);
      if (fm[2] === "input" && req.method === "GET") {
        sendPayload(res, j.id + ".input", "application/octet-stream", false);
        return;
      }
      if (fm[2] === "output" && req.method === "POST") {
        if (uploading.has(j.id))
          fail("TRANSFER_BUSY", "Output transfer already running", 409);
        // Reserve peak buffer space while concatenating incoming chunks.
        const release = payloads.reserve(256 * 1024 * 1024);
        uploading.add(j.id);
        try {
          const data = await bytes(req, 128 * 1024 * 1024);
          release();
          payloads.set(j.id + '.output', data, 60000);
        } finally {
          release();
          uploading.delete(j.id);
        }
        json(res, { ok: true });
        return;
      }
    }
    fail("NOT_FOUND", "Route not found", 404);
  } catch (e: any) {
    if (e.retryAfter) res.setHeader("Retry-After", String(e.retryAfter));
    if (!res.headersSent)
      json(
        res,
        {
          error: {
            code: e.code || "INVALID_REQUEST",
            message: e.message,
            retryable: e.status >= 500,
          },
        },
        e.status || 400,
      );
    else res.destroy();
  }
}
const server =
  process.env.RELAY_TLS_CERT && process.env.RELAY_TLS_KEY
    ? https.createServer(
        {
          cert: readFileSync(process.env.RELAY_TLS_CERT),
          key: readFileSync(process.env.RELAY_TLS_KEY),
        },
        (req, res) => {
          void handler(req, res);
        },
      )
    : http.createServer((req, res) => {
        void handler(req, res);
      });
const wss = new WebSocketServer({
  server,
  path: "/generation/worker",
  maxPayload: 256 * 1024,
});
wss.on("connection", (ws, req) => {
  let device = "",
    alive = true;
  const authTimeout = setTimeout(() => {
    if (!device) ws.close(1008, "Authentication required");
  }, 10000);
  ws.on("pong", () => {
    alive = true;
  });
  const heartbeat = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    ws.ping();
  }, 20000);
  ws.on("message", (raw) => {
    try {
      const m = JSON.parse(String(raw));
      if (!device) {
        if (
          m.type !== "auth" ||
          !/^[a-f0-9]{32}$/.test(m.deviceId) ||
          typeof m.secret !== "string" ||
          m.secret.length < 32
        )
          fail("AUTH", "Invalid worker credentials");
        limited("register:" + req.socket.remoteAddress, 30);
        const existing = db.devices[m.deviceId];
        if (existing && existing.secretHash !== hash(m.secret))
          fail("AUTH", "Invalid worker credentials");
        if (!existing) {
          db.devices[m.deviceId] = {
            secretHash: hash(m.secret),
            name: String(m.name || "Local worker").slice(0, 80),
          };
          save();
        }
        device = m.deviceId;
        connections.get(device)?.close(1000, "Reconnected");
        connections.set(device, ws);
        clearTimeout(authTimeout);
        ws.send(JSON.stringify({ type: "authenticated" }));
        for (const j of Object.values<any>(db.jobs))
          if (j.device === device && j.cancelRequested && j.workerId)
            void rpc(device, "cancel", { id: j.workerId })
              .then((result) => {
                j.snapshot = result;
                j.cancelRequested = false;
                if (j.revoked) delete db.jobs[j.id];
                save();
              })
              .catch(() => {});
        return;
      }
      if (m.type === "pair.code") {
        const code = String(m.code).toUpperCase();
        if (!/^[A-Z0-9]{10}$/.test(code) || codes.has(code) || (usedCodes.get(hash(code)) || 0) > Date.now())
          fail("PAIR", "Invalid or occupied code");
        // Only the newest outstanding code for a worker remains valid.
        for (const [oldCode, entry] of codes) if (entry.device === device) codes.delete(oldCode);
        codes.set(code, { device, expires: Date.now() + 300000 });
        ws.send(JSON.stringify({ type: "pair.ready", expiresIn: 300 }));
        return;
      }
      if (m.type === "rpc.result") {
        const p = pending.get(m.id);
        if (!p || p.device !== device) return;
        clearTimeout(p.timer);
        pending.delete(m.id);
        if (m.error)
          p.reject(
            Object.assign(Error(m.error.message), {
              code: m.error.code,
              status: m.error.status || 502,
            }),
          );
        else p.resolve(m.result);
      }
    } catch (e: any) {
      ws.send(JSON.stringify({ type: "error", message: e.message }));
      if (!device) ws.close(1008, "Authentication failed");
    }
  });
  ws.on("close", () => {
    clearTimeout(authTimeout);
    clearInterval(heartbeat);
    if (connections.get(device) === ws) connections.delete(device);
  });
});
setInterval(() => {
  let changed = false;
  for (const j of Object.values<any>(db.jobs))
    if (j.expires < Date.now()) {
      clearPayloads(j.id);
      delete db.jobs[j.id];
      changed = true;
    }
  payloads.sweep();
  pairFailures.sweep();
  for (const [k, expiry] of usedCodes) if (expiry < Date.now()) usedCodes.delete(k);
  for (const [k, s] of Object.entries<any>(db.sessions))
    if (s.expires < Date.now()) {
      delete db.sessions[k];
      changed = true;
    }
  for (const [k, c] of codes) if (c.expires < Date.now()) codes.delete(k);
  for (const [k, r] of rates) if (r.reset < Date.now()) rates.delete(k);
  if (changed) save();
}, 10000).unref();
server.listen(
  Number(process.env.RELAY_PORT || 8787),
  process.env.RELAY_HOST || "127.0.0.1",
  () =>
    console.log(
      "[relay] Listening; no inference runtime required. Port:",
      process.env.RELAY_PORT || 8787,
    ),
);
