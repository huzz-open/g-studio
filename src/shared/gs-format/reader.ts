import { GsType, type GsFile, type SceneRegionData, type SpriteData, type TilesetData } from './types'
import { validateGsFile, validateSceneRegionData, validateSpriteData, validateTilesetData, GsValidationError } from './schema'
import { resolveDir, readTextFile, splitPath } from '../workspace/fs'

export interface ReadGsResult<T = unknown> {
  file: GsFile<T>
  dirHandle: FileSystemDirectoryHandle
  fileName: string
}

export async function readGsFile(path: string): Promise<ReadGsResult> {
  const { dir, fileName } = splitPath(path)
  const dirHandle = await resolveDir(dir)
  const text = await readTextFile(dirHandle, fileName)

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    throw new GsValidationError(`JSON 解析失败: ${(e as Error).message}`)
  }

  validateGsFile(parsed)

  const gsFile = parsed as GsFile

  if (gsFile.type === GsType.SceneRegion) {
    validateSceneRegionData(gsFile.data)
  } else if (gsFile.type === GsType.Sprite) {
    validateSpriteData(gsFile.data)
  } else if (gsFile.type === GsType.Tileset) {
    validateTilesetData(gsFile.data)
  }

  return { file: gsFile, dirHandle, fileName }
}

export async function readSceneRegionGsFile(path: string): Promise<ReadGsResult<SceneRegionData>> {
  const result = await readGsFile(path)
  if (result.file.type !== GsType.SceneRegion) {
    throw new GsValidationError(`期望 type=${GsType.SceneRegion}，实际 type=${result.file.type}`)
  }
  return result as ReadGsResult<SceneRegionData>
}

export async function readSpriteGsFile(path: string): Promise<ReadGsResult<SpriteData>> {
  const result = await readGsFile(path)
  if (result.file.type !== GsType.Sprite) {
    throw new GsValidationError(`期望 type=${GsType.Sprite}，实际 type=${result.file.type}`)
  }
  return result as ReadGsResult<SpriteData>
}

export async function readTilesetGsFile(path: string): Promise<ReadGsResult<TilesetData>> {
  const result = await readGsFile(path)
  if (result.file.type !== GsType.Tileset) {
    throw new GsValidationError(`期望 type=${GsType.Tileset}，实际 type=${result.file.type}`)
  }
  return result as ReadGsResult<TilesetData>
}

export async function readGsVersion(path: string): Promise<number> {
  const { dir, fileName } = splitPath(path)
  const dirHandle = await resolveDir(dir)
  const text = await readTextFile(dirHandle, fileName)

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    throw new GsValidationError(`JSON 解析失败 (readGsVersion): ${(e as Error).message}`)
  }

  const obj = parsed as { version?: number }
  if (typeof obj.version !== 'number') {
    throw new GsValidationError('version 字段缺失')
  }
  return obj.version
}
