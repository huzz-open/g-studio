import { GS_FORMAT_VERSION, type GsFile, type GsType } from './types'
import { resolveDir, writeFile, splitPath, readTextFile, fileExists } from '../workspace/fs'
declare const __APP_VERSION__: string

const APP_VERSION = __APP_VERSION__

export interface WriteGsOptions<T> {
  path: string
  type: GsType
  data: T
  lastKnownVersion?: number
}

export interface WriteGsConflict {
  status: 'conflict'
  diskVersion: number
  expectedVersion: number
}

export interface WriteGsSuccess {
  status: 'ok'
  newVersion: number
}

export type WriteGsResult = WriteGsSuccess | WriteGsConflict

async function readDiskVersion(dirHandle: FileSystemDirectoryHandle, fileName: string): Promise<number> {
  let text: string
  try {
    text = await readTextFile(dirHandle, fileName)
  } catch (e) {
    if (e instanceof DOMException && e.name === 'NotFoundError') return 0
    throw e
  }
  const existing = JSON.parse(text) as { version: number }
  if (typeof existing.version !== 'number') {
    throw new Error(`[gs-format] 已有 .gs 文件缺少 version 字段: ${fileName}`)
  }
  return existing.version
}

function buildGsFileObject<T>(type: GsType, data: T, version: number): GsFile<T> {
  return {
    gs: GS_FORMAT_VERSION,
    type,
    gen: `g-studio/${APP_VERSION}`,
    version,
    data,
  }
}

/**
 * 写入 .gs 文件到工作区。
 *
 * 流程：
 * 1. 如果文件已存在，读取当前 version 做冲突检查
 * 2. 如果 diskVersion > lastKnownVersion → 返回冲突
 * 3. 否则写入 version+1
 */
export async function writeGsFile<T>(opts: WriteGsOptions<T>): Promise<WriteGsResult> {
  const { path, type, data, lastKnownVersion } = opts
  const { dir, fileName } = splitPath(path)
  const dirHandle = await resolveDir(dir, true)

  const diskVersion = await readDiskVersion(dirHandle, fileName)

  if (lastKnownVersion !== undefined && diskVersion > lastKnownVersion) {
    return { status: 'conflict', diskVersion, expectedVersion: lastKnownVersion }
  }

  const newVersion = diskVersion + 1
  const json = JSON.stringify(buildGsFileObject(type, data, newVersion), null, 2)
  await writeFile(dirHandle, fileName, json)

  return { status: 'ok', newVersion }
}

/**
 * 强制写入（忽略冲突，用于用户明确选择"覆盖"时）。
 */
export async function forceWriteGsFile<T>(opts: Omit<WriteGsOptions<T>, 'lastKnownVersion'>): Promise<number> {
  const { path, type, data } = opts
  const { dir, fileName } = splitPath(path)
  const dirHandle = await resolveDir(dir, true)

  const diskVersion = await readDiskVersion(dirHandle, fileName)
  const newVersion = diskVersion + 1
  const json = JSON.stringify(buildGsFileObject(type, data, newVersion), null, 2)
  await writeFile(dirHandle, fileName, json)

  return newVersion
}

export interface CreateGsResult {
  path: string
  version: number
}

export interface GsConflictInfo {
  exists: boolean
  existingType?: GsType
}

export class GsDifferentTypeConflictError extends Error {
  existingType: GsType
  constructor(existingType: GsType) {
    super(`GS file exists with different type: ${existingType}`)
    this.name = 'GsDifferentTypeConflictError'
    this.existingType = existingType
  }
}

export class GsSameTypeConflictError extends Error {
  existingVersion: number
  constructor(version: number) {
    super(`GS file of same type already exists (version ${version})`)
    this.name = 'GsSameTypeConflictError'
    this.existingVersion = version
  }
}

export async function checkGsConflict(path: string): Promise<GsConflictInfo> {
  const { dir, fileName } = splitPath(path)
  let dirHandle: FileSystemDirectoryHandle
  try {
    dirHandle = await resolveDir(dir)
  } catch {
    return { exists: false }
  }

  const exists = await fileExists(dirHandle, fileName)
  if (!exists) return { exists: false }

  try {
    const text = await readTextFile(dirHandle, fileName)
    const parsed = JSON.parse(text) as { type?: GsType }
    return { exists: true, existingType: parsed.type }
  } catch {
    return { exists: true }
  }
}

export interface CreateGsOptions<T> {
  path: string
  type: GsType
  data: T
  allowOverwriteSameType?: boolean
}

export async function createGsFile<T>(opts: CreateGsOptions<T>): Promise<CreateGsResult> {
  const { path, type, data, allowOverwriteSameType = false } = opts
  const { dir, fileName } = splitPath(path)
  const dirHandle = await resolveDir(dir, true)

  const exists = await fileExists(dirHandle, fileName)
  if (exists) {
    const diskVersion = await readDiskVersion(dirHandle, fileName)
    let existingType: GsType | undefined
    try {
      const text = await readTextFile(dirHandle, fileName)
      const parsed = JSON.parse(text) as { type?: GsType }
      existingType = parsed.type
    } catch { /* treat as untyped */ }

    if (existingType !== undefined && existingType !== type) {
      throw new GsDifferentTypeConflictError(existingType)
    }

    if (!allowOverwriteSameType) {
      throw new GsSameTypeConflictError(diskVersion)
    }

    const newVersion = diskVersion + 1
    const json = JSON.stringify(buildGsFileObject(type, data, newVersion), null, 2)
    await writeFile(dirHandle, fileName, json)
    return { path, version: newVersion }
  }

  const json = JSON.stringify(buildGsFileObject(type, data, 1), null, 2)
  await writeFile(dirHandle, fileName, json)
  return { path, version: 1 }
}
