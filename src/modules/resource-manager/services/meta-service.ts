import type { MetaFile, MetaResourceType, MetaOrigin, PipelineStep } from '../interfaces/meta'
import { META_VERSION } from '../interfaces/meta'
import { generateUid } from './uid'
import { computeContentHash } from './content-hash'
import type { FsResult } from '../../../shared/workspace/fs'
import {
  readJsonFile,
  writeJsonFile,
  deleteFile as fsDeleteFile,
  classifyError,
} from '../../../shared/workspace/fs'

function metaFileName(fileName: string): string {
  return `.${fileName}.meta`
}

export function mainFileNameFromMeta(metaName: string): string | null {
  if (!metaName.startsWith('.') || !metaName.endsWith('.meta')) return null
  return metaName.slice(1, -5)
}

export function isMetaFile(name: string): boolean {
  return name.startsWith('.') && name.endsWith('.meta') && name.length > 6
}

export function isSystemFile(name: string): boolean {
  return name.startsWith('.g-studio')
}

export async function readMetaFile(
  dirHandle: FileSystemDirectoryHandle,
  fileName: string,
): Promise<MetaFile | null> {
  const result = await readMetaFileFsResult(dirHandle, fileName)
  return result.ok ? result.data : null
}

export async function readMetaFileFsResult(
  dirHandle: FileSystemDirectoryHandle,
  fileName: string,
): Promise<FsResult<MetaFile>> {
  const result = await readJsonFile<MetaFile>(dirHandle, metaFileName(fileName))
  if (!result.ok) return result
  if (!result.data.__version || !result.data.uid) {
    return { ok: false, error: 'invalid-schema', message: 'Missing __version or uid' }
  }
  return result
}

export async function readMetaFileByHandle(
  fileHandle: FileSystemFileHandle,
): Promise<MetaFile | null> {
  const result = await readMetaFileByHandleFsResult(fileHandle)
  return result.ok ? result.data : null
}

export async function readMetaFileByHandleFsResult(
  fileHandle: FileSystemFileHandle,
): Promise<FsResult<MetaFile>> {
  try {
    const file = await fileHandle.getFile()
    const text = await file.text()
    const parsed = JSON.parse(text) as MetaFile
    if (!parsed.__version || !parsed.uid) {
      return { ok: false, error: 'invalid-schema', message: 'Missing __version or uid' }
    }
    return { ok: true, data: parsed }
  } catch (err) {
    return { ok: false, error: classifyError(err), message: String(err) }
  }
}

export async function writeMetaFile(
  dirHandle: FileSystemDirectoryHandle,
  fileName: string,
  meta: MetaFile,
): Promise<void> {
  await writeJsonFile(dirHandle, metaFileName(fileName), meta)
}

export async function deleteMetaFile(
  dirHandle: FileSystemDirectoryHandle,
  fileName: string,
): Promise<void> {
  await fsDeleteFile(dirHandle, metaFileName(fileName))
}

export async function renameMetaFile(
  oldDirHandle: FileSystemDirectoryHandle,
  oldFileName: string,
  newDirHandle: FileSystemDirectoryHandle,
  newFileName: string,
): Promise<void> {
  const meta = await readMetaFile(oldDirHandle, oldFileName)
  if (!meta) { console.error('[meta] renameMetaFile: expected .meta not found for', oldFileName); return }
  meta.boundFileName = newFileName
  meta.updatedAt = Date.now()
  await writeMetaFile(newDirHandle, newFileName, meta)
  if (oldDirHandle !== newDirHandle || oldFileName !== newFileName) {
    await deleteMetaFile(oldDirHandle, oldFileName)
  }
}

export async function createMetaForFile(
  dirHandle: FileSystemDirectoryHandle,
  fileName: string,
  fileData: ArrayBuffer,
  options?: {
    type?: MetaResourceType
    origin?: MetaOrigin
    pipeline?: PipelineStep[]
    openWith?: string
    tags?: string[]
    moduleData?: MetaFile['moduleData']
  },
): Promise<MetaFile> {
  const now = Date.now()
  const contentHash = await computeContentHash(fileData)

  const meta: MetaFile = {
    __version: META_VERSION,
    uid: generateUid(),
    boundFileName: fileName,
    contentHash,
    fileSize: fileData.byteLength,
    type: options?.type ?? guessType(fileName),
    tags: options?.tags ?? [],
    openWith: options?.openWith,
    origin: options?.origin ?? {
      source: 'external',
      createdBy: 'external',
      importedAt: now,
    },
    pipeline: options?.pipeline ?? [
      { step: 'discovered', at: now, detail: 'workspace scan' },
    ],
    relations: [],
    moduleData: options?.moduleData ?? {},
    createdAt: now,
    updatedAt: now,
  }

  await writeMetaFile(dirHandle, fileName, meta)
  return meta
}

export async function updateMetaContentHash(
  dirHandle: FileSystemDirectoryHandle,
  fileName: string,
  fileData: ArrayBuffer,
): Promise<MetaFile | null> {
  const meta = await readMetaFile(dirHandle, fileName)
  if (!meta) return null

  const newHash = await computeContentHash(fileData)
  if (meta.contentHash === newHash && meta.fileSize === fileData.byteLength) {
    return meta
  }

  meta.contentHash = newHash
  meta.fileSize = fileData.byteLength
  meta.updatedAt = Date.now()
  await writeMetaFile(dirHandle, fileName, meta)
  return meta
}

function guessType(fileName: string): MetaResourceType {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.json')) return 'map-data'
  return 'generic'
}
