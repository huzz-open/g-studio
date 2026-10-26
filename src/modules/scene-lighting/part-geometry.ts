import { decodeMesh } from '../../shared/parts/mesh'
import { type PartAsset, type PartGeometry, type TemplateId, type Triple } from '../../shared/parts/schema'
import { buildItem, meshBuilder, roomBounds, type RoomSize, spriteBounds, YAW, type Mesh } from './model'
import { normalize, type Vec3 } from '../experiments/umbrella/math'

export function meshExtents(mesh: Mesh) {
  const min: Triple = [Infinity, Infinity, Infinity], max: Triple = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < mesh.vertices.length; i += 9) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], mesh.vertices[i + axis]); max[axis] = Math.max(max[axis], mesh.vertices[i + axis])
  }
  if (!Number.isFinite(min[0])) throw new Error('部件没有可见轮廓')
  return { min, max, size: max.map((v, i) => Math.max(.001, v - min[i])) as Triple }
}
function resize(mesh: Mesh, size: Triple): Mesh {
  const bounds = meshExtents(mesh), factor = size.map((v, i) => v / bounds.size[i])
  const transform = (p: Vec3): Vec3 => [(p[0] - (bounds.min[0] + bounds.max[0]) / 2) * factor[0], (p[1] - bounds.min[1]) * factor[1], (p[2] - (bounds.min[2] + bounds.max[2]) / 2) * factor[2]]
  const vertices = mesh.vertices.slice()
  for (let i = 0; i < vertices.length; i += 9) {
    vertices.set(transform(Array.from(vertices.slice(i, i + 3)) as Vec3), i)
    vertices.set(normalize(Array.from(vertices.slice(i + 3, i + 6)).map((v, j) => v / factor[j]) as Vec3), i + 3)
  }
  return { vertices, triangles: mesh.triangles.map(tri => tri.map(transform)) }
}
export function templateGeometry(id: TemplateId): PartGeometry { return { kind: 'template', template: id, size: meshExtents(buildItem(id)).size } }
export function buildPartGeometry(part: PartAsset, pixels: { width: number; height: number; data: Uint8ClampedArray }): Mesh {
  const g = part.geometry, color: Vec3 = [.56, .58, .53]
  if (g.kind === 'mesh') return resize(decodeMesh(g.mesh!.uri), g.size)
  if (g.kind === 'template') return resize(buildItem(g.template!), g.size)
  const builder = meshBuilder()
  if (g.kind === 'box') builder.box(0, 0, 0, 1, 1, 1, color)
  else if (g.kind === 'cylinder') builder.lathe([[0, 0], [.5, 0], [.5, 1], [0, 1]], color)
  else if (g.kind === 'compound') {
    for (const p of g.parts!) {
      if (p.shape === 'box') builder.box(...p.position, ...p.size, color)
      else if (p.shape === 'ellipsoid') builder.ellipsoid([p.position[0], p.position[1] + p.size[1] / 2, p.position[2]], p.size.map(v => v / 2) as Vec3, color)
      else {
        const unit = meshBuilder(); unit.lathe([[0, 0], [.5, 0], [.5, 1], [0, 1]], color)
        const mesh = resize(unit.build(), p.size)
        for (const [a, b, c] of mesh.triangles) builder.tri(...[a, b, c].map(v => v.map((n, i) => n + p.position[i]) as Vec3) as [Vec3, Vec3, Vec3], color)
      }
    }
  } else {
    // Explicitly approximate: an upright thin silhouette, not an inferred solid object.
    const ratio = Math.min(1, 64 / Math.max(pixels.width, pixels.height))
    const w = Math.max(1, Math.ceil(pixels.width * ratio)), h = Math.max(1, Math.ceil(pixels.height * ratio)), mask = new Uint8Array(w * h)
    for (let y = 0; y < pixels.height; y++) for (let x = 0; x < pixels.width; x++) if (pixels.data[(y * pixels.width + x) * 4 + 3] >= 60) mask[Math.min(h - 1, Math.floor(y * ratio)) * w + Math.min(w - 1, Math.floor(x * ratio))] = 1
    for (let y = 0; y < h; y++) {
      let start = -1
      for (let x = 0; x <= w; x++) {
        if (x < w && mask[y * w + x]) { if (start < 0) start = x }
        else if (start >= 0) { builder.box((start + x) / 2 / w - .5, (h - y - 1) / h, 0, (x - start) / w, 1 / h, .04, color); start = -1 }
      }
    }
    const mesh = resize(builder.build(), g.size), angle = YAW * Math.PI / 180
    const rotate = (v: Vec3): Vec3 => [v[0] * Math.cos(angle) + v[2] * Math.sin(angle), v[1], -v[0] * Math.sin(angle) + v[2] * Math.cos(angle)]
    for (let i = 0; i < mesh.vertices.length; i += 9) for (const offset of [0, 3]) mesh.vertices.set(rotate(Array.from(mesh.vertices.slice(i + offset, i + offset + 3)) as Vec3), i + offset)
    mesh.triangles = mesh.triangles.map(tri => tri.map(rotate)); return mesh
  }
  return resize(builder.build(), g.size)
}
export function alignedBounds(part: PartAsset, mesh: Mesh) {
  const base = spriteBounds(mesh, part.image.width / part.image.height)
  const width = base.width * part.alignment.scale, height = base.height * part.alignment.scale
  return { width, height, left: -width * part.alignment.anchor[0] + part.alignment.offset[0], bottom: -height * (1 - part.alignment.anchor[1]) + part.alignment.offset[1] }
}
export function partMovementLimits(part: PartAsset | undefined, scale = 1, room?: RoomSize) {
  const ROOM=roomBounds(room)
  let width=part?.geometry.size[0]??1,depth=part?.geometry.size[2]??1
  if(part?.geometry.kind==='silhouette'){const angle=YAW*Math.PI/180;[width,depth]=[width*Math.cos(angle)+depth*Math.sin(angle),width*Math.sin(angle)+depth*Math.cos(angle)]}
  const w = Math.min(ROOM.maxX - ROOM.minX - .1, width * scale)
  const d = Math.min(ROOM.maxZ - ROOM.minZ - .1, depth * scale)
  const lower = (v: number) => Math.ceil(v * 100) / 100, upper = (v: number) => Math.floor(v * 100) / 100
  return { minX: lower(ROOM.minX + w / 2 + .05), maxX: upper(ROOM.maxX - w / 2 - .05), minZ: lower(ROOM.minZ + d / 2 + .05), maxZ: upper(ROOM.maxZ - d / 2 - .05) }
}
