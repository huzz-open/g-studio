export type DeviceType = "cpu" | "gpu";
export interface ServiceInfo {
  deviceType: DeviceType;
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
  error?: string;
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
export interface GenerationResult {
  providerVersion?: string;
  parameters?: GenerationRequest;
  deviceType?: DeviceType;
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
