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
  createReadStream,
  createWriteStream,
  statSync,
  unlinkSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

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
    { device: string; expires: number; attempts: number }
  >(),
  pairs = new Map<string, any>(),
  rates = new Map<string, { count: number; reset: number }>();
function fail(code: string, message: string, status = 400): never {
  throw Object.assign(Error(message), { code, status });
}
const storageLimit =
  Number(process.env.RELAY_MAX_STORAGE_MB || 2048) * 1024 * 1024;
if (!Number.isFinite(storageLimit) || storageLimit <= 0)
  throw Error("Invalid RELAY_MAX_STORAGE_MB");
let reservedBytes = 0;
const outputTransfers = new Map<string, Promise<any>>();
const uploading = new Set<string>();
function reserveStorage(bytes: number) {
  let used = 0;
  for (const j of Object.values<any>(db.jobs))
    for (const suffix of ["input", "output"]) {
      const file = join(home, j.id + "." + suffix);
      if (existsSync(file)) used += statSync(file).size;
    }
  if (used + reservedBytes + bytes > storageLimit)
    fail("STORAGE_FULL", "Relay temporary storage quota reached", 507);
  reservedBytes += bytes;
  return () => {
    reservedBytes -= bytes;
  };
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
      limited("pair:" + req.socket.remoteAddress, 10);
      limited("pair-global", 100);
      const { code } = JSON.parse((await bytes(req, 4096)).toString()),
        key = String(code || "").toUpperCase(),
        entry = codes.get(key);
      if (!entry || entry.expires < Date.now())
        fail("PAIR_INVALID", "Invalid or expired pairing code", 404);
      if (++entry.attempts > 5) {
        codes.delete(key);
        fail("PAIR_INVALID", "Pairing code exhausted", 429);
      }
      const id = randomUUID(),
        pollToken = randomBytes(32).toString("base64url");
      pairs.set(id, {
        device: entry.device,
        pollHash: hash(pollToken),
        state: "pending",
        expires: Date.now() + 300000,
        code: key,
      });
      const ws = connections.get(entry.device);
      if (!ws) fail("DEVICE_OFFLINE", "Device offline", 503);
      ws.send(
        JSON.stringify({ type: "pair.request", id, display: id.slice(0, 8) }),
      );
      json(res, { id, pollToken, display: id.slice(0, 8) }, 202);
      return;
    }
    const pairMatch = p.match(/^\/v1\/pair\/([a-f0-9-]+)$/);
    if (pairMatch && req.method === "GET") {
      const pair = pairs.get(pairMatch[1]);
      if (
        !pair ||
        pair.expires < Date.now() ||
        hash(bearer(req)) !== pair.pollHash
      )
        fail("PAIR_INVALID", "Invalid pair request", 401);
      if (pair.state === "approved") {
        if (!pair.token) {
          pair.token = randomBytes(32).toString("base64url");
          db.sessions[hash(pair.token)] = {
            id: randomUUID(),
            device: pair.device,
            expires: Date.now() + 30 * 86400000,
          };
          save();
        }
        json(res, {
          state: "approved",
          token: pair.token,
          deviceId: pair.device,
        });
      } else json(res, { state: pair.state });
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
      owner(req, id!);
      if (req.method === "DELETE") {
        for (const [k, s] of Object.entries<any>(db.sessions))
          if (s.device === id) delete db.sessions[k];
        for (const j of Object.values<any>(db.jobs))
          if (j.device === id && j.workerId) {
            j.cancelRequested = true;
            void rpc(id!, "cancel", { id: j.workerId })
              .then((result) => {
                j.snapshot = result;
                j.cancelRequested = false;
                save();
              })
              .catch(() => {});
          }
        for (const [k, pair] of pairs) if (pair.device === id) pairs.delete(k);
        codes.forEach((v, k) => {
          if (v.device === id) codes.delete(k);
        });
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
          expires: Date.now() + 86400000,
        };
        const release = reserveStorage(imageBytes.length);
        try {
          writeFileSync(join(home, id + ".input"), imageBytes);
        } catch (error) {
          const partial = join(home, id + ".input");
          if (existsSync(partial)) unlinkSync(partial);
          throw error;
        } finally {
          release();
        }
        db.jobs[id] = j;
        save();
      }
      if (j.workerId) {
        json(res, { ...j.snapshot, id: j.id }, 202);
        return;
      }
      json(res, await dispatch(j), 202);
      return;
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
        if (!existsSync(join(home, j.id + ".output"))) {
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
        const file = join(home, j.id + ".output");
        if (!existsSync(file)) fail("NOT_READY", "Output not ready", 409);
        res.writeHead(200, {
          "Content-Type": "model/gltf-binary",
          "Content-Length": statSync(file).size,
        });
        createReadStream(file).pipe(res);
        return;
      }
      if (action === "ack" && req.method === "POST") {
        if (j.workerId) await rpc(j.device, "ack", { id: j.workerId });
        j.expires = Date.now() + 60000;
        save();
        json(res, { ok: true });
        return;
      }
      if (action === "cancel" && req.method === "POST") {
        if (j.workerId)
          j.snapshot = await rpc(j.device, "cancel", { id: j.workerId });
        else j.snapshot = { status: "cancelled", phase: "cancelled" };
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
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        createReadStream(join(home, j.id + ".input")).pipe(res);
        return;
      }
      if (fm[2] === "output" && req.method === "POST") {
        if (uploading.has(j.id))
          fail("TRANSFER_BUSY", "Output transfer already running", 409);
        const file = join(home, j.id + ".output"),
          temp = file + ".tmp";
        let length = 0;
        const release = reserveStorage(128 * 1024 * 1024);
        uploading.add(j.id);
        try {
          await pipeline(
            req,
            new Transform({
              transform(chunk, _, cb) {
                length += chunk.length;
                cb(
                  length > 128 * 1024 * 1024 ? Error("Output too large") : null,
                  chunk,
                );
              },
            }),
            createWriteStream(temp),
          );
          renameSync(temp, file);
        } catch (e) {
          if (existsSync(temp)) unlinkSync(temp);
          throw e;
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
                save();
              })
              .catch(() => {});
        return;
      }
      if (m.type === "pair.code") {
        const code = String(m.code).toUpperCase();
        if (!/^[A-Z0-9]{8}$/.test(code) || codes.has(code))
          fail("PAIR", "Invalid or occupied code");
        codes.set(code, { device, expires: Date.now() + 300000, attempts: 0 });
        ws.send(JSON.stringify({ type: "pair.ready", expiresIn: 300 }));
        return;
      }
      if (m.type === "pair.confirm") {
        const pair = pairs.get(m.id);
        if (
          !pair ||
          pair.device !== device ||
          pair.expires < Date.now() ||
          pair.state !== "pending"
        )
          return;
        if (m.accept && codes.has(pair.code)) {
          pair.state = "approved";
          codes.delete(pair.code);
          for (const [id, p] of pairs)
            if (id !== m.id && p.device === device && p.state === "pending")
              p.state = "denied";
        } else pair.state = "denied";
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
      let cleaned = true;
      for (const suffix of ["input", "output", "output.tmp"]) {
        const f = join(home, j.id + "." + suffix);
        try {
          if (existsSync(f)) unlinkSync(f);
        } catch {
          cleaned = false;
        }
      }
      if (cleaned && j.expires < Date.now() - 86400000) {
        delete db.jobs[j.id];
        changed = true;
      }
    }
  for (const [k, p] of pairs) if (p.expires < Date.now()) pairs.delete(k);
  for (const [k, s] of Object.entries<any>(db.sessions))
    if (s.expires < Date.now()) {
      delete db.sessions[k];
      changed = true;
    }
  for (const [k, c] of codes) if (c.expires < Date.now()) codes.delete(k);
  for (const [k, r] of rates) if (r.reset < Date.now()) rates.delete(k);
  if (changed) save();
}, 60000).unref();
server.listen(
  Number(process.env.RELAY_PORT || 8787),
  process.env.RELAY_HOST || "127.0.0.1",
  () =>
    console.log(
      "[relay] Listening; no inference runtime required. Port:",
      process.env.RELAY_PORT || 8787,
    ),
);
