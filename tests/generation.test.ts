import { test } from "node:test";
import {
  parseCapabilities,
  parseJob,
} from "../packages/generation-protocol/validate.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GenerationClient } from "../src/shared/generation/client.ts";

test("device diagnostics stay compatible across clients and published schemas", async (t) => {
  const client = new GenerationClient({
    mode: "direct", baseUrl: "http://127.0.0.1:8765", token: "",
    relayUrl: "", relayToken: "", deviceId: "", providerId: "hunyuan-mini",
    targetFaces: 12000, seed: 12345, parametersByProvider: {},
  });
  let response: Record<string, unknown> = { deviceType: "cpu" };
  t.mock.method(client, "call", async () => response);
  assert.deepEqual(await client.info(), response);
  response = { deviceType: "gpu", backend: "mps", reason: "MPS device operation passed" };
  assert.deepEqual(await client.info(), response);
  const schema = JSON.parse(readFileSync(new URL("../packages/generation-protocol/schema.json", import.meta.url), "utf8"));
  const api = JSON.parse(readFileSync(new URL("../packages/generation-protocol/openapi.json", import.meta.url), "utf8"));
  assert.deepEqual(api.components.schemas.Info, schema.$defs.Info);
  assert.deepEqual(Object.keys(response).sort(), Object.keys(schema.$defs.Info.properties).sort());
  for (const invalid of [{ backend: 7 }, { reason: {} }, { deviceType: "unknown" }]) {
    response = { deviceType: "gpu", backend: "mps", reason: "ready", ...invalid };
    await assert.rejects(client.info());
  }
});

test("third-party capabilities accept new provider IDs and reject malformed or unsafe identifiers", () => {
  const value = {
    protocolVersion: 1,
    providers: [
      {
        providerId: "custom-algorithm",
        name: "Custom",
        state: "ready",
        parameters: { quality: { min: 1, max: 4, default: 2 } },
      },
    ],
    limits: {
      inputBytes: 100,
      inputDimension: 100,
      outputBytes: 1000,
      concurrency: 1,
      queue: 4,
    },
    targetFaces: { min: 1000, max: 40000, default: 12000 },
  };
  assert.equal(
    parseCapabilities(value).providers[0]!.providerId,
    "custom-algorithm",
  );
  assert.throws(() =>
    parseCapabilities({
      ...value,
      providers: [{ ...value.providers[0], providerId: "constructor" }],
    }),
  );
  assert.throws(() =>
    parseCapabilities({
      ...value,
      providers: [
        {
          ...value.providers[0],
          parameters: { quality: { min: 10, max: 1, default: 2 } },
        },
      ],
    }),
  );
  assert.throws(() =>
    parseJob({ id: "task", status: "succeeded", phase: "complete" }),
  );
});
import { decodeMesh, meshDataUri } from "../src/shared/parts/mesh.ts";
import { createPart, validatePart } from "../src/shared/parts/schema.ts";
import { buildPartGeometry } from "../src/modules/scene-lighting/part-geometry.ts";

function glb(mutate: (d: any) => void = () => {}) {
  const binary = new ArrayBuffer(36);
  new Float32Array(binary).set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const d: any = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  mutate(d);
  const text = JSON.stringify(d),
    json = Buffer.from(text + " ".repeat((4 - (text.length % 4)) % 4)),
    result = new ArrayBuffer(12 + 8 + json.length + 8 + 36),
    v = new DataView(result);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, result.byteLength, true);
  v.setUint32(12, json.length, true);
  v.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(result, 20, json.length).set(json);
  v.setUint32(20 + json.length, 36, true);
  v.setUint32(24 + json.length, 0x004e4942, true);
  new Uint8Array(result, 28 + json.length).set(new Uint8Array(binary));
  return result;
}
test("GLB import preserves transforms and produces existing shadow-renderer triangles", () => {
  const mesh = decodeMesh(
    meshDataUri(
      glb((d) => {
        d.nodes[0].translation = [2, 0, 0];
      }),
    ),
  );
  assert.equal(mesh.triangles.length, 1);
  assert.deepEqual(mesh.triangles[0]![0], [2, 0, 0]);
  assert.ok([...mesh.vertices].every(Number.isFinite));
});
test("GLB rejects external resources, out-of-range accessors and cyclic nodes", () => {
  for (const change of [
    (d: any) => {
      d.buffers[0].uri = "https://example.com/private";
    },
    (d: any) => {
      d.images = [{ uri: "file:///secret" }];
    },
    (d: any) => {
      d.accessors[0].count = 100;
    },
    (d: any) => {
      d.nodes[0].children = [0];
    },
    (d: any) => {
      d.accessors[0].componentType = 5125;
    },
  ])
    assert.throws(() => decodeMesh(meshDataUri(glb(change))));
});
test("mesh part v2 round-trips and rejects mesh payloads under v1", () => {
  const p = createPart("mesh", {
    uri: "data:image/png;base64,AAAA",
    width: 1,
    height: 1,
  });
  p.version = 2;
  p.geometry = {
    kind: "mesh",
    size: [2, 2, 0.02],
    mesh: {
      uri: meshDataUri(glb()),
      sha256: "a".repeat(64),
      inputSha256: "b".repeat(64),
      providerId: "test",
      warnings: [],
    },
  };
  validatePart(JSON.parse(JSON.stringify(p)));
  assert.equal(
    buildPartGeometry(p, {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray(4),
    }).triangles.length,
    1,
  );
  p.version = 1;
  assert.throws(() => validatePart(p));
});
