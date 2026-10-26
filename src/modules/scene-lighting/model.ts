import { buildUmbrella } from '../experiments/umbrella/geometry'
import { add, cross, dot, normalize, scale, sub, type Vec3 } from '../experiments/umbrella/math'
import type { PartInstance } from '../../shared/parts/schema'

export type ItemId = 'umbrella' | 'barrel' | 'chair' | 'vase' | 'chest' | 'bonsai'
export type SceneKind = 'open' | 'corner'
export type DisplayMode = 'sprites' | 'geometry' | 'visibility'
export type Preset = 'spread' | 'wall' | 'mutual'
export type SceneItem = PartInstance
export interface RoomSize { width: number; depth: number; height: number }
export interface SunLight { azimuth: number; elevation: number; intensity: number }
export const DEFAULT_ROOM: RoomSize = {width:11,depth:9,height:4.8}
export function roomBounds(size:RoomSize=DEFAULT_ROOM){return {minX:-5.5,maxX:-5.5+size.width,minZ:-4,maxZ:-4+size.depth,height:size.height}}
export interface SceneState {
  room: RoomSize; lightKind:'point'|'directional'; sun: SunLight
  scene: SceneKind; mode: DisplayMode; selected: string; tool: 'objects' | 'light'
  items: SceneItem[]; light: Vec3; ambient: number; power: number
  showNames: boolean; shadows: boolean; filtered: boolean; zoom: number
  target?: Vec3
}
export const PITCH = 20, YAW = 25, ROOM = { minX: -5.5, maxX: 5.5, minZ: -4, maxZ: 5, height: 4.8 }
const yaw = YAW * Math.PI / 180, pitch = PITCH * Math.PI / 180
export const FORWARD: Vec3 = [-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)]
export const RIGHT = normalize(cross(FORWARD, [0, 1, 0]))
export const UP = cross(RIGHT, FORWARD)
export const DEFINITIONS: { id: ItemId; width: number; height: number; tint: Vec3 }[] = [
  { id: 'umbrella', width: 512, height: 557, tint: [0.83, 0.65, 0.38] },
  { id: 'barrel', width: 357, height: 455, tint: [0.59, 0.32, 0.14] },
  { id: 'chair', width: 367, height: 522, tint: [0.62, 0.34, 0.18] },
  { id: 'vase', width: 277, height: 430, tint: [0.57, 0.72, 0.83] },
  { id: 'chest', width: 473, height: 373, tint: [0.54, 0.3, 0.16] },
  { id: 'bonsai', width: 453, height: 465, tint: [0.27, 0.46, 0.24] },
]

export function createScene(preset: Preset = 'spread'): SceneState {
  const positions: Record<Preset, [number, number][]> = {
    spread: [[-2.8, -0.7], [0, -1.3], [2.8, -1], [-2.8, 2.7], [0, 2.4], [2.8, 2.8]],
    wall: [[-3.6, -2], [-0.8, -2.65], [2, -2.65], [-3.4, 1.4], [-0.3, 1.2], [2.7, 1.5]],
    mutual: [[-1.4, 0], [3, -1.1], [1.1, 1.1], [-0.55, -0.35], [1.2, -0.5], [-2.9, 1.5]],
  }
  return {
    room:{...DEFAULT_ROOM}, lightKind:'point', sun:{azimuth:45,elevation:45,intensity:1.2},
    scene: preset === 'wall' ? 'corner' : 'open', mode: 'sprites', selected: preset === 'mutual' ? 'vase' : 'umbrella', tool: 'objects',
    items: DEFINITIONS.map((d, i) => ({ id: d.id, assetId: `example:${d.id}`, scale: 1, x: positions[preset][i][0], z: positions[preset][i][1], visible: true, casts: true, receives: true })),
    light: preset === 'wall' ? [1.5, 3.5, 3.6] : preset === 'mutual' ? [-2.2, 5.5, 2.4] : [-2.8, 5, 2.5],
    showNames: true, ambient: 0.32, power: 26, shadows: true, filtered: true, zoom: 14,
  }
}

export interface Mesh { vertices: Float32Array; triangles: Vec3[][] }
export function meshBuilder() {
  const vertices: number[] = [], triangles: Vec3[][] = []
  function tri(a: Vec3, b: Vec3, c: Vec3, color: Vec3, normals?: Vec3[]) {
    const n = normalize(cross(sub(b, a), sub(c, a)))
    if (Math.hypot(...cross(sub(b, a), sub(c, a))) < 1e-8) return
    triangles.push([a, b, c])
    for (const [i, p] of [a, b, c].entries()) vertices.push(...p, ...(normals?.[i] && Math.hypot(...normals[i]) > 1e-8 ? normalize(normals[i]) : n), ...color.map(v => v ** 2.2))
  }
  function quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: Vec3) { tri(a, b, c, color); tri(a, c, d, color) }
  function box(x: number, y: number, z: number, w: number, h: number, depth: number, color: Vec3) {
    const a = x - w / 2, b = x + w / 2, c = z - depth / 2, d = z + depth / 2, top = y + h
    quad([a, y, d], [b, y, d], [b, top, d], [a, top, d], color)
    quad([b, y, c], [a, y, c], [a, top, c], [b, top, c], color)
    quad([b, y, d], [b, y, c], [b, top, c], [b, top, d], color)
    quad([a, y, c], [a, y, d], [a, top, d], [a, top, c], color)
    quad([a, top, c], [a, top, d], [b, top, d], [b, top, c], color)
    quad([a, y, d], [a, y, c], [b, y, c], [b, y, d], color)
  }
  function lathe(profile: [number, number][], color: Vec3, count = 24) {
    for (let j = 0; j < profile.length - 1; j++) for (let i = 0; i < count; i++) {
      const point = (ring: number, index: number): Vec3 => {
        const [radius, height] = profile[ring], angle = index / count * Math.PI * 2
        return [radius * Math.cos(angle), height, radius * Math.sin(angle)]
      }
      quad(point(j, i), point(j + 1, i), point(j + 1, i + 1), point(j, i + 1), color)
    }
  }
  function branch(a: Vec3, b: Vec3, radius: number, color: Vec3) {
    const axis = normalize(sub(b, a)), u = normalize(cross(axis, Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), v = cross(axis, u)
    const point = (p: Vec3, i: number) => add(p, add(scale(u, Math.cos(i * Math.PI / 6) * radius), scale(v, Math.sin(i * Math.PI / 6) * radius)))
    for (let i = 0; i < 12; i++) { quad(point(a, i), point(b, i), point(b, i + 1), point(a, i + 1), color); tri(b, point(b, i + 1), point(b, i), color) }
  }
  function ellipsoid(center: Vec3, radii: Vec3, color: Vec3) {
    const point = (j: number, i: number): Vec3 => {
      const latitude = -Math.PI / 2 + j * Math.PI / 8, longitude = i * Math.PI / 8
      return add(center, [radii[0] * Math.cos(latitude) * Math.cos(longitude), radii[1] * Math.sin(latitude), radii[2] * Math.cos(latitude) * Math.sin(longitude)])
    }
    for (let j = 0; j < 8; j++) for (let i = 0; i < 16; i++) quad(point(j, i), point(j + 1, i), point(j + 1, i + 1), point(j, i + 1), color)
  }
  return { tri, quad, box, lathe, branch, ellipsoid, build: (): Mesh => ({ vertices: new Float32Array(vertices), triangles }) }
}

export function buildItem(id: ItemId): Mesh {
  if (id === 'umbrella') {
    const mesh = buildUmbrella({ radius: 1.35, rimHeight: 2.3, rise: 0.6 })
    return { vertices: mesh.vertices.slice(mesh.groundVertices * 9), triangles: mesh.casterTriangles }
  }
  const b = meshBuilder(), wood: Vec3 = [0.59, 0.34, 0.19], dark: Vec3 = [0.26, 0.24, 0.2]
  if (id === 'barrel') {
    b.lathe([[0, 0], [.53, 0], [.62, .25], [.68, .8], [.62, 1.4], [.53, 1.6], [0, 1.6]], wood)
    for (const y of [.25, 1.25]) b.lathe([[.63, y], [.66, y], [.66, y + .09], [.63, y + .09]], dark)
  } else if (id === 'chair') {
    for (const x of [-.5, .5]) for (const z of [-.43, .43]) b.box(x, 0, z, .12, z < 0 ? 2.15 : 1.3, .12, wood)
    b.box(0, .79, 0, 1.22, .15, 1.08, wood)
    b.box(0, 2.06, -.43, 1.38, .18, .18, wood)
    b.box(0, 1.03, -.43, .33, .98, .12, wood)
    for (const x of [-.53, .53]) { b.box(x, 1.3, 0, .18, .11, 1.15, wood); b.box(x, .24, 0, .1, .1, .9, wood) }
    b.box(0, .25, .43, 1, .1, .1, wood)
  } else if (id === 'vase') {
    b.lathe([[0, 0], [.31, 0], [.34, .12], [.52, .45], [.56, .8], [.42, 1.17], [.22, 1.42], [.22, 1.65], [.35, 1.78], [.35, 1.84], [.28, 1.84], [.17, 1.64], [.17, 1.44], [0, 1.35]], [.62, .75, .88])
  } else if (id === 'chest') {
    b.box(0, 0, 0, 1.65, 1.02, .94, wood)
    b.box(0, 1.02, 0, 1.72, .16, 1.01, [.48, .27, .18])
    b.box(0, .63, .5, .22, .32, .06, [.7, .54, .25])
  } else {
    b.box(0, 0, 0, 1.15, .4, .85, [.26, .48, .45])
    b.box(0, .4, 0, 1.28, .11, .98, [.31, .5, .46])
    b.branch([0, .45, 0], [.23, 1.15, 0], .14, wood)
    b.branch([.23, 1.15, 0], [-.13, 1.6, 0], .11, wood)
    b.branch([-.13, 1.6, 0], [.12, 2.03, 0], .08, wood)
    for (const [a, c, r] of [[[-.05, 1.4, 0], [-.75, 1.32, .02], [.58, .2, .42]], [[.15, 1.15, 0], [.82, 1.54, 0], [.65, .22, .46]], [[-.13, 1.6, 0], [-.35, 1.96, 0], [.61, .24, .44]], [[.12, 2.03, 0], [.18, 2.2, 0], [.49, .23, .4]]] as [Vec3, Vec3, Vec3][]) {
      b.branch(a, c, .06, wood); b.ellipsoid(c, r, [.27, .43, .2])
    }
  }
  return b.build()
}

export function buildRoom(kind: SceneKind, size: RoomSize = DEFAULT_ROOM) {
  const b = meshBuilder(), { minX: x, maxX: X, minZ: z, maxZ: Z, height: h } = roomBounds(size)
  b.quad([x, 0, z], [x, 0, Z], [X, 0, Z], [X, 0, z], [.43, .45, .43])
  if (kind === 'corner') {
    b.quad([x, 0, z], [X, 0, z], [X, h, z], [x, h, z], [.65, .63, .55])
    b.quad([x, 0, Z], [x, 0, z], [x, h, z], [x, h, Z], [.56, .59, .55])
  }
  return b.build()
}

const limits = new Map<ItemId, { minX: number; maxX: number; minZ: number; maxZ: number }>()
export function movementLimits(id: ItemId) {
  if (!limits.has(id)) {
    const mesh = buildItem(id), xs: number[] = [], zs: number[] = []
    for (let i = 0; i < mesh.vertices.length; i += 9) { xs.push(mesh.vertices[i]); zs.push(mesh.vertices[i + 2]) }
    const lower = (v: number) => Math.ceil(v * 20) / 20, upper = (v: number) => Math.floor(v * 20) / 20
    limits.set(id, { minX: lower(ROOM.minX - Math.min(...xs) + .05), maxX: upper(ROOM.maxX - Math.max(...xs) - .05),
      minZ: lower(ROOM.minZ - Math.min(...zs) + .05), maxZ: upper(ROOM.maxZ - Math.max(...zs) - .05) })
  }
  return limits.get(id)!
}

export interface SpriteBounds { left: number; bottom: number; width: number; height: number }
export function spriteBounds(mesh: Mesh, aspect: number): SpriteBounds {
  const xs: number[] = [], ys: number[] = []
  for (let i = 0; i < mesh.vertices.length; i += 9) {
    const p = Array.from(mesh.vertices.slice(i, i + 3)) as Vec3
    xs.push(dot(p, RIGHT)); ys.push(dot(p, UP))
  }
  const minX = Math.min(...xs), maxX = Math.max(...xs), bottom = Math.min(...ys)
  const height = Math.max(...ys) - bottom, width = height * aspect
  return { left: (minX + maxX - width) / 2, bottom, width, height }
}

/** Independent CPU visibility oracle, also used by the receiver diagnostics. */
export function rayHit(origin: Vec3, target: Vec3, triangles: Vec3[][]): number | null {
  const direction = sub(target, origin)
  let nearest = Infinity
  for (const [a, b, c] of triangles) {
    const e1 = sub(b, a), e2 = sub(c, a), p = cross(direction, e2), det = dot(e1, p)
    if (Math.abs(det) < 1e-9) continue
    const inv = 1 / det, t = sub(origin, a), u = dot(t, p) * inv
    if (u < 0 || u > 1) continue
    const q = cross(t, e1), v = dot(direction, q) * inv
    if (v < 0 || u + v > 1) continue
    const distance = dot(e2, q) * inv
    if (distance > 1e-5 && distance < .9999) nearest = Math.min(nearest, distance)
  }
  return Number.isFinite(nearest) ? nearest : null
}
