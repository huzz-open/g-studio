import { getWorkspaceHandle } from '../../../shared/workspace'
import type { FsResult } from '../../../shared/workspace/fs'
import { notifyFileChanged } from './workspace-cache'
import { resolveDir, writeFile as fsWriteFile, readFile as fsReadFile, splitPath, joinPath, classifyError } from '../../../shared/workspace/fs'

export interface SaveFileOptions {
  fileName: string
  data: Uint8Array
  dir?: string
  skipNotify?: boolean
}

export interface SaveResult {
  path: string
}

export async function saveFileToWorkspace(opts: SaveFileOptions): Promise<SaveResult> {
  const root = getWorkspaceHandle()
  if (!root) throw new Error('No workspace connected')

  const targetDir = opts.dir ? await resolveDir(opts.dir, true) : root
  const path = joinPath(opts.dir ?? '', opts.fileName)

  await fsWriteFile(targetDir, opts.fileName, opts.data as BlobPart)

  if (!opts.skipNotify) notifyFileChanged()
  return { path }
}

export interface BatchOptions {
  files: SaveFileOptions[]
}

export async function saveFileBatch(filesOrOpts: SaveFileOptions[] | BatchOptions): Promise<SaveResult[]> {
  const files = Array.isArray(filesOrOpts) ? filesOrOpts : filesOrOpts.files

  const root = getWorkspaceHandle()
  if (!root) throw new Error('No workspace connected')

  const results: SaveResult[] = []
  for (const opts of files) {
    results.push(await saveFileToWorkspace({ ...opts, skipNotify: true }))
  }

  notifyFileChanged()
  return results
}

export type ReadFileResult = FsResult<{ data: Uint8Array }>

export async function readFileFromWorkspace(
  filePath: string,
): Promise<ReadFileResult> {
  const root = getWorkspaceHandle()
  if (!root) return { ok: false, error: 'not-found', message: 'No workspace connected' }

  const { dir: dirPath, fileName } = splitPath(filePath)

  try {
    const dir = dirPath ? await resolveDir(dirPath) : root
    const data = await fsReadFile(dir, fileName)
    return { ok: true, data: { data } }
  } catch (err) {
    return { ok: false, error: classifyError(err), message: String(err) }
  }
}

export async function deleteFileFromWorkspace(
  filePath: string,
): Promise<void> {
  const root = getWorkspaceHandle()
  if (!root) throw new Error('No workspace connected')

  const { dir: dirPath, fileName } = splitPath(filePath)
  const dirHandle = dirPath ? await resolveDir(dirPath) : root

  await dirHandle.removeEntry(fileName)
  notifyFileChanged()
}

export function isWorkspaceConnected(): boolean {
  return getWorkspaceHandle() !== null
}
