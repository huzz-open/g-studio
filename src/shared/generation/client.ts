import type {
  Capabilities,
  GenerationJob,
  GenerationRequest,
  ServiceInfo,
} from "../../../packages/generation-protocol/types";
import type { GenerationConnection } from "./settings";
import { isLocalServiceHost } from './deployment';
import {
  parseCapabilities,
  parseJob,
} from "../../../packages/generation-protocol/validate";
export function endpoint(value: string, mode: 'direct' | 'relay' | 'silhouette' = 'direct') {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error("Invalid service URL");
  if (
    url.protocol === "http:" &&
    !(mode === 'direct' ? isLocalServiceHost(url.hostname) : ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  )
    throw Error("Public services require HTTPS; HTTP is available for local and private-network direct APIs");
  return value.replace(/\/+$/, "");
}
export class GenerationClient {
  readonly config: GenerationConnection;
  constructor(config: GenerationConnection) {
    this.config = { ...config };
  }
  async call(path: string, init: RequestInit = {}, raw = false) {
    const c = this.config,
      relay = c.mode === "relay",
      base = endpoint(relay ? c.relayUrl : c.baseUrl, c.mode),
      token = relay ? c.relayToken : c.token;
    const response = await fetch(base + path, {
      ...init,
      headers: { Authorization: "Bearer " + token, ...init.headers },
      signal: init.signal || AbortSignal.timeout(45000),
    });
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const v = await response.json();
        message = v.error?.message || message;
      } catch {}
      throw Error(message);
    }
    return raw ? response : response.json();
  }
  private devicePath(name: string) {
    return this.config.mode === "relay"
      ? `/v1/devices/${encodeURIComponent(this.config.deviceId)}/${name}`
      : `/v1/${name}`;
  }
  async info(signal?: AbortSignal): Promise<ServiceInfo> {
    const v = await this.call(
      this.devicePath("info") +
        "?providerId=" +
        encodeURIComponent(this.config.providerId), { signal },
    );
    if (!["cpu", "gpu"].includes(v.deviceType))
      throw Error("Unknown device type");
    if (v.backend !== undefined && typeof v.backend !== "string")
      throw Error("Invalid compute backend");
    if (v.reason !== undefined && typeof v.reason !== "string")
      throw Error("Invalid device reason");
    return v;
  }
  capabilities(signal?: AbortSignal): Promise<Capabilities> {
    return this.call(this.devicePath("capabilities"), { signal }).then(parseCapabilities);
  }
  submit(request: GenerationRequest, image: Blob): Promise<GenerationJob> {
    const data = new FormData();
    data.append("request", JSON.stringify(request));
    data.append("image", image, "input.png");
    return this.call("/v1/jobs", { method: "POST", body: data }).then(parseJob);
  }
  status(id: string): Promise<GenerationJob> {
    return this.call("/v1/jobs/" + encodeURIComponent(id)).then(parseJob);
  }
  cancel(id: string): Promise<GenerationJob> {
    return this.call("/v1/jobs/" + encodeURIComponent(id) + "/cancel", {
      method: "POST",
    }).then(parseJob);
  }
  ack(id: string) {
    return this.call("/v1/jobs/" + encodeURIComponent(id) + "/ack", {
      method: "POST",
    });
  }
  async output(id: string, outputId: string): Promise<ArrayBuffer> {
    const r: Response = await this.call(
        `/v1/jobs/${encodeURIComponent(id)}/outputs/${encodeURIComponent(outputId)}`,
        {},
        true,
      ),
      limit = 18 * 1024 * 1024;
    if (Number(r.headers.get("Content-Length")) > limit)
      throw Error("Output exceeds the browser mesh budget");
    const reader = r.body?.getReader();
    if (!reader) throw Error("Missing output body");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) {
          await reader.cancel();
          throw Error("Output exceeds the browser mesh budget");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      result.set(c, offset);
      offset += c.length;
    }
    return result.buffer;
  }
}
export async function sha256(data: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
