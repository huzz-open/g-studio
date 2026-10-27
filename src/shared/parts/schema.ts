import { decodeMesh, type MeshGeometry } from './mesh'
import { normalSettings, DEFAULT_NORMAL_SETTINGS, type NormalSettings } from '../types/normal-settings'

export const PART_FORMAT = 'g-studio/part' as const
export const TEMPLATE_IDS = ['umbrella', 'barrel', 'chair', 'vase', 'chest', 'bonsai'] as const
export type TemplateId = typeof TEMPLATE_IDS[number]
export type Triple = [number, number, number]
export interface PartGeometry {
  kind: 'silhouette' | 'template' | 'mesh'
  size: Triple
  /** Reset baseline retained when a shape change preserves the authored size. */
  defaultSize?: Triple
  template?: TemplateId
  mesh?: MeshGeometry
}
export interface PartAsset {
  format: typeof PART_FORMAT
  version: 1 | 2
  id: string
  revision: number
  name: string
  image: { uri: string; width: number; height: number }
  normal: NormalSettings
  geometry: PartGeometry
  /** Previously selected shapes, including embedded models, for switching back. */
  geometryAlternatives?: PartGeometry[]
  alignment: { anchor: [number, number]; offset: [number, number]; scale: number }
  source?: { sheetHash: string; pixelHash: string; fileName: string; rect: [number, number, number, number]; gsPath?: string }
}
export function clonePart<T>(value: T): T { return JSON.parse(JSON.stringify(value)) }
export function partTemplate(part: Pick<PartAsset, 'id' | 'image'>): TemplateId | undefined {
  return TEMPLATE_IDS.find(id => part.image.uri === `builtin:${id}`)
    ?? TEMPLATE_IDS.find(id => part.id === `example:${id}`)
}
export function isPartGeometryAllowed(part: Pick<PartAsset, 'id' | 'image'>, geometry: PartGeometry): boolean {
  return geometry.kind === 'silhouette' || geometry.kind === 'mesh'
    || (geometry.kind === 'template' && geometry.template !== undefined && geometry.template === partTemplate(part))
}
export function nextPartRevision(incoming: number, current?: number): number {
  const revision = current === undefined ? incoming : current + 1
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Invalid part revision')
  return revision
}
function finite(v: unknown, min: number, max: number): v is number { return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max }
function tuple(v: unknown, n: number, min: number, max: number): boolean { return Array.isArray(v) && v.length === n && v.every(x => finite(x, min, max)) }
function object(v: unknown): v is Record<string, any> { return !!v && typeof v === 'object' && !Array.isArray(v) }
function validId(v:unknown):v is string{return typeof v==='string'&&/^[a-zA-Z0-9:_-]{1,160}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v)}
export function validatePart(value: unknown): asserts value is PartAsset {
  const fail = (s: string): never => { throw new Error(`Invalid part: ${s}`) }
  if (!object(value)) fail('object required')
  const v = value as Record<string, any>
  if (v.format !== PART_FORMAT || ![1, 2].includes(v.version)) fail('unsupported format/version')
  if (!validId(v.id)) fail('id')
  if (!Number.isSafeInteger(v.revision) || v.revision < 1) fail('revision')
  if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 120) fail('name')
  if (!object(v.image) || !Number.isInteger(v.image.width) || !Number.isInteger(v.image.height)
    || !finite(v.image.width, 1, 2048) || !finite(v.image.height, 1, 2048) || v.image.width * v.image.height > 4000000) fail('image dimensions')
  const uri = v.image.uri
  if (typeof uri !== 'string' || uri.length > 24000000 || !(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(uri)
    || TEMPLATE_IDS.some(id => uri === `builtin:${id}`))) fail('image must be embedded PNG or a known bundled asset')
  if (!object(v.normal) || !Object.keys(DEFAULT_NORMAL_SETTINGS).every(k => k in v.normal)) fail('normal settings')
  normalSettings(v.normal)
  const g = v.geometry
  validateGeometry(g, v.version, fail)
  if (!isPartGeometryAllowed(v as PartAsset, g)) fail('geometry does not belong to this part')
  if (v.geometryAlternatives !== undefined) {
    if (!Array.isArray(v.geometryAlternatives) || v.geometryAlternatives.length > 32) fail('geometry alternatives')
    for (const alternative of v.geometryAlternatives) {
      validateGeometry(alternative, v.version, fail)
      if (!isPartGeometryAllowed(v as PartAsset, alternative)) fail('geometry does not belong to this part')
    }
  }
  if (!object(v.alignment) || !tuple(v.alignment.anchor, 2, 0, 1) || !tuple(v.alignment.offset, 2, -4, 4) || !finite(v.alignment.scale, .25, 3)) fail('alignment')
  if (v.source !== undefined) {
    const s = v.source
    if (!object(s) || !/^[a-f0-9]{64}$/.test(s.sheetHash) || !/^[a-f0-9]{64}$/.test(s.pixelHash)
      || typeof s.fileName !== 'string' || s.fileName.length > 512 || !tuple(s.rect, 4, 0, 100000)
      || !s.rect.every(Number.isInteger) || s.rect[2] < 1 || s.rect[3] < 1 || (s.gsPath !== undefined && typeof s.gsPath !== 'string')) fail('source')
  }
}
function validateGeometry(g: any, version: number, fail: (message: string) => never) {
  if (!object(g) || !['silhouette', 'template', 'mesh'].includes(g.kind) || !tuple(g.size, 3, .02, 8)) fail('geometry')
  if (g.defaultSize !== undefined && !tuple(g.defaultSize, 3, .02, 8)) fail('geometry default size')
  if (g.kind === 'template' && !TEMPLATE_IDS.includes(g.template)) fail('unknown template')
  if (g.kind === 'mesh') {
    if (version !== 2 || !object(g.mesh) || typeof g.mesh.uri !== 'string' || !/^[a-f0-9]{64}$/.test(g.mesh.sha256) || !/^[a-f0-9]{64}$/.test(g.mesh.inputSha256) || typeof g.mesh.providerId !== 'string' || !Array.isArray(g.mesh.warnings) || !g.mesh.warnings.every((s:unknown)=>typeof s==='string')) fail('mesh metadata')
    decodeMesh(g.mesh.uri)
    if (g.mesh.modelId !== undefined && !validId(g.mesh.modelId)) fail('model id')
    if (g.mesh.modelRevision !== undefined && (!Number.isSafeInteger(g.mesh.modelRevision) || g.mesh.modelRevision < 1)) fail('model revision')
  }
}
export function createPart(name: string, image: PartAsset['image'], id: string = crypto.randomUUID()): PartAsset {
  const part: PartAsset = { format: PART_FORMAT, version: 1, id, revision: 1, name,
    image: { ...image }, normal: normalSettings(), geometry: { kind: 'silhouette', size: [Math.max(.05, Math.min(8, 2 * image.width / image.height)), 2, .08] },
    alignment: { anchor: [.5, 1], offset: [0, 0], scale: 1 } }
  validatePart(part); return part
}
export function sameSource(part: PartAsset, source: NonNullable<PartAsset['source']>) {
  return part.source?.sheetHash === source.sheetHash && part.source.pixelHash === source.pixelHash && part.source.rect.every((n, i) => n === source.rect[i])
}
export function partRenderKey(part: PartAsset) { return JSON.stringify([part.image, part.normal, part.geometry, part.alignment]) }
/** Inputs that affect the mesh, color texture and projected surface fields. */
export function partSurfaceKey(part: PartAsset) { return JSON.stringify([part.image, part.geometry, part.alignment]) }

export interface PartInstance { id: string; assetId: string; x: number; z: number; scale: number; visible: boolean; casts: boolean; receives: boolean }
export const MAX_SCENE_ITEMS = 24
export function validateInstances(items: unknown): asserts items is PartInstance[] {
  if (!Array.isArray(items) || items.length > MAX_SCENE_ITEMS) throw new Error('Invalid scene instance count')
  const ids = new Set<string>()
  for (const i of items) {
    if (!object(i) || !validId(i.id) || ids.has(i.id) || !validId(i.assetId)
      || !finite(i.x, -20, 20) || !finite(i.z, -20, 20) || !finite(i.scale, .2, 3)
      || !['visible', 'casts', 'receives'].every(k => typeof i[k] === 'boolean')) throw new Error('Invalid scene instance')
    ids.add(i.id)
  }
}
