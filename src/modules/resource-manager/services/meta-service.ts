import type { MetaFile, MetaResourceType, MetaOrigin, PipelineStep } from '../interfaces/meta'
import { META_VERSION } from '../interfaces/meta'
import { generateUid } from './uid'
import { computeContentHash } from './content-hash'

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
  return name === 'workspace.json'
    || name === '.g-studio-registry.json'
    || name === '.g-studio-registry.json.bak'
    || name.startsWith('.g-studio')
}

export async function readMetaFile(
  dirHandle: FileSystemDirectoryHandle,
  fileName: string,
): Promise<MetaFile | null> {
  const name = metaFileName(fileName)
  try {
    const fileHandle = await dirHandle.getFileHandle(name)
    const file = await fileHandle.getFile()
    const text = await file.text()
    const parsed = JSON.parse(text) as MetaFile
    if (!parsed.__version || !parsed.uid) return null
    return parsed
  } catch {
    return null
  }
}

export async function readMetaFileByHandle(
  fileHandle: FileSystemFileHandle,
): Promise<MetaFile | null> {
  try {
    const file = await fileHandle.getFile()
    const text = await file.text()
    const parsed = JSON.parse(text) as MetaFile
    if (!parsed.__version || !parsed.uid) return null
    return parsed
  } catch {
    return null
  }
}

export async function writeMetaFile(
  dirHandle: FileSystemDirectoryHandle,
  fileName: string,
  meta: MetaFile,
): Promise<void> {
  const name = metaFileName(fileName)
  const fileHandle = await dirHandle.getFileHandle(name, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(JSON.stringify(meta, null, 2))
  await writable.close()
}

export async function deleteMetaFile(
  dirHandle: FileSystemDirectoryHandle,
  fileName: string,
): Promise<void> {
  const name = metaFileName(fileName)
  try {
    await dirHandle.removeEntry(name)
  } catch {
    /* already gone */
  }
}

export async function renameMetaFile(
  oldDirHandle: FileSystemDirectoryHandle,
  oldFileName: string,
  newDirHandle: FileSystemDirectoryHandle,
  newFileName: string,
): Promise<void> {
  const meta = await readMetaFile(oldDirHandle, oldFileName)
  if (!meta) return
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
