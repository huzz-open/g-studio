import { reactive } from "vue";
import { generationDatabase as db } from './storage';
import { identifyModel, publishModel, modelRecord, loadGeneratedModels, resolveModelGeometry, legacyKeysFor } from './models';
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
  modelId?: string;
  modelRevision?: number;
  legacyModelKeys?: string[];
  supersededTaskIds?: string[];
  replaces?: { jobId: string; modelId: string; revision: number };
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
  source?: { assetId: string; origin: 'scene' | 'slicer' };
}
export const generationJobs = reactive<LocalJob[]>([]);
let loading: Promise<void> | undefined;
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
export function findGenerationJob(id: string | undefined) {
  return generationJobs.find(job => job.localId === id || job.supersededTaskIds?.includes(id || ''));
}
const replacementLocks = reactive(new Set<string>());
export function modelReplacing(job: LocalJob | undefined) {
  if (!job) return false;
  return replacementLocks.has(job.modelId || job.localId) || generationJobs.some(task => task.replaces?.jobId === job.localId
    && !task.resultRejected && !task.geometry && (!task.remote ? !task.error : ['queued','running','cancel_requested','succeeded'].includes(task.remote.status)));
}
async function commitResult(job: LocalJob, geometry: PartGeometry) {
  if (!job.replaces) {
    const completed = { ...job, geometry };
    identifyModel(completed);
    const database = await db();
    await new Promise<void>((resolve,reject)=>{
      const tx=database.transaction(['jobs','models'],'readwrite');
      tx.objectStore('jobs').put(JSON.parse(JSON.stringify(completed)));
      tx.objectStore('models').put(modelRecord(completed));
      tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error);
    });
    Object.assign(job, completed);
    publishModel(job);
    return;
  }
  const database = await db(), expected = job.replaces;
  const replacement = await new Promise<LocalJob>((resolve, reject) => {
    const tx = database.transaction(['jobs','models'], 'readwrite'), store = tx.objectStore('jobs');
    const read = store.get(expected.jobId);
    let result: LocalJob, failure: Error | undefined;
    read.onsuccess = () => {
      const target = read.result as LocalJob | undefined;
      if (!target?.geometry || (target.modelId || target.localId) !== expected.modelId || (target.modelRevision || 1) !== expected.revision) {
        failure = Error('The original model changed or was removed. Generate a new model instead.'); tx.abort(); return;
      }
      identifyModel(target);
      const currentModel = tx.objectStore('models').get(expected.modelId);
      currentModel.onsuccess = () => {
      if (currentModel.result && currentModel.result.modelRevision !== expected.revision) {
        failure = Error('The model was replaced in another editor. Reopen it before retrying.'); tx.abort(); return;
      }
      result = { ...target, geometry, modelRevision:expected.revision + 1, connection:job.connection,
        request:job.request, remote:job.remote, deviceType:job.deviceType, createdAt:job.createdAt,
        saved:false, error:undefined, resultRejected:false,
        supersededTaskIds:[...(target.supersededTaskIds || []),job.localId] };
      identifyModel(result);
      store.put(JSON.parse(JSON.stringify(result)));
      tx.objectStore('models').put(modelRecord(result));
      store.delete(job.localId);
      };
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(failure || tx.error || Error('Could not replace model'));
  });
  const target = findGenerationJob(expected.jobId);
  if (target) Object.assign(target, replacement);
  else generationJobs.unshift(replacement);
  publishModel(replacement);
  const index = generationJobs.findIndex(task => task.localId === job.localId);
  if (index >= 0) generationJobs.splice(index, 1);
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
      const geometry: PartGeometry = {
        kind: "mesh",
        size,
        mesh: {
          modelId: job.modelId || job.localId,
          modelRevision: job.modelRevision || 1,
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
      // Publish completion only after the model is durably saved in this browser.
      if (job.remote && ['cancel_requested','cancelled','failed','expired'].includes(job.remote.status)) return;
      await commitResult(job, geometry);
      await client.ack(job.remote.id).catch(() => {});
      return;
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
export function loadGenerationJobs(): Promise<void> {
  return loading ??= (async () => {
    await loadGeneratedModels();
    const d = await db();
    const list = await new Promise<LocalJob[]>((resolve, reject) => {
      const r = d.transaction("jobs").objectStore("jobs").getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    for (const job of list) if (!job.replaces) { identifyModel(job); publishModel(job); }
    generationJobs.push(...list.sort((a, b) => b.createdAt - a.createdAt));
    void poll();
  })().catch(error => { loading = undefined; throw error; });
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
  source?: LocalJob['source'],
  onCreated?: (job: LocalJob) => void,
  replaces?: LocalJob['replaces'],
) {
  await loadGenerationJobs();
  const bytes = await (await fetch(image)).arrayBuffer();
  const job: LocalJob = {
    localId: crypto.randomUUID(),
    name,
    image,
    connection: { ...connection },
    createdAt: Date.now(),
    source: source ? { ...source } : undefined,
    replaces,
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
  job.modelId = replaces?.modelId || job.localId;
  job.modelRevision = replaces ? replaces.revision + 1 : 1;
  generationJobs.unshift(job);
  const reactiveJob = generationJobs[0]!;
  onCreated?.(reactiveJob);
  await submitJob(reactiveJob).catch(() => {});
  return reactiveJob;
}
export async function regenerateModel(target: LocalJob, mode: 'overwrite' | 'new', connection: GenerationConnection, onCreated?: (job: LocalJob) => void, source?: LocalJob['source']) {
  if (!target.geometry?.mesh || target.replaces) throw Error('Open a completed model before regenerating');
  identifyModel(target);
  if (mode === 'new') return createGenerationJob(target.name, target.image, connection, source || target.source, onCreated);
  if (modelReplacing(target)) throw Error('This model already has a replacement in progress');
  replacementLocks.add(target.modelId!);
  try {
    // Save legacy identity before creating the independently cancellable attempt.
    await persistJob(target);
    return await createGenerationJob(target.name, target.image, connection, source || target.source, onCreated,
      { jobId:target.localId, modelId:target.modelId!, revision:target.modelRevision! });
  } finally { replacementLocks.delete(target.modelId!); }
}
/** Imported/saved models can be regenerated even after their task history was removed. */
export async function registerExistingModel(name: string, image: string, original: PartGeometry, connection: GenerationConnection, source?: LocalJob['source']) {
  await loadGenerationJobs();
  const geometry = JSON.parse(JSON.stringify(resolveModelGeometry(original))) as PartGeometry;
  if (!geometry.mesh) throw Error('Model geometry is missing');
  const mesh = geometry.mesh;
  const existing = generationJobs.find(job => job.geometry?.mesh && (mesh.modelId
    ? job.modelId === mesh.modelId : job.geometry.mesh.sha256 === mesh.sha256 && job.request.inputSha256 === mesh.inputSha256));
  if (existing) return existing;
  if (await sha256(await (await fetch(image)).arrayBuffer()) !== mesh.inputSha256) throw Error('The original model image is unavailable');
  const job: LocalJob = { localId:crypto.randomUUID(), name, image, connection, source, geometry,
    modelId:mesh.modelId, modelRevision:mesh.modelRevision, legacyModelKeys:legacyKeysFor(mesh.modelId), createdAt:Date.now(),
    request:{ protocolVersion:1, clientRequestId:crypto.randomUUID(), providerId:mesh.providerId,
      inputSha256:mesh.inputSha256, targetFaces:mesh.generation?.targetFaces ?? connection.targetFaces,
      seed:mesh.generation?.seed ?? connection.seed, parameters:{...mesh.generation?.parameters} } };
  await commitResult(job, geometry);
  generationJobs.unshift(job);
  return generationJobs[0]!;
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
