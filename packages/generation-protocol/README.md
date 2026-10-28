# Generation protocol v1

Language- and model-independent contract for AI and algorithm providers. [Documentation index](../../docs/README.md) · [Backend deployment](../../services/generation-python/README.md)

## Contract files

| File | Purpose |
| --- | --- |
| [types.ts](./types.ts) | TypeScript request, job, capability and result types |
| [schema.json](./schema.json) | JSON validation schemas |
| [openapi.json](./openapi.json) | HTTP transport and authentication |
| [providers.py](../../services/generation-python/providers.py) | Built-in Python provider registry |

Update these contracts together when extending the protocol.

## HTTP endpoints

Except for `/health`, endpoints require `Authorization: Bearer <token>`. Local HTTP binds to loopback; remote direct deployments require TLS and an explicit CORS origin allowlist.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Process health |
| GET | `/v1/info` | Selected provider's `deviceType`: `cpu` or `gpu`; optional `backend` (`cpu`/`cuda`/`mps` locally) and diagnostic `reason`; unknown device returns structured 503 |
| GET | `/v1/capabilities` | Provider readiness, parameters and service limits |
| POST | `/v1/jobs` | Submit multipart `request` JSON and `image` PNG/JPEG/WebP |
| GET | `/v1/jobs/{id}` | Poll job status and result metadata |
| POST | `/v1/jobs/{id}/cancel` | Idempotent cancellation |
| GET | `/v1/jobs/{id}/outputs/shadow` | Download generated GLB |
| POST | `/v1/jobs/{id}/ack` | Confirm durable local storage and permit cleanup |

## Request and lifecycle

Example multipart `request` field (replace the digest with SHA256 of the exact uploaded bytes):

```json
{
  "protocolVersion": 1,
  "clientRequestId": "unique-client-request-id",
  "providerId": "hunyuan-mini",
  "inputSha256": "<64-character lowercase SHA256>",
  "targetFaces": 12000,
  "seed": 12345,
  "parameters": { "steps": 5, "resolution": 256 }
}
```

Read capabilities before choosing provider parameters; unsupported values are errors. `clientRequestId` is scoped to the caller. Reusing it with different input returns HTTP 409.

1. Submit the request. HTTP 202 means accepted, not completed.
2. Poll until terminal; the job type includes queued, running, cancel_requested, cancelled, succeeded, failed and expired.
3. After success, download the output and verify its byte size and SHA256.
4. Persist the asset locally, then acknowledge it.

Without acknowledgment, terminal task files remain for up to 24 hours. Task storage is temporary and is not an asset database.

## Geometry result

| Property | Contract |
| --- | --- |
| Format | Self-contained GLB 2.0 triangle geometry |
| Coordinates | Right-handed, Y-up, grounded, horizontally centered |
| Scale | Longest source dimension normalized to 2; no guaranteed real-world units or inferred camera direction |
| Unsupported by first client | External resources, skins, morph targets and compressed geometry extensions |
| Frontend import limit | 40,000 triangles and approximately 18MiB binary mesh |
| Service transfer ceiling | 128MiB; this does not override client rendering limits |

The result manifest includes provider/input identity, triangle count, bounds, warnings, output size and digest. See [part v2 storage](../../docs/reference/parts.md) for durable frontend assets.

## Relay transport

Browser grants belong to a device and task owner; they differ from the worker's long-lived secret. WSS RPC methods are `info`, `capabilities`, `submit`, `status`, `cancel`, `upload` and `ack`, each with a random correlation ID.

Images and GLBs use authenticated task-scoped HTTP transfers. The relay job ID becomes the worker's idempotency key for repeated submissions. No generic command execution or arbitrary URL proxy is exposed. Deployment, pairing and grant lifetime are documented in the [relay guide](../../services/generation-relay/README.md).

## Add a Python provider

1. Subclass `Provider` and implement `generate(folder, request)`, writing `raw.glb`.
2. Register it in `PROVIDERS`; declare parameter bounds and GPU support.
3. Built-in Hunyuan model entries also require a pinned `model_catalog.py` profile (resource/shape/capacity metadata), a compatible shape adapter and a trusted `prepare_command()`. Readiness and errors are tracked per provider; executable paths never come from requests.
4. Exercise it through the HTTP and relay tests in the [development guide](../../CONTRIBUTING.md#python-与真实推理).

The common runner normalizes and simplifies output and builds the manifest. Pure algorithms require no weights. Staged cancellation terminates only the task process tree; resident cancellation signals only the active task. Executable code or module paths must not come from requests.

## Loading, residency and timing

A `disabled` provider is not enabled in this startup configuration; this does not claim its cached weights are absent. Providers may advertise `acceptsJobs` while `state` is `preparing`, `loading` or `warming`. Clients without that field retain the old ready-only rule. HTTP health is independent of model readiness. A queued cancellation does not stop shared startup preparation; running resident cancellation is acknowledged at a task boundary, preserving the instance. Failed preparation ends affected queued tasks. The initial service has one active task and eight live queued tasks; cancelled queue entries do not consume capacity.

Optional `tags` contain up to two distinct server-selected values: `推荐`, `快速`, `均衡`, `精细`. Localize these separately from loading status. At most one provider is recommended; failed/disabled providers cannot be recommended. Optional `strategy` is `resident` (loaded once and reused) or `staged` (phase allocations released). `instanceId`, `loadCount`, preparation/load/warmup seconds and warmup scope describe actual initialization. A staged-ready provider has verified resources, not resident weights.

Terminal jobs expose monotonic `timings`: total from submission, execution from dispatch (including staged loading), and their queue/wait difference. Failed/cancelled tasks also have timings; queued cancellation has zero execution. The backend, precision and strategy are fixed at startup. Execution errors do not trigger retries or device/model/strategy substitution. Restarted unfinished tasks report `INTERRUPTED` and require explicit resubmission.

`precision` reports fixed sampling/decoding precision; optional `imageEncoderPrecision` reports the image encoder separately (Mini/MPS uses FP32). Both fields are chosen before loading and never changed after a task failure.
