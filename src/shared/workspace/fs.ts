import { getWorkspaceHandle } from './workspace-manager'

export function splitPath(path: string): { dir: string; fileName: string } {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const idx = normalized.lastIndexOf('/')
  if (idx < 0) return { dir: '', fileName: normalized }
  return { dir: normalized.substring(0, idx), fileName: normalized.substring(idx + 1) }
}

export function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join('/')
}

export async function resolveDir(
  path: string,
  create = false,
): Promise<FileSystemDirectoryHandle> {
  const root = getWorkspaceHandle()
  if (!root) throw new Error('No workspace connected')
  let dir = root
  for (const part of path.split('/').filter(Boolean)) {
    dir = await dir.getDirectoryHandle(part, { create })
  }
  return dir
}

export async function readFile(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<Uint8Array> {
  const fh = await dir.getFileHandle(name)
  const file = await fh.getFile()
  return new Uint8Array(await file.arrayBuffer())
}

export async function readTextFile(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<string> {
  const fh = await dir.getFileHandle(name)
  const file = await fh.getFile()
  return file.text()
}

export async function writeFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: BlobPart | Uint8Array,
): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true })
  const w = await fh.createWritable()
  await w.write(data instanceof Blob ? data : new Blob([data as BlobPart]))
  await w.close()
}

export type FsErrorKind =
  | 'not-found'
  | 'parse-error'
  | 'invalid-schema'
  | 'permission-denied'
  | 'unknown'

export type FsResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: FsErrorKind; message?: string }

export function classifyError(err: unknown): FsErrorKind {
  if (err instanceof DOMException) {
    if (err.name === 'NotFoundError') return 'not-found'
    if (err.name === 'NotAllowedError' || err.name === 'NoModificationAllowedError')
      return 'permission-denied'
  }
  if (err instanceof SyntaxError) return 'parse-error'
  return 'unknown'
}

export async function readJsonFile<T = unknown>(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<FsResult<T>> {
  try {
    const text = await readTextFile(dir, name)
    const data = JSON.parse(text) as T
    return { ok: true, data }
  } catch (err) {
    return { ok: false, error: classifyError(err), message: String(err) }
  }
}

export async function readJsonFileOrNull<T = unknown>(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<T | null> {
  const result = await readJsonFile<T>(dir, name)
  return result.ok ? result.data : null
}

export async function writeJsonFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: unknown,
): Promise<void> {
  await writeFile(dir, name, JSON.stringify(data, null, 2))
}


export async function deleteFile(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<void> {
  try {
    await dir.removeEntry(name)
  } catch { /* already gone */ }
}

export async function fileExists(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<boolean> {
  try {
    await dir.getFileHandle(name)
    return true
  } catch {
    return false
  }
}

export interface ImageSaveResult {
  written: boolean
  finalName: string
}

export async function saveImageToWorkspace(
  dir: FileSystemDirectoryHandle,
  fileName: string,
  buffer: Uint8Array,
  strategy: 'skip' | 'overwrite',
): Promise<ImageSaveResult> {
  const exists = await fileExists(dir, fileName)

  if (!exists) {
    await writeFile(dir, fileName, buffer)
    return { written: true, finalName: fileName }
  }

  if (strategy === 'skip') {
    return { written: false, finalName: fileName }
  }

  await writeFile(dir, fileName, buffer)
  return { written: true, finalName: fileName }
}

export async function listDirs(maxDepth = 2): Promise<string[]> {
  const root = getWorkspaceHandle()
  if (!root) return []
  const dirs: string[] = []
  async function walk(
    dir: FileSystemDirectoryHandle,
    prefix: string,
    depth: number,
  ) {
    if (depth > maxDepth) return
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'directory' && !name.startsWith('.')) {
        const path = prefix ? `${prefix}/${name}` : name
        dirs.push(path)
        await walk(handle as FileSystemDirectoryHandle, path, depth + 1)
      }
    }
  }
  await walk(root, '', 0)
  return dirs.sort()
}
