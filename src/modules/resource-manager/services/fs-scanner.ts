import type { FsEntry, MetaFile, ScanResult } from '../interfaces/meta'
import { isMetaFile, isSystemFile, mainFileNameFromMeta, readMetaFileByHandle } from './meta-service'

/**
 * Recursively scan a workspace directory, building an FsEntry tree
 * and classifying files into linked, unmatched, or orphaned.
 */
export async function scanWorkspace(
  root: FileSystemDirectoryHandle,
): Promise<ScanResult> {
  const tree: FsEntry[] = []
  const linked: ScanResult['linked'] = []
  const unmatchedFiles: FsEntry[] = []
  const orphanedMetas: ScanResult['orphanedMetas'] = []

  await scanDirectory(root, '', tree, linked, unmatchedFiles, orphanedMetas)

  return { tree, linked, unmatchedFiles, orphanedMetas }
}

async function scanDirectory(
  dirHandle: FileSystemDirectoryHandle,
  basePath: string,
  entries: FsEntry[],
  linked: ScanResult['linked'],
  unmatchedFiles: FsEntry[],
  orphanedMetas: ScanResult['orphanedMetas'],
): Promise<void> {
  const files = new Map<string, FileSystemFileHandle>()
  const metas = new Map<string, FileSystemFileHandle>()
  const dirs: Array<{ name: string; handle: FileSystemDirectoryHandle }> = []

  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'directory') {
      if (entry.name.startsWith('.g-studio')) continue
      dirs.push({ name: entry.name, handle: entry })
    } else if (entry.kind === 'file') {
      if (isSystemFile(entry.name)) continue
      if (isMetaFile(entry.name)) {
        metas.set(entry.name, entry)
      } else {
        files.set(entry.name, entry)
      }
    }
  }

  for (const [fileName, fileHandle] of files) {
    const metaName = `.${fileName}.meta`
    const metaHandle = metas.get(metaName)
    const path = basePath ? `${basePath}/${fileName}` : fileName

    const fsEntry: FsEntry = {
      name: fileName,
      kind: 'file',
      path,
      handle: fileHandle,
      meta: null,
    }

    if (metaHandle) {
      const meta = await readMetaFileByHandle(metaHandle)
      if (meta) {
        fsEntry.meta = meta
        linked.push({ file: fsEntry, meta })
      } else {
        unmatchedFiles.push(fsEntry)
      }
      metas.delete(metaName)
    } else {
      unmatchedFiles.push(fsEntry)
    }

    entries.push(fsEntry)
  }

  for (const [metaName, metaHandle] of metas) {
    const mainFileName = mainFileNameFromMeta(metaName)
    if (!mainFileName) continue
    const meta = await readMetaFileByHandle(metaHandle)
    if (!meta) continue
    const path = basePath ? `${basePath}/${metaName}` : metaName
    orphanedMetas.push({ path, meta, handle: metaHandle })
  }

  dirs.sort((a, b) => a.name.localeCompare(b.name))
  for (const { name, handle } of dirs) {
    const dirPath = basePath ? `${basePath}/${name}` : name
    const dirEntry: FsEntry = {
      name,
      kind: 'directory',
      path: dirPath,
      handle,
      children: [],
    }
    await scanDirectory(
      handle, dirPath, dirEntry.children!, linked, unmatchedFiles, orphanedMetas,
    )
    entries.push(dirEntry)
  }

  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/**
 * Get a directory handle at a relative path, creating intermediaries if needed.
 */
export async function resolveDirectoryPath(
  root: FileSystemDirectoryHandle,
  relativePath: string,
  create = false,
): Promise<FileSystemDirectoryHandle> {
  const parts = relativePath.split('/').filter(Boolean)
  let dir = root
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create })
  }
  return dir
}

/**
 * Get a file handle at a relative path.
 */
export async function resolveFilePath(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<{ dir: FileSystemDirectoryHandle; fileName: string; handle: FileSystemFileHandle }> {
  const parts = relativePath.split('/')
  const fileName = parts.pop()!
  let dir = root
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part)
  }
  const handle = await dir.getFileHandle(fileName)
  return { dir, fileName, handle }
}
