import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const MIRROR_CONFIG = ".generation-mirrors.local.json";
export const CN_MIRRORS = Object.freeze({
  npmRegistry: "https://registry.npmmirror.com",
  pythonIndex: "https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple",
  modelSource: "modelscope",
});

export function readMirrorProfile(root) {
  const file = join(root, MIRROR_CONFIG);
  if (!existsSync(file)) return "default";
  const value = JSON.parse(readFileSync(file, "utf8"));
  if (value.version !== 1 || !["cn", "default"].includes(value.profile)) {
    throw Error(
      `Invalid ${MIRROR_CONFIG}; run npm run setup:cn or npm run setup:default`,
    );
  }
  return value.profile;
}

export function applyMirrorProfile(root, env = process.env) {
  const profile = readMirrorProfile(root);
  if (profile === "cn") {
    // Explicit user overrides still take precedence over the project preset.
    if (!env.UV_DEFAULT_INDEX && !env.UV_INDEX_URL)
      env.UV_DEFAULT_INDEX = CN_MIRRORS.pythonIndex;
    env.GEN_MODEL_SOURCE ||= CN_MIRRORS.modelSource;
  }
  return profile;
}
