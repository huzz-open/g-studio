import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  openSync,
  closeSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { applyMirrorProfile } from "./mirrors.mjs";
import { withProgress } from "./progress.mjs";

export const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const mirrorProfile = applyMirrorProfile(root);
if (mirrorProfile === "cn")
  console.log(
    "[generation] 国内预设：清华 Python 包镜像，ModelScope 权重优先；其他下载保留各自官方源。",
  );
export const home = resolve(
  process.env.GEN_HOME || join(homedir(), ".g-studio/generation"),
);
mkdirSync(home, { recursive: true });
export const managedChildren = new Set();
export function run(command, args, options = {}) {
  const { progressLabel, ...spawnOptions } = options;
  if (progressLabel)
    return withProgress(progressLabel, () => run(command, args, spawnOptions));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      windowsHide: true,
      detached: process.platform !== "win32",
      ...spawnOptions,
    });
    managedChildren.add(child);
    child.on("error", (e) => {
      managedChildren.delete(child);
      reject(e);
    });
    child.on("exit", (code) => {
      managedChildren.delete(child);
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`));
    });
  });
}
async function fetchFile(url, path) {
  let received = 0, total = 0, connected = false;
  const started = performance.now();
  await withProgress("Downloading uv", async () => {
    const r = await fetch(url);
    if (!r.ok) throw Error(`Download ${r.status}: ${url}`);
    connected = true;
    total = Number(r.headers.get("content-length")) || 0;
    const chunks = [];
    for await (const chunk of r.body) {
      chunks.push(chunk);
      received += chunk.length;
    }
    writeFileSync(path, Buffer.concat(chunks));
  }, () => {
    if (!connected) return "waiting for server response";
    const mib = (received / 1024 ** 2).toFixed(1);
    const rate = (received / 1024 ** 2 / Math.max((performance.now() - started) / 1000, 0.001)).toFixed(2);
    return total
      ? `${(received / total * 100).toFixed(1)}% | ${mib}/${(total / 1024 ** 2).toFixed(1)} MiB | ${rate} MiB/s`
      : `${mib} MiB | ${rate} MiB/s | total size unknown`;
  });
}
async function uvBinary() {
  console.log("[generation] Checking uv runtime manager");
  if (spawnSync("uv", ["--version"], { stdio: "ignore", timeout: 10000 }).status === 0) {
    console.log("[generation] Using installed uv");
    return "uv";
  }
  const version = "0.9.7",
    platform =
      process.platform === "win32"
        ? "x86_64-pc-windows-msvc"
        : process.platform === "linux"
          ? "x86_64-unknown-linux-gnu"
          : process.arch === "arm64"
            ? "aarch64-apple-darwin"
            : "x86_64-apple-darwin";
  if (!["win32", "linux", "darwin"].includes(process.platform))
    throw Error("Unsupported platform");
  const bin = join(
      home,
      "tools",
      process.platform === "win32" ? "uv.exe" : "uv",
    ),
    ext = process.platform === "win32" ? "zip" : "tar.gz";
  if (
    existsSync(bin) &&
    spawnSync(bin, ["--version"], { stdio: "ignore", timeout: 10000 }).status === 0
  ) {
    console.log("[generation] Using cached uv");
    return bin;
  }
  mkdirSync(join(home, "tools"), { recursive: true });
  const name = `uv-${platform}.${ext}`,
    base = `https://github.com/astral-sh/uv/releases/download/${version}/${name}`,
    archive = join(home, "tools", name);
  console.log("[generation] Preparing pinned uv runtime manager");
  await fetchFile(base, archive);
  await withProgress("Verifying uv SHA256", async () => {
    const r = await fetch(base + ".sha256");
    if (!r.ok) throw Error("Unable to verify uv archive");
    const expected = (await r.text()).trim().split(/\s/)[0],
      actual = createHash("sha256").update(readFileSync(archive)).digest("hex");
    if (expected !== actual) throw Error("uv archive checksum mismatch");
  });
  if (process.platform === "win32")
    await run("powershell", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${join(home, "tools").replaceAll("'", "''")}' -Force`,
    ], { progressLabel: "Extracting uv" });
  else {
    await run("tar", [
      "-xzf",
      archive,
      "-C",
      join(home, "tools"),
      "--strip-components=1",
    ], { progressLabel: "Extracting uv" });
    chmodSync(bin, 0o755);
  }
  return bin;
}
export async function preparePython() {
  console.log(`[generation] Preparing Python environment in ${home}`);
  if (process.env.GEN_PYTHON) {
    console.log("[generation] Using configured isolated Python");
    return process.env.GEN_PYTHON;
  }
  const lock = join(home, "environment.lock");
  console.log("[generation] Checking environment setup lock");
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, "utf8"));
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch {}
    if (alive)
      throw Error(
        "Another environment setup is running. Retry after it completes.",
      );
    console.log("[generation] Removing stale environment setup lock");
    unlinkSync(lock);
  }
  const lockFd = openSync(lock, "wx");
  writeFileSync(lockFd, String(process.pid));
  closeSync(lockFd);
  try {
    const uv = await uvBinary(),
      venv = join(home, "venv"),
      python = join(
        venv,
        process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
      );
    process.env.UV_LINK_MODE ||= "copy";
    const uvRun = (args, progressLabel, officialTorchIndex = false) => {
      const env = { ...process.env, RUST_LOG: "error" };
      if (officialTorchIndex)
        for (const key of [
          "UV_DEFAULT_INDEX",
          "UV_INDEX_URL",
          "UV_INDEX",
          "UV_EXTRA_INDEX_URL",
        ])
          delete env[key];
      return run(uv, args, { env, progressLabel });
    };
    console.log("[generation] Detecting GPU hardware");
    const hasNvidia =
      spawnSync("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"], {
        encoding: "utf8",
        timeout: 10000,
      }).status === 0;
    const gpu = hasNvidia && process.env.GEN_DEVICE !== "cpu",
      index = gpu
        ? "https://download.pytorch.org/whl/cu124"
        : "https://download.pytorch.org/whl/cpu";
    console.log(
      `[generation] Hardware probe: ${hasNvidia ? "NVIDIA GPU detected" : "no NVIDIA CUDA device detected"}; preparing ${gpu ? "CUDA" : "CPU"} runtime`,
    );
    if (!existsSync(python))
      await uvRun(["venv", "--python", "3.12", venv], "Preparing Python 3.12 and virtual environment");
    else console.log("[generation] Using existing Python virtual environment");
    const requirements = join(
      root,
      "services/generation-python",
      process.env.GEN_SKIP_MODEL === "1"
        ? "requirements-base.lock"
        : "requirements-model.lock",
    );
    const stamp = createHash("sha256")
      .update(readFileSync(requirements))
      .update(index)
      .digest("hex");
    const marker = join(home, "environment.json");
    if (
      !existsSync(marker) ||
      JSON.parse(readFileSync(marker)).stamp !== stamp
    ) {
      console.log(
        "[generation] Installing isolated dependencies; this may take several minutes on first launch",
      );
      const prior = existsSync(marker) ? JSON.parse(readFileSync(marker)) : {};
      if (process.env.GEN_SKIP_MODEL !== "1" && prior.index !== index)
        await uvRun(
          [
            "--no-config",
            "pip",
            "install",
            "--python",
            python,
            "torch==2.6.0",
            "torchvision==0.21.0",
            "--default-index",
            index,
            "--reinstall-package",
            "torch",
            "--reinstall-package",
            "torchvision",
          ],
          `Installing PyTorch (${gpu ? "CUDA" : "CPU"}) from ${index}`,
          true,
        );
      await uvRun([
        "pip",
        "install",
        "--python",
        python,
        "-r",
        requirements,
      ], "Installing Python dependencies");
      console.log("[generation] Saving environment readiness marker");
      writeFileSync(
        marker,
        JSON.stringify({
          stamp,
          gpu,
          index: process.env.GEN_SKIP_MODEL === "1" ? undefined : index,
        }),
      );
    } else console.log("[generation] Python dependencies already prepared; skipping installation");
    console.log("[generation] Python environment ready");
    return python;
  } finally {
    if (existsSync(lock)) unlinkSync(lock);
    console.log("[generation] Environment setup lock released");
  }
}
