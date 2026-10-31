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
  let recommendations = 0;
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
    if (p.acceptsJobs !== undefined && (typeof p.acceptsJobs !== 'boolean' || (p.acceptsJobs && !['ready','preparing','loading','warming'].includes(p.state))))
      throw Error('Invalid provider submission state');
    if (p.tags !== undefined) {
      if (!Array.isArray(p.tags) || p.tags.length > 2 || new Set(p.tags).size !== p.tags.length || !p.tags.every((tag: unknown) => typeof tag === 'string' && ['推荐','快速','均衡','精细'].includes(tag)))
        throw Error('Invalid provider tags');
      if (p.tags.includes('推荐') && (++recommendations > 1 || ['failed','not-installed','disabled'].includes(p.state)))
        throw Error('Invalid provider recommendation');
    }
    if (p.error != null && typeof p.error !== 'string') throw Error('Invalid provider error');
    if (p.instanceId !== undefined && !text(p.instanceId, 100)) throw Error('Invalid resident instance');
    if (p.loadCount !== undefined && (!Number.isSafeInteger(p.loadCount) || p.loadCount < 1)) throw Error('Invalid model load count');
    if (p.strategy !== undefined && !['resident','staged'].includes(p.strategy)) throw Error('Invalid provider strategy');
    for (const key of ['precision', 'imageEncoderPrecision']) if (p[key] !== undefined && !['fp16','fp32'].includes(p[key])) throw Error('Invalid provider precision');
    for (const key of ['preparationSeconds','loadSeconds','warmupSeconds'])
      if (p[key] !== undefined && (typeof p[key] !== 'number' || !Number.isFinite(p[key]) || p[key] < 0)) throw Error('Invalid provider timing');
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
function timings(value: unknown) {
  if (value === undefined) return;
  if (!object(value) || !['totalSeconds','queueSeconds','executionSeconds'].every(k => typeof value[k] === 'number' && Number.isFinite(value[k]) && value[k] >= 0)
    || Math.abs(value.totalSeconds - value.queueSeconds - value.executionSeconds) > .01) throw Error('Invalid task timings');
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
    ].includes(value.status)
  )
    throw Error("Invalid task response");
  timings(value.timings);
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
    timings(r.timings);
    for (const key of ['precision', 'imageEncoderPrecision']) if (r[key] !== undefined && !['fp16','fp32'].includes(r[key])) throw Error('Invalid result precision');
    if (r.strategy !== undefined && !['resident','staged'].includes(r.strategy)) throw Error('Invalid result strategy');
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
