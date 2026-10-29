import { decodeMesh, type MeshGeometry } from './mesh'
import type { GeometryRepair } from '../../modules/scene-lighting/geometry-repair'
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
  /** Explicitly adopted model snapshots do not follow background regeneration. */
  frozen?: boolean
  original?: boolean
  repair?: GeometryRepair
  /** Projection registration; size is the baseline for subsequent manual edits. */
  imageFit?: {
    size: Triple; target: [number, number, number, number]; rotation?: Triple
    mode?: 'similarity'; projection?: Triple
    orientation?: { rotation: Triple; projection?: Triple; score: number; initialScore: number; meshSha256: string; method?: 'silhouette-similarity-v1' | 'surface-preserving-v2'; alignmentKey?: string; referenceRotation?: Triple; surfaceRetention?: number; reviewRequired?: boolean }
  }
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
  modelComparison?: {
    source: PartGeometry; sourceAlignment: PartAsset['alignment']; inputKey: string
    candidate?: PartGeometry; candidateAlignment?: PartAsset['alignment']
    selected: 'original' | 'optimized'
  }
  /** Previously selected shapes, including embedded models, for switching back. */
  geometryAlternatives?: PartGeometry[]
  alignment: { anchor: [number, number]; offset: [number, number]; scale: number; height?: number }
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
  if(v.modelComparison!==undefined){
    const c=v.modelComparison
    if(!object(c)||!['original','optimized'].includes(c.selected)||typeof c.inputKey!=='string'||c.inputKey.length>200)fail('model comparison')
    validateGeometry(c.source,v.version,fail)
    if(c.source.kind!=='mesh'||!c.source.original||!c.source.frozen)fail('comparison source')
    if(g.kind!=='mesh'||!g.frozen||g.mesh.sha256!==c.source.mesh.sha256||(c.selected==='original'&&!g.original)||(c.selected==='optimized'&&(g.original||!c.candidate)))fail('comparison selection')
    const alignment=(a:any)=>object(a)&&tuple(a.anchor,2,0,1)&&tuple(a.offset,2,-4,4)&&finite(a.scale,.25,3)&&finite(a.height,.001,64)
    if(!alignment(c.sourceAlignment))fail('comparison alignment')
    if(c.candidate!==undefined){validateGeometry(c.candidate,v.version,fail);if(c.candidate.kind!=='mesh'||!c.candidate.frozen||c.candidate.original||c.candidate.mesh.sha256!==c.source.mesh.sha256||!alignment(c.candidateAlignment))fail('comparison candidate')}
  }
  if (v.geometryAlternatives !== undefined) {
    if (!Array.isArray(v.geometryAlternatives) || v.geometryAlternatives.length > 32) fail('geometry alternatives')
    for (const alternative of v.geometryAlternatives) {
      validateGeometry(alternative, v.version, fail)
      if (!isPartGeometryAllowed(v as PartAsset, alternative)) fail('geometry does not belong to this part')
    }
  }
  if (!object(v.alignment) || !tuple(v.alignment.anchor, 2, 0, 1) || !tuple(v.alignment.offset, 2, -4, 4) || !finite(v.alignment.scale, .25, 3)) fail('alignment')
  if (v.alignment.height !== undefined && !finite(v.alignment.height, .001, 64)) fail('image height')
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
  if(g.frozen!==undefined&&typeof g.frozen!=='boolean')fail('frozen geometry')
  if(g.original!==undefined&&(typeof g.original!=='boolean'||g.kind!=='mesh'||(g.original&&(g.imageFit||g.repair))))fail('original geometry')
  if(g.repair!==undefined){
    const r=g.repair
    if(g.kind!=='mesh'||!object(r)||![1,2].includes(r.version)||typeof r.enabled!=='boolean'||typeof r.key!=='string'||r.key.length>16384
      ||!Number.isInteger(r.width)||!Number.isInteger(r.height)||!finite(r.width,1,2048)||!finite(r.height,1,2048)||r.width*r.height>1048576
      ||!tuple(r.bounds,4,-256,256)||r.bounds[2]<=0||r.bounds[3]<=0||!Array.isArray(r.runs)||r.runs.length<1||r.runs.length>524288)fail('geometry repair')
    if(r.status!==undefined&&!['repaired','unsupported-topology','unsupported-cut'].includes(r.status))fail('repair status')
    let row=-1,end=0
    for(const run of r.runs){
      if(!tuple(run,3,0,2048)||!run.every(Number.isInteger)||run[0]>=r.height||run[1]>=run[2]||run[2]>r.width||run[0]<row||(run[0]===row&&run[1]<end))fail('repair mask')
      row=run[0];end=run[2]
    }
  }
  if (g.imageFit !== undefined && (!object(g.imageFit) || !tuple(g.imageFit.size, 3, .02, 8)
    || !tuple(g.imageFit.target, 4, -256, 256) || g.imageFit.target[2] <= 0 || g.imageFit.target[3] <= 0)) fail('image fit')
  if (g.imageFit?.rotation !== undefined && !tuple(g.imageFit.rotation, 3, -180, 180)) fail('image fit rotation')
  if (g.imageFit?.mode !== undefined && g.imageFit.mode !== 'similarity') fail('image fit mode')
  if (g.imageFit?.projection !== undefined && !tuple(g.imageFit.projection, 3, -.5, .5)) fail('image fit projection')
  if (g.imageFit?.orientation !== undefined) {
    const o = g.imageFit.orientation
    if (!object(o) || !tuple(o.rotation, 3, -180, 180) || !finite(o.score, 0, 1) || !finite(o.initialScore, 0, 1)
      || typeof o.meshSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(o.meshSha256)) fail('image fit orientation')
    if (o.projection !== undefined && !tuple(o.projection, 3, -.5, .5)) fail('orientation projection')
    if (o.method !== undefined && !['silhouette-similarity-v1','surface-preserving-v2'].includes(o.method)) fail('orientation method')
    if(o.referenceRotation!==undefined&&!tuple(o.referenceRotation,3,-180,180))fail('orientation reference')
    if(o.surfaceRetention!==undefined&&!finite(o.surfaceRetention,0,1.000001))fail('surface retention')
    if(o.reviewRequired!==undefined&&typeof o.reviewRequired!=='boolean')fail('orientation review')
    if (o.alignmentKey !== undefined && (typeof o.alignmentKey !== 'string' || o.alignmentKey.length > 512)) fail('orientation alignment')
  }
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
