import { reactive } from "vue";
import type {
  GenerationJob,
  GenerationRequest,
} from "../../../packages/generation-protocol/types";
import { GenerationClient, sha256 } from "./client";
import type { GenerationConnection } from "./settings";
import { decodeMesh, meshDataUri } from "../parts/mesh";
import type { PartGeometry, Triple } from "../parts/schema";
import { meshExtents } from "../../modules/scene-lighting/part-geometry";

export interface LocalJob {
  localId: string;
  name: string;
  image: string;
  connection: GenerationConnection;
  request: GenerationRequest;
  remote?: GenerationJob;
  geometry?: PartGeometry;
  error?: string;
  deviceType?: string;
  saved?: boolean;
  resultRejected?: boolean;
  createdAt: number;
}
export const generationJobs = reactive<LocalJob[]>([]);
let database: Promise<IDBDatabase> | undefined,
  started = false;
function db() {
  return (database ??= new Promise((resolve, reject) => {
    const r = indexedDB.open("g-studio-generation-jobs-v1", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("jobs", { keyPath: "localId" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}
export async function persistJob(job: LocalJob) {
  const d = await db(),
    snapshot = JSON.parse(JSON.stringify(job));
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction("jobs", "readwrite");
    tx.objectStore("jobs").put(snapshot);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
const active = new Set<string>();
async function inspect(job: LocalJob) {
  if (
    active.has(job.localId) ||
    job.saved ||
    job.geometry ||
    job.resultRejected ||
    !job.remote ||
    !(job.connection.mode === "relay"
      ? job.connection.relayToken
      : job.connection.token) ||
    ["failed", "cancelled", "expired"].includes(job.remote.status)
  )
    return;
  active.add(job.localId);
  try {
    const client = new GenerationClient(job.connection);
    job.remote = await client.status(job.remote.id);
    job.error = "";
    try {
      job.deviceType = (await client.info()).deviceType;
    } catch {
      job.deviceType = undefined;
    }
    if (job.remote.status === "succeeded") {
      const result = job.remote.result!,
        output = result.outputs.find((o) => o.id === "shadow");
      if (
        !output ||
        result.inputSha256 !== job.request.inputSha256 ||
        result.coordinateSystem !== "right-handed-y-up"
      )
        throw Error("Result contract does not match request");
      const buffer = await client.output(job.remote.id, output.id);
      if (
        buffer.byteLength !== output.bytes ||
        (await sha256(buffer)) !== output.sha256
      )
        throw Error("Output integrity check failed");
      const uri = meshDataUri(buffer),
        mesh = decodeMesh(uri),
        size = meshExtents(mesh).size.map((v) =>
          Math.max(0.02, Math.min(8, v)),
        ) as Triple;
      job.geometry = {
        kind: "mesh",
        size,
        mesh: {
          uri,
          sha256: output.sha256,
          inputSha256: result.inputSha256,
          providerId: result.providerId,
          providerVersion: result.providerVersion,
          generation: {
            seed: job.request.seed,
            targetFaces: job.request.targetFaces,
            parameters: { ...job.request.parameters },
          },
          warnings: result.warnings || [],
        },
      };
      await persistJob(job); // Acknowledge only after the binary is durably stored in this browser.
      await client.ack(job.remote.id).catch(() => {});
    }
    await persistJob(job);
  } catch (e) {
    job.error = String(e);
    if (job.remote?.status === "succeeded") job.resultRejected = true;
    await persistJob(job).catch(() => {});
  } finally {
    active.delete(job.localId);
  }
}
export async function loadGenerationJobs() {
  if (started) return;
  started = true;
  const d = await db();
  const list = await new Promise<LocalJob[]>((resolve, reject) => {
    const r = d.transaction("jobs").objectStore("jobs").getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  generationJobs.push(...list.sort((a, b) => b.createdAt - a.createdAt));
  void poll();
}
async function poll() {
  await Promise.allSettled(generationJobs.map(inspect));
  setTimeout(() => void poll(), document.hidden ? 10000 : 2000);
}
export async function submitJob(job: LocalJob) {
  job.error = "";
  await persistJob(job);
  try {
    job.remote = await new GenerationClient(job.connection).submit(
      job.request,
      await (await fetch(job.image)).blob(),
    );
    await persistJob(job);
    void inspect(job);
  } catch (e) {
    job.error = String(e);
    await persistJob(job);
    throw e;
  }
}
export async function createGenerationJob(
  name: string,
  image: string,
  connection: GenerationConnection,
) {
  await loadGenerationJobs();
  const bytes = await (await fetch(image)).arrayBuffer();
  const job: LocalJob = {
    localId: crypto.randomUUID(),
    name,
    image,
    connection: { ...connection },
    createdAt: Date.now(),
    request: {
      protocolVersion: 1,
      clientRequestId: crypto.randomUUID(),
      providerId: connection.providerId,
      inputSha256: await sha256(bytes),
      targetFaces: connection.targetFaces,
      seed: connection.seed,
      parameters: {
        ...connection.parametersByProvider?.[connection.providerId],
      },
    },
  };
  generationJobs.unshift(job);
  const reactiveJob = generationJobs[0]!;
  await submitJob(reactiveJob).catch(() => {});
  return reactiveJob;
}
export async function cancelJob(job: LocalJob) {
  if (job.remote) {
    job.remote = await new GenerationClient(job.connection).cancel(
      job.remote.id,
    );
    await persistJob(job);
  }
}
export async function retryResult(job: LocalJob) {
  job.resultRejected = false;
  await inspect(job);
}
export async function removeJob(job: LocalJob) {
  if (
    job.remote &&
    !["succeeded", "failed", "cancelled", "expired"].includes(job.remote.status)
  )
    await cancelJob(job);
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction("jobs", "readwrite");
    tx.objectStore("jobs").delete(job.localId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  generationJobs.splice(generationJobs.indexOf(job), 1);
}
export async function forgetJobCredentials(connection: GenerationConnection) {
  await loadGenerationJobs();
  for (const job of generationJobs) {
    const c = job.connection,
      match =
        connection.mode === "relay"
          ? c.mode === "relay" &&
            c.relayUrl === connection.relayUrl &&
            c.deviceId === connection.deviceId
          : c.mode === "direct" && c.baseUrl === connection.baseUrl;
    if (match) {
      c.token = "";
      c.relayToken = "";
      await persistJob(job);
    }
  }
}
