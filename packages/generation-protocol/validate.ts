import type { Capabilities, GenerationJob } from "./types";
const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 200): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const identifier = (v: unknown): v is string =>
  text(v, 100) &&
  /^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/.test(v) &&
  !["__proto__", "constructor", "prototype"].includes(v);
function range(v: unknown) {
  return (
    object(v) &&
    [v.min, v.max, v.default].every(
      (n) => typeof n === "number" && Number.isFinite(n),
    ) &&
    v.min <= v.default &&
    v.default <= v.max
  );
}
export function parseCapabilities(value: unknown): Capabilities {
  if (
    !object(value) ||
    value.protocolVersion !== 1 ||
    !Array.isArray(value.providers) ||
    !value.providers.length ||
    value.providers.length > 64 ||
    !object(value.limits) ||
    !range(value.targetFaces)
  )
    throw Error("Unsupported generation capabilities");
  const ids = new Set<string>();
  for (const p of value.providers) {
    if (
      !object(p) ||
      !identifier(p.providerId) ||
      ids.has(p.providerId) ||
      !text(p.name) ||
      !text(p.state) ||
      !object(p.parameters) ||
      Object.keys(p.parameters).length > 32 ||
      !Object.entries(p.parameters).every(([k, v]) => identifier(k) && range(v))
    )
      throw Error("Malformed generation provider");
    ids.add(p.providerId);
  }
  for (const name of [
    "inputBytes",
    "inputDimension",
    "outputBytes",
    "concurrency",
    "queue",
  ])
    if (!Number.isSafeInteger(value.limits[name]) || value.limits[name] < 1)
      throw Error("Invalid service limits");
  return value as Capabilities;
}
export function parseJob(value: unknown): GenerationJob {
  if (
    !object(value) ||
    !text(value.id, 160) ||
    !text(value.phase) ||
    ![
      "queued",
      "running",
      "cancel_requested",
      "cancelled",
      "succeeded",
      "failed",
      "expired",
    ].includes(value.status)
  )
    throw Error("Invalid task response");
  if (value.status === "succeeded") {
    const r = value.result;
    if (
      !object(r) ||
      r.protocolVersion !== 1 ||
      !text(r.providerId, 100) ||
      !text(r.inputSha256, 64) ||
      !Array.isArray(r.outputs) ||
      !r.outputs.length ||
      r.outputs.length > 8 ||
      !Array.isArray(r.warnings) ||
      !r.warnings.every((x: unknown) => typeof x === "string")
    )
      throw Error("Invalid generation result");
    for (const o of r.outputs)
      if (
        !object(o) ||
        !text(o.id, 100) ||
        o.mime !== "model/gltf-binary" ||
        !Number.isSafeInteger(o.bytes) ||
        o.bytes < 1 ||
        o.bytes > 128 * 1024 * 1024 ||
        typeof o.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(o.sha256)
      )
        throw Error("Invalid output metadata");
  }
  return value as GenerationJob;
}
