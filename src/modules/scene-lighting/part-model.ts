import { decodeMesh } from '../../shared/parts/mesh'
import { resolveGeneratedModel } from '../../shared/generation/models'
import { isPartModelAllowed, type PartAsset, type Triple } from '../../shared/parts/schema'
import { roomBounds, type RoomSize, type Mesh } from './model'
import { type Vec3 } from '../experiments/umbrella/math'
import { fitMeshProjection, visiblePixelBounds } from './image-fit'
import { rotateMesh } from './orientation-fit'
import { cachedRepair, cachedRepairBounds, repairKey } from './model-repair'

// Processed meshes are immutable, just like decoded GLB meshes. Share them across
// renderer snapshots, selection bounds and pointer moves; retain at most 8 variants.
const processedModels=new Map<string,{source:Mesh;mesh:Mesh}>()
const movementBounds=new WeakMap<Mesh,ReturnType<typeof meshExtents>>()
function processedBounds(mesh:Mesh){
  let bounds=movementBounds.get(mesh)
  if(!bounds){bounds=meshExtents(mesh);movementBounds.set(mesh,bounds)}
  return bounds
}

export function activeRepair(part:PartAsset){
  const g=resolveGeneratedModel(part.model),spec=g.repair
  return spec?.enabled&&spec.version===2&&spec.key===repairKey({...part,model:g})?spec:undefined
}

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
  const cx=(bounds.min[0]+bounds.max[0])/2,cz=(bounds.min[2]+bounds.max[2])/2
  for (let i = 0; i < vertices.length; i += 9) {
    vertices[i]=(vertices[i]-cx)*factor[0];vertices[i+1]=(vertices[i+1]-bounds.min[1])*factor[1];vertices[i+2]=(vertices[i+2]-cz)*factor[2]
    const x=vertices[i+3]/factor[0],y=vertices[i+4]/factor[1],z=vertices[i+5]/factor[2],length=Math.hypot(x,y,z)||1
    vertices[i+3]=x/length;vertices[i+4]=y/length;vertices[i+5]=z/length
  }
  return { vertices, triangles: mesh.triangles.map(tri => tri.map(transform)) }
}
export function buildPartModel(part: PartAsset, _pixels: { width: number; height: number; data: Uint8ClampedArray }): Mesh {
  const ready=activeRepair(part)
  if(ready){const cached=cachedRepair(ready);if(cached)return cached.mesh}
  const g = resolveGeneratedModel(part.model)
  if(g.kind==='none')return {vertices:new Float32Array(),triangles:[]}
  if (!isPartModelAllowed(part, g)) throw new Error('Unsupported part model')
  if (g.kind === 'mesh') {
    const source = decodeMesh(g.mesh!.uri)
    if(g.original)return source
    const fit=g.imageFit
    const key=JSON.stringify([g.mesh!.sha256,g.size,fit&&[fit.size,fit.target,fit.rotation,fit.projection]])
    const cached=processedModels.get(key)
    if(cached?.source===source){
      processedModels.delete(key);processedModels.set(key,cached)
      return cached.mesh
    }
    let mesh:Mesh
    if(!fit)mesh=resize(source,g.size)
    else{
      const resized=resize(source,fit.size)
      const oriented=fit.rotation?rotateMesh(resized,fit.rotation):resized
      mesh=fitMeshProjection(oriented,fit.target,g.size.map((v,i)=>v/fit.size[i]) as Vec3,fit.projection)
    }
    processedModels.set(key,{source,mesh})
    while(processedModels.size>8)processedModels.delete(processedModels.keys().next().value!)
    // The repaired result is checked before this cache, so a newly completed
    // repair always replaces the temporary unrepaired mesh.
    return mesh
  }
  return {vertices:new Float32Array(),triangles:[]}
}
/** Image position and size are independent of model selection and edits. */
export function imageBounds(part: Pick<PartAsset,'image'|'imageFrame'>) {
  const {left,bottom,height}=part.imageFrame
  return {left,bottom,height,width:height*part.image.width/part.image.height}
}
/** Freeze the image rectangle and register the model to its visible pixels.
 * Called on a draft: original GLB bytes and source images remain untouched. */
export function alignPartModel(part: PartAsset, pixels: { width: number; height: number; data: Uint8ClampedArray }) {
  if (part.model.kind !== 'mesh') throw new Error('Image alignment requires solid model')
  const visible = visiblePixelBounds(pixels)
  const bounds = imageBounds(part)
  const rotation = part.model.imageFit?.rotation
  part.model.imageFit = { size: [...part.model.size], mode: 'similarity', ...(rotation ? { rotation: [...rotation] as Triple } : {}), target: [
    bounds.left + visible.left * bounds.width, bounds.bottom + visible.bottom * bounds.height,
    visible.width * bounds.width, visible.height * bounds.height,
  ] }
}
export function partMovementLimits(part: PartAsset | undefined, scale = 1, room?: RoomSize) {
  const ROOM=roomBounds(room)
  const repair=part?activeRepair(part):undefined,readyBounds=repair?cachedRepairBounds(repair):undefined
  if (part?.model.imageFit && part.model.kind === 'mesh' && (!repair||readyBounds)) {
    const { min, max } = readyBounds??processedBounds(buildPartModel(part, { width: 0, height: 0, data: new Uint8ClampedArray() }))
    const limits = (a: number, b: number, lo: number, hi: number) => {
      const lower = Math.ceil((lo - a * scale + .05) * 100) / 100, upper = Math.floor((hi - b * scale - .05) * 100) / 100
      return lower <= upper ? [lower, upper] : [(lower + upper) / 2, (lower + upper) / 2]
    }
    const [minX, maxX] = limits(min[0], max[0], ROOM.minX, ROOM.maxX), [minZ, maxZ] = limits(min[2], max[2], ROOM.minZ, ROOM.maxZ)
    return { minX, maxX, minZ, maxZ }
  }
  let width=part?.model.size[0]??1,depth=part?.model.size[2]??1

  const w = Math.min(ROOM.maxX - ROOM.minX - .1, width * scale)
  const d = Math.min(ROOM.maxZ - ROOM.minZ - .1, depth * scale)
  const lower = (v: number) => Math.ceil(v * 100) / 100, upper = (v: number) => Math.floor(v * 100) / 100
  return { minX: lower(ROOM.minX + w / 2 + .05), maxX: upper(ROOM.maxX - w / 2 - .05), minZ: lower(ROOM.minZ + d / 2 + .05), maxZ: upper(ROOM.maxZ - d / 2 - .05) }
}
