import { Matrix3, Matrix4, Quaternion, Vector3 } from "three";
import type { Mesh } from "../../modules/scene-lighting/model";
import { meshBuilder } from "../../modules/scene-lighting/model";
import type { Vec3 } from "../../modules/experiments/umbrella/math";

export interface MeshGeometry {
  providerVersion?: string;
  generation?: {
    seed?: number;
    targetFaces?: number;
    parameters: Record<string, number>;
  };
  uri: string;
  sha256: string;
  providerId: string;
  inputSha256: string;
  warnings: string[];
}
const cache = new Map<string, Mesh>();
const MAX_FACES = 40000;
/** Bounded, self-contained GLB importer. No network, extensions, skins or animation. */
export function decodeMesh(uri: string): Mesh {
  const cached = cache.get(uri);
  if (cached) return cached;
  const prefix = "data:model/gltf-binary;base64,";
  if (!uri.startsWith(prefix) || uri.length > 24 * 1024 * 1024)
    throw Error("Invalid/oversized embedded GLB");
  const raw = atob(uri.slice(prefix.length)),
    buffer = new ArrayBuffer(raw.length),
    bytes = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const view = new DataView(buffer);
  if (
    buffer.byteLength < 20 ||
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== buffer.byteLength
  )
    throw Error("Invalid GLB header");
  let document: any,
    binOffset = 0,
    binLength = 0;
  for (let offset = 12; offset + 8 <= buffer.byteLength; ) {
    const length = view.getUint32(offset, true),
      kind = view.getUint32(offset + 4, true);
    offset += 8;
    if (offset + length > buffer.byteLength) throw Error("Invalid GLB chunk");
    if (kind === 0x4e4f534a)
      document = JSON.parse(
        new TextDecoder().decode(bytes.subarray(offset, offset + length)),
      );
    else if (kind === 0x004e4942) {
      binOffset = offset;
      binLength = length;
    }
    offset += length;
  }
  const d = document;
  if (
    !d ||
    !binOffset ||
    d.asset?.version !== "2.0" ||
    d.buffers?.length !== 1 ||
    d.buffers[0].uri ||
    d.buffers[0].byteLength > binLength ||
    d.extensionsRequired?.length ||
    d.skins?.length
  )
    throw Error("Unsupported GLB content");
  if (d.images?.some((i: any) => i.uri))
    throw Error("External GLB resources are not allowed");
  function accessor(id: number, width: number): number[] {
    const a = d.accessors?.[id],
      b = d.bufferViews?.[a?.bufferView];
    const size: Record<number, number> = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };
    if (
      !a ||
      !b ||
      a.sparse ||
      a.normalized ||
      b.buffer !== 0 ||
      !Number.isSafeInteger(a.count) ||
      a.count < 1 ||
      a.count > MAX_FACES * 3 ||
      a.type !== (width === 3 ? "VEC3" : "SCALAR") ||
      !size[a.componentType]
    )
      throw Error("Unsupported accessor");
    if (width === 3 && a.componentType !== 5126)
      throw Error("Positions must be floats");
    const bytesPer = size[a.componentType]!,
      stride = b.byteStride || width * bytesPer,
      start = (b.byteOffset || 0) + (a.byteOffset || 0),
      end = start + (a.count - 1) * stride + width * bytesPer;
    if (
      !Number.isSafeInteger(stride) ||
      stride < width * bytesPer ||
      start < 0 ||
      end > binLength ||
      end > (b.byteOffset || 0) + b.byteLength
    )
      throw Error("Accessor out of bounds");
    const out: number[] = [];
    for (let i = 0; i < a.count; i++)
      for (let j = 0; j < width; j++) {
        const p = binOffset + start + i * stride + j * bytesPer,
          n =
            a.componentType === 5126
              ? view.getFloat32(p, true)
              : bytesPer === 1
                ? view.getUint8(p)
                : bytesPer === 2
                  ? view.getUint16(p, true)
                  : view.getUint32(p, true);
        if (!Number.isFinite(n)) throw Error("Non-finite geometry");
        out.push(n);
      }
    return out;
  }
  const builder = meshBuilder(),
    active = new Set<number>();
  let faces = 0,
    nodes = 0;
  function visit(id: number, parent: Matrix4) {
    if (active.has(id) || ++nodes > 1000) throw Error("Invalid GLB node graph");
    const node = d.nodes?.[id];
    if (!node) throw Error("Missing node");
    active.add(id);
    const local = node.matrix
      ? new Matrix4().fromArray(node.matrix)
      : new Matrix4().compose(
          new Vector3(...(node.translation || [0, 0, 0])),
          new Quaternion(...(node.rotation || [0, 0, 0, 1])),
          new Vector3(...(node.scale || [1, 1, 1])),
        );
    const world = parent.clone().multiply(local);
    if (!world.elements.every(Number.isFinite))
      throw Error("Invalid node transform");
    if (node.mesh !== undefined) {
      const mesh = d.meshes?.[node.mesh];
      if (!mesh) throw Error("Missing mesh");
      for (const p of mesh.primitives) {
        if ((p.mode !== undefined && p.mode !== 4) || p.extensions || p.targets)
          throw Error("Only uncompressed triangles are supported");
        const positions = accessor(p.attributes.POSITION, 3),
          normals =
            p.attributes.NORMAL === undefined
              ? undefined
              : accessor(p.attributes.NORMAL, 3),
          normalMatrix = new Matrix3().getNormalMatrix(world),
          indices =
            p.indices === undefined
              ? Array.from({ length: positions.length / 3 }, (_, i) => i)
              : accessor(p.indices, 1);
        if (normals && normals.length !== positions.length)
          throw Error("Invalid normal count");
        if (indices.length % 3 || faces + indices.length / 3 > MAX_FACES)
          throw Error("Triangle budget exceeded");
        faces += indices.length / 3;
        for (let i = 0; i < indices.length; i += 3) {
          const tri = indices.slice(i, i + 3).map((index) => {
            if (
              !Number.isInteger(index) ||
              index < 0 ||
              index * 3 + 2 >= positions.length
            )
              throw Error("Invalid triangle index");
            const v = new Vector3(
              positions[index * 3],
              positions[index * 3 + 1],
              positions[index * 3 + 2],
            ).applyMatrix4(world);
            if (
              !v
                .toArray()
                .every((n) => Number.isFinite(n) && Math.abs(n) <= 10000)
            )
              throw Error("Invalid vertex bounds");
            return v.toArray() as Vec3;
          });
          const ns = normals
            ? indices
                .slice(i, i + 3)
                .map(
                  (index) =>
                    new Vector3(
                      normals[index * 3],
                      normals[index * 3 + 1],
                      normals[index * 3 + 2],
                    )
                      .applyMatrix3(normalMatrix)
                      .normalize()
                      .toArray() as Vec3,
                )
            : undefined;
          if (world.determinant() < 0) {
            [tri[1], tri[2]] = [tri[2]!, tri[1]!];
            if (ns) [ns[1], ns[2]] = [ns[2]!, ns[1]!];
          }
          builder.tri(tri[0]!, tri[1]!, tri[2]!, [0.56, 0.58, 0.53], ns);
        }
      }
    }
    for (const child of node.children || []) visit(child, world);
    active.delete(id);
  }
  const roots = d.scenes?.[d.scene || 0]?.nodes;
  if (!roots?.length) throw Error("GLB scene missing");
  for (const id of roots) visit(id, new Matrix4());
  const mesh = builder.build();
  if (!mesh.triangles.length) throw Error("Empty mesh");
  cache.set(uri, mesh);
  while (cache.size > 8) cache.delete(cache.keys().next().value!);
  return mesh;
}

export function meshDataUri(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (let i = 0; i < bytes.length; i += 8192)
    str += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return "data:model/gltf-binary;base64," + btoa(str);
}
