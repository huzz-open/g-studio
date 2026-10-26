import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { withProgress } from "../scripts/generation/progress.mjs";

test("silent stages emit a heartbeat and stop it after completion or failure", async (t) => {
  const messages = [];
  t.mock.method(console, "log", message => messages.push(message));
  t.mock.method(console, "error", message => messages.push(message));
  let heartbeat;
  const seen = new Promise(resolve => { heartbeat = resolve; });
  const result = await withProgress("dependency install", async () => {
    await Promise.race([seen, delay(1000).then(() => { throw Error("Missing heartbeat"); })]);
    return 42;
  }, () => { heartbeat(); return "waiting for installer"; }, 5);
  assert.equal(result, 42);
  assert.ok(messages.some(message => message.includes("waiting for installer")));
  assert.ok(messages.at(-1).includes("complete"));
  await assert.rejects(withProgress("broken install", async () => {
    throw Error("installer exited 1");
  }, undefined, 5), /installer exited 1/);
  assert.ok(messages.at(-1).includes("failed"));
  const count = messages.length;
  await delay(25);
  assert.equal(messages.length, count, "completed stages must not keep logging");
});
