import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureProject } from "../scripts/generation/setup.mjs";
import {
  applyMirrorProfile,
  readMirrorProfile,
} from "../scripts/generation/mirrors.mjs";

test("China preset is local, idempotent and reversible without installing dependencies", () => {
  const root = mkdtempSync(join(tmpdir(), "g-studio-mirrors-"));
  try {
    const original =
      "registry=https://existing.example/\nstrict-ssl=true\n//existing.example/:_authToken=test-only\n";
    writeFileSync(join(root, ".npmrc"), original);
    configureProject(root, "cn");
    const once = readFileSync(join(root, ".npmrc"), "utf8");
    assert.ok(once.startsWith(original));
    assert.match(once, /registry=https:\/\/registry.npmmirror.com/);
    configureProject(root, "cn");
    assert.equal(readFileSync(join(root, ".npmrc"), "utf8"), once);
    const env = {};
    assert.equal(applyMirrorProfile(root, env), "cn");
    assert.equal(env.GEN_MODEL_SOURCE, "modelscope");
    assert.match(env.UV_DEFAULT_INDEX, /tuna.tsinghua.edu.cn/);
    const custom = {
      UV_DEFAULT_INDEX: "https://custom.example/simple",
      GEN_MODEL_SOURCE: "huggingface",
    };
    applyMirrorProfile(root, custom);
    assert.equal(custom.UV_DEFAULT_INDEX, "https://custom.example/simple");
    assert.equal(custom.GEN_MODEL_SOURCE, "huggingface");
    assert.deepEqual(readdirSync(root).sort(), [
      ".generation-mirrors.local.json",
      ".npmrc",
    ]);
    configureProject(root, "default");
    assert.equal(readMirrorProfile(root), "default");
    assert.equal(readFileSync(join(root, ".npmrc"), "utf8"), original);
    const after = {};
    applyMirrorProfile(root, after);
    assert.deepEqual(after, {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("incomplete managed blocks are rejected without overwriting existing config", () => {
  const root = mkdtempSync(join(tmpdir(), "g-studio-mirrors-"));
  try {
    const original = "; BEGIN G-STUDIO CN MIRROR\n";
    writeFileSync(join(root, ".npmrc"), original);
    assert.throws(() => configureProject(root, "cn"));
    assert.equal(readFileSync(join(root, ".npmrc"), "utf8"), original);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
