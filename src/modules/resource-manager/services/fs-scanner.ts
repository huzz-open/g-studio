import type { FsEntry, ScanResult } from '../interfaces/meta'
import { isMetaFile, isSystemFile, mainFileNameFromMeta, readMetaFileByHandleFsResult } from './meta-service'
import { writeFile, deleteFile as fsDeleteFile } from '../../../shared/workspace/fs'
import { isGsFile } from '../../../shared/utils/file-type'

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
  const corruptMetas: string[] = []

  await scanDirectory(root, '', tree, linked, unmatchedFiles, orphanedMetas, corruptMetas)

  return { tree, linked, unmatchedFiles, orphanedMetas, corruptMetas }
}

async function scanDirectory(
  dirHandle: FileSystemDirectoryHandle,
  basePath: string,
  entries: FsEntry[],
  linked: ScanResult['linked'],
  unmatchedFiles: FsEntry[],
  orphanedMetas: ScanResult['orphanedMetas'],
  corruptMetas: string[],
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

    if (isGsFile(fileName)) {
      // .gs files are self-describing metadata; they never need .meta sidecar
      if (metaHandle) metas.delete(metaName)
    } else if (metaHandle) {
      const result = await readMetaFileByHandleFsResult(metaHandle)
      if (result.ok) {
        fsEntry.meta = result.data
        linked.push({ file: fsEntry, meta: result.data })
      } else if (result.error === 'parse-error' || result.error === 'invalid-schema') {
        const corruptName = `${metaName}.corrupt`
        const metaPath = basePath ? `${basePath}/${metaName}` : metaName
        try {
          const file = await metaHandle.getFile()
          const content = await file.arrayBuffer()
          await writeFile(dirHandle, corruptName, new Uint8Array(content))
          await fsDeleteFile(dirHandle, metaName)
        } catch { /* best effort */ }
        corruptMetas.push(metaPath)
        unmatchedFiles.push(fsEntry)
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
    const result = await readMetaFileByHandleFsResult(metaHandle)
    if (!result.ok) continue
    const path = basePath ? `${basePath}/${metaName}` : metaName
    orphanedMetas.push({ path, meta: result.data, handle: metaHandle })
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
      handle, dirPath, dirEntry.children!, linked, unmatchedFiles, orphanedMetas, corruptMetas,
    )
    entries.push(dirEntry)
  }

  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

