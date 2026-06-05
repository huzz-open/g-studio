import { GsType, RegionType, type GsFile, type SceneRegionData, type SceneRegion } from './types'

export class GsValidationError extends Error {
  constructor(message: string) {
    super(`[gs-format] ${message}`)
    this.name = 'GsValidationError'
  }
}

export function validateGsFile(data: unknown): asserts data is GsFile {
  if (typeof data !== 'object' || data === null) {
    throw new GsValidationError('文件内容不是有效的 JSON 对象')
  }

  const obj = data as Record<string, unknown>

  if (obj.gs !== 1) {
    throw new GsValidationError(`不支持的格式版本: ${obj.gs}（当前仅支持 1）`)
  }

  if (typeof obj.type !== 'number' || !(Object.values(GsType) as number[]).includes(obj.type)) {
    throw new GsValidationError(`无效的 type 字段: ${obj.type}`)
  }

  if (typeof obj.gen !== 'string' || obj.gen.length === 0) {
    throw new GsValidationError('gen 字段缺失或为空')
  }

  if (typeof obj.version !== 'number' || obj.version < 1 || !Number.isInteger(obj.version)) {
    throw new GsValidationError(`version 必须为正整数，当前: ${obj.version}`)
  }

  if (typeof obj.data !== 'object' || obj.data === null) {
    throw new GsValidationError('data 字段缺失或不是对象')
  }
}

export function validateSceneRegionData(data: unknown): asserts data is SceneRegionData {
  if (typeof data !== 'object' || data === null) {
    throw new GsValidationError('SceneRegionData 不是有效对象')
  }

  const obj = data as Record<string, unknown>

  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    throw new GsValidationError('data.name 缺失或为空')
  }

  if (typeof obj.texture !== 'string' || obj.texture.length === 0) {
    throw new GsValidationError('data.texture 缺失或为空')
  }

  if (!Array.isArray(obj.size) || obj.size.length !== 2
    || typeof obj.size[0] !== 'number' || typeof obj.size[1] !== 'number') {
    throw new GsValidationError('data.size 必须为 [number, number]')
  }

  if (typeof obj.y_sort !== 'boolean') {
    throw new GsValidationError('data.y_sort 必须为 boolean')
  }

  if (!Array.isArray(obj.regions)) {
    throw new GsValidationError('data.regions 必须为数组')
  }

  const ids = new Set<string>()
  for (let i = 0; i < obj.regions.length; i++) {
    validateSceneRegion(obj.regions[i], i)
    const region = obj.regions[i] as SceneRegion
    if (ids.has(region.id)) {
      throw new GsValidationError(`data.regions[${i}] 的 id "${region.id}" 重复`)
    }
    ids.add(region.id)
  }
}

function validateSceneRegion(data: unknown, index: number): asserts data is SceneRegion {
  if (typeof data !== 'object' || data === null) {
    throw new GsValidationError(`data.regions[${index}] 不是有效对象`)
  }

  const obj = data as Record<string, unknown>
  const prefix = `data.regions[${index}]`

  if (typeof obj.id !== 'string' || obj.id.length === 0) {
    throw new GsValidationError(`${prefix}.id 缺失或为空`)
  }

  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    throw new GsValidationError(`${prefix}.name 缺失或为空`)
  }

  if (typeof obj.type !== 'number' || !(Object.values(RegionType) as number[]).includes(obj.type)) {
    throw new GsValidationError(`${prefix}.type 无效: ${obj.type}`)
  }

  const hasVerts = Array.isArray(obj.verts)
  const hasRect = Array.isArray(obj.rect)

  if (!hasVerts && !hasRect) {
    throw new GsValidationError(`${prefix} 必须有 verts 或 rect`)
  }

  if (hasVerts && hasRect) {
    throw new GsValidationError(`${prefix} 不能同时有 verts 和 rect`)
  }

  if (hasVerts) {
    const verts = obj.verts as unknown[]
    if (verts.length < 3) {
      throw new GsValidationError(`${prefix}.verts 至少需要 3 个顶点`)
    }
    for (let i = 0; i < verts.length; i++) {
      const v = verts[i]
      if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== 'number' || typeof v[1] !== 'number') {
        throw new GsValidationError(`${prefix}.verts[${i}] 必须为 [number, number]`)
      }
    }
  }

  if (hasRect) {
    const rect = obj.rect as unknown[]
    if (rect.length !== 4 || !rect.every(v => typeof v === 'number')) {
      throw new GsValidationError(`${prefix}.rect 必须为 [x, y, w, h]`)
    }
  }
}
