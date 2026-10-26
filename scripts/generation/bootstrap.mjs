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

export const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const home = resolve(
  process.env.GEN_HOME || join(homedir(), ".g-studio/generation"),
);
mkdirSync(home, { recursive: true });
export const managedChildren = new Set();
export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      windowsHide: true,
      detached: process.platform !== "win32",
      ...options,
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
  const r = await fetch(url);
  if (!r.ok) throw Error(`Download ${r.status}: ${url}`);
  writeFileSync(path, Buffer.from(await r.arrayBuffer()));
}
async function uvBinary() {
  if (spawnSync("uv", ["--version"], { stdio: "ignore" }).status === 0)
    return "uv";
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
    spawnSync(bin, ["--version"], { stdio: "ignore" }).status === 0
  )
    return bin;
  mkdirSync(join(home, "tools"), { recursive: true });
  const name = `uv-${platform}.${ext}`,
    base = `https://github.com/astral-sh/uv/releases/download/${version}/${name}`,
    archive = join(home, "tools", name);
  console.log("[generation] Preparing pinned uv runtime manager");
  await fetchFile(base, archive);
  const r = await fetch(base + ".sha256");
  if (!r.ok) throw Error("Unable to verify uv archive");
  const expected = (await r.text()).trim().split(/\s/)[0],
    actual = createHash("sha256").update(readFileSync(archive)).digest("hex");
  if (expected !== actual) throw Error("uv archive checksum mismatch");
  if (process.platform === "win32")
    await run("powershell", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${join(home, "tools").replaceAll("'", "''")}' -Force`,
    ]);
  else {
    await run("tar", [
      "-xzf",
      archive,
      "-C",
      join(home, "tools"),
      "--strip-components=1",
    ]);
    chmodSync(bin, 0o755);
  }
  return bin;
}
export async function preparePython() {
  if (process.env.GEN_PYTHON) {
    console.log("[generation] Using configured isolated Python");
    return process.env.GEN_PYTHON;
  }
  const lock = join(home, "environment.lock");
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
    const uvRun = (args) =>
      run(uv, args, { env: { ...process.env, RUST_LOG: "error" } });
    const hasNvidia =
      spawnSync("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"], {
        encoding: "utf8",
      }).status === 0;
    const gpu = hasNvidia && process.env.GEN_DEVICE !== "cpu",
      index = gpu
        ? "https://download.pytorch.org/whl/cu124"
        : "https://download.pytorch.org/whl/cpu";
    console.log(
      `[generation] Hardware probe: ${hasNvidia ? "NVIDIA GPU detected" : "no NVIDIA CUDA device detected"}; preparing ${gpu ? "CUDA" : "CPU"} runtime`,
    );
    if (!existsSync(python)) await uvRun(["venv", "--python", "3.12", venv]);
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
        await uvRun([
          "--quiet",
          "pip",
          "install",
          "--python",
          python,
          "torch==2.6.0",
          "torchvision==0.21.0",
          "--index-url",
          index,
          "--reinstall-package",
          "torch",
          "--reinstall-package",
          "torchvision",
        ]);
      await uvRun([
        "--quiet",
        "pip",
        "install",
        "--python",
        python,
        "-r",
        requirements,
      ]);
      writeFileSync(
        marker,
        JSON.stringify({
          stamp,
          gpu,
          index: process.env.GEN_SKIP_MODEL === "1" ? undefined : index,
        }),
      );
    }
    return python;
  } finally {
    if (existsSync(lock)) unlinkSync(lock);
  }
}
