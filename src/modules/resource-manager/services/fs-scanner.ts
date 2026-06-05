import type { FsEntry, ScanResult } from '../interfaces/meta'

function isMetaFile(name: string): boolean {
  return name.startsWith('.') && name.endsWith('.meta') && name.length > 6
}

function isSystemFile(name: string): boolean {
  return name.startsWith('.g-studio')
}

export async function scanWorkspace(
  root: FileSystemDirectoryHandle,
): Promise<ScanResult> {
  const tree: FsEntry[] = []
  await scanDirectory(root, '', tree)
  return { tree }
}

async function scanDirectory(
  dirHandle: FileSystemDirectoryHandle,
  basePath: string,
  entries: FsEntry[],
): Promise<void> {
  const files: Array<{ name: string; handle: FileSystemFileHandle }> = []
  const dirs: Array<{ name: string; handle: FileSystemDirectoryHandle }> = []

  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'directory') {
      if (entry.name.startsWith('.g-studio')) continue
      dirs.push({ name: entry.name, handle: entry })
    } else if (entry.kind === 'file') {
      if (isSystemFile(entry.name)) continue
      if (isMetaFile(entry.name)) continue
      files.push({ name: entry.name, handle: entry })
    }
  }

  for (const { name: fileName, handle: fileHandle } of files) {
    const path = basePath ? `${basePath}/${fileName}` : fileName
    entries.push({
      name: fileName,
      kind: 'file',
      path,
      handle: fileHandle,
    })
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
    await scanDirectory(handle, dirPath, dirEntry.children!)
    entries.push(dirEntry)
  }

  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}
