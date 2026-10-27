import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CN_MIRRORS, MIRROR_CONFIG } from "./mirrors.mjs";

const BEGIN = "; BEGIN G-STUDIO CN MIRROR";
const END = "; END G-STUDIO CN MIRROR";

export function configureProject(root, profile) {
  if (!["cn", "default"].includes(profile))
    throw Error("Expected cn or default");
  const file = join(root, ".npmrc");
  const original = existsSync(file) ? readFileSync(file, "utf8") : "";
  const start = original.indexOf(BEGIN),
    end = original.indexOf(END);
  if (start < 0 !== end < 0 || (start >= 0 && end < start))
    throw Error("Incomplete managed mirror block in .npmrc");
  let value = original;
  if (start >= 0) {
    const tail = end + END.length;
    value =
      original.slice(0, start) + original.slice(tail).replace(/^\r?\n/, "");
  }
  if (profile === "cn") {
    if (value && !value.endsWith("\n")) value += "\n";
    value += `${BEGIN}\nregistry=${CN_MIRRORS.npmRegistry}\n${END}\n`;
  }
  writeFileSync(file + ".tmp", value, { mode: 0o600 });
  renameSync(file + ".tmp", file);
  const config = join(root, MIRROR_CONFIG);
  writeFileSync(
    config + ".tmp",
    JSON.stringify({ version: 1, profile }, null, 2) + "\n",
  );
  renameSync(config + ".tmp", config);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const profile = process.argv[2];
  configureProject(root, profile);
  if (profile === "cn") {
    console.log("[setup] 国内预设已保存，仅影响当前项目。");
    console.log(
      "[setup] npm: 阿里 npmmirror; Python 包: 清华; PyTorch: 南大对应 CPU/CUDA 源; 模型权重: ModelScope 优先。",
    );
    console.log("[setup] 国内预设不是全局代理：Node/Python 运行时及部分许可证仍可能访问官方源；显式环境变量优先。");
    console.log(
      "[setup] 模型版本、文件清单、断点续传与 SHA256 校验由项目自动管理。",
    );
  } else
    console.log("[setup] 已撤销国内预设，保留此前的 npm 配置和已有模型缓存。");
  console.log(
    "[setup] 尚未安装依赖或下载模型。下一步：npm install，然后 npm run dev。",
  );
}
