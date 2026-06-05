import { GsType, type GsFile, type SceneRegionData } from './types'
import { validateGsFile, validateSceneRegionData, GsValidationError } from './schema'
import { resolveDir, readTextFile, splitPath } from '../workspace/fs'

export interface ReadGsResult<T = unknown> {
  file: GsFile<T>
  dirHandle: FileSystemDirectoryHandle
  fileName: string
}

/**
 * 从工作区路径读取并校验 .gs 文件。
 * 校验失败会抛出 GsValidationError。
 */
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
  }

  return { file: gsFile, dirHandle, fileName }
}

/**
 * 读取 .gs 文件为 SceneRegion 类型（带类型断言）。
 */
export async function readSceneRegionGsFile(path: string): Promise<ReadGsResult<SceneRegionData>> {
  const result = await readGsFile(path)
  if (result.file.type !== GsType.SceneRegion) {
    throw new GsValidationError(`期望 type=${GsType.SceneRegion}，实际 type=${result.file.type}`)
  }
  return result as ReadGsResult<SceneRegionData>
}

/**
 * 仅读取 .gs 文件的 version 字段（快速轮询用，不做完整校验）。
 */
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
