import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  home,
  root,
  preparePython,
  run,
  managedChildren,
} from "./bootstrap.mjs";

const mode = process.argv[2] || "start";
const flags = process.argv.slice(3);
if (flags.includes("--pair")) process.env.GEN_PAIR = "1";
if (flags.includes("--cpu")) process.env.GEN_DEVICE = "cpu";
if (flags.includes("--cuda")) process.env.GEN_DEVICE = "cuda";
if (flags.includes("--mps")) process.env.GEN_DEVICE = "mps";
if (flags.filter(f => ['--cpu','--cuda','--mps'].includes(f)).length > 1) throw Error('Choose only one of --cpu, --cuda, --mps');
if (flags.includes("--offline")) process.env.GEN_OFFLINE = "1";
if (flags.includes("--base")) process.env.GEN_SKIP_MODEL = "1";
if (!["start", "dev", "download", "prepare", "doctor", "pack", "pack-mac"].includes(mode)) throw Error("Use start, dev, prepare, doctor, pack or pack-mac");
if (mode === "pack-mac") { process.env.GEN_DEVICE="cpu"; process.env.GEN_SKIP_MODEL="1"; }
const relayIndex = flags.indexOf("--relay");
if (relayIndex >= 0) {
  if (!flags[relayIndex + 1]) throw Error("--relay requires a WSS URL");
  process.env.GEN_RELAY_URL = flags[relayIndex + 1];
}
let stopping = false;
function launch(command, args) {
  const child = spawn(command, args, {
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, GEN_HOME: home, PYTHONIOENCODING: "utf-8" },
    detached: process.platform !== "win32",
  });
  managedChildren.add(child);
  child.on("error", (e) => {
    managedChildren.delete(child);
    console.error(e.message);
  });
  child.on("exit", () => managedChildren.delete(child));
  return child;
}
function stop() {
  if (stopping) return;
  stopping = true;
  for (const c of managedChildren) {
    if (c.exitCode !== null || !c.pid) continue;
    if (process.platform === "win32")
      spawn("taskkill", ["/PID", String(c.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    else
      try {
        process.kill(-c.pid, "SIGTERM");
      } catch {}
  }
  setTimeout(() => process.exit(), 700);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
if (process.platform === "win32") process.on("SIGBREAK", stop);
if (mode === "dev") {
  const port = process.env.GEN_WEB_PORT || "5173";
  process.env.GEN_ORIGINS ||= `http://127.0.0.1:${port},http://localhost:${port}`;
  const web = launch(process.execPath, [
    join(root, "node_modules/vite/bin/vite.js"),
    "--host",
    "127.0.0.1",
    "--port",
    port,
    "--strictPort",
  ]);
  web.on("exit", (code) => {
    if (code) stop();
  });
}
try {
  if (mode === "dev" || mode === "start") {
    let existing;
    try {
      existing = await fetch(
        `http://127.0.0.1:${process.env.GEN_PORT || 8765}/health`,
        { signal: AbortSignal.timeout(1500) },
      );
    } catch {}
    if (existing?.ok)
      throw Error(
        "Generation port is already in use. Stop the existing service or set GEN_PORT; dependencies were not changed.",
      );
  }
  const python = await preparePython();
  if (mode === "pack-mac") {
    const { buildMacPackage } = await import('./cross-mac.mjs');
    await buildMacPackage(python);
  } else if (["download", "prepare", "pack"].includes(mode)) {
    if (process.env.GEN_SKIP_MODEL === "1") console.log("[generation] Lightweight runtime verified");
    else {
      console.log("[generation] Preparing model files: download, resume and SHA256 verification");
      await run(python, ["-u", join(root, "services/generation-python/download.py")], {
        env: { ...process.env, GEN_HOME: home, PYTHONIOENCODING: "utf-8" },
      });
      console.log("[generation] Download preparation complete; model files are ready");
    }
    if (mode === "pack") {
      const { pack } = await import('./pack.mjs');
      await pack(python);
    }
  } else if (mode === "doctor") {
    await run(python, [join(root, "services/generation-python/device.py")]);
    console.log("Generation home:", home);
    try {
      const r = await fetch(
        `http://127.0.0.1:${process.env.GEN_PORT || 8765}/health`,
      );
      console.log("Service:", await r.json());
    } catch {
      console.log("Service is not running");
    }
  } else {
    try {
      const r = await fetch(
        `http://127.0.0.1:${process.env.GEN_PORT || 8765}/health`,
        { signal: AbortSignal.timeout(1500) },
      );
      if (r.ok)
        throw Error(
          "Generation port is already in use. Stop the existing service or set GEN_PORT.",
        );
    } catch (e) {
      if (e.message.includes("already in use")) throw e;
    }
    const child = launch(python, [
      "-u",
      join(root, "services/generation-python/server.py"),
    ]);
    child.on("exit", (code) => {
      console.log("[generation] Service stopped:", code);
      if (mode !== "dev") process.exitCode = code || 0;
    });
  }
} catch (e) {
  console.error("[generation] Setup failed:", e.message);
  console.error(
    "[generation] Web remains usable with silhouette approximation. Retry or use npm run dev:web.",
  );
  if (mode !== "dev") process.exitCode = 1;
}
