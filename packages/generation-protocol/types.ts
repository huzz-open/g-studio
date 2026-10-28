export type DeviceType = "cpu" | "gpu";
export interface ServiceInfo {
  deviceType: DeviceType;
  /** Local service reports cpu/cuda/mps; third-party providers may use other names. */
  backend?: string;
  reason?: string;
}
export interface GenerationRequest {
  protocolVersion: 1;
  clientRequestId: string;
  providerId: string;
  inputSha256: string;
  targetFaces?: number;
  seed?: number;
  parameters?: Record<string, number>;
}
export interface Provider {
  providerId: string;
  name: string;
  state: string;
  error?: string | null;
  /** Absent on old services: only state=ready accepts submissions. */
  acceptsJobs?: boolean;
  tags?: ("推荐" | "快速" | "均衡" | "精细")[];
  strategy?: "resident" | "staged";
  precision?: "fp16" | "fp32";
  imageEncoderPrecision?: "fp16" | "fp32";
  preparationSeconds?: number;
  loadSeconds?: number;
  warmupSeconds?: number;
  instanceId?: string;
  loadCount?: number;
  parameters: Record<
    string,
    {
      min: number;
      max: number;
      default: number;
      step?: number;
      integer?: boolean;
    }
  >;
}
export interface Capabilities {
  protocolVersion: number;
  providers: Provider[];
  limits: {
    inputBytes: number;
    inputDimension: number;
    outputBytes: number;
    concurrency: number;
    queue: number;
  };
  targetFaces: { min: number; max: number; default: number };
}
export interface JobTimings {
  totalSeconds: number;
  queueSeconds: number;
  executionSeconds: number;
}
export interface GenerationResult {
  timings?: JobTimings;
  strategy?: "resident" | "staged";
  precision?: "fp16" | "fp32";
  imageEncoderPrecision?: "fp16" | "fp32";
  instanceId?: string;
  providerVersion?: string;
  parameters?: GenerationRequest;
  deviceType?: DeviceType;
  backend?: string;
  elapsedSeconds?: number;
  protocolVersion: number;
  jobId: string;
  providerId: string;
  inputSha256: string;
  triangles: number;
  bounds: number[][];
  coordinateSystem: string;
  warnings: string[];
  outputs: { id: string; mime: string; bytes: number; sha256: string }[];
}
export interface GenerationJob {
  timings?: JobTimings;
  id: string;
  status:
    | "queued"
    | "running"
    | "cancel_requested"
    | "cancelled"
    | "succeeded"
    | "failed"
    | "expired";
  phase: string;
  result?: GenerationResult;
  error?: { code: string; message: string; retryable: boolean };
}
