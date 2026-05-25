import { getWorkspaceHandle } from '../../../shared/workspace'
import type { FsResult } from '../../../shared/workspace/fs'
import type { MetaFile, MetaResourceType, MetaOrigin, PipelineStep, MetaRelation } from '../interfaces/meta'
import { createMetaForFile, writeMetaFile, readMetaFile, readMetaFileFsResult, deleteMetaFile } from './meta-service'
import { computeContentHash } from './content-hash'
import { notifyFileChanged } from './workspace-cache'
import { readUidIndex, writeUidIndex } from './uid-index'
import { resolveDir, writeFile as fsWriteFile, readFile as fsReadFile, splitPath, joinPath, classifyError } from '../../../shared/workspace/fs'

export interface SaveFileOptions {
  fileName: string
  data: Uint8Array
  type: MetaResourceType
  dir?: string
  tags?: string[]
  openWith?: string
  origin?: MetaOrigin
  pipeline?: PipelineStep[]
  moduleData?: MetaFile['moduleData']
  description?: string
  relations?: MetaRelation[]
  skipNotify?: boolean
  sourceUid?: string
}

export interface SaveResult {
  uid: string
  path: string
}

/**
 * Save a file to the workspace with a .meta sidecar.
 * If no workspace is connected, throws.
 */
export async function saveFileToWorkspace(opts: SaveFileOptions): Promise<SaveResult> {
  const root = getWorkspaceHandle()
  if (!root) throw new Error('No workspace connected')

  const targetDir = opts.dir ? await resolveDir(opts.dir, true) : root
  const path = joinPath(opts.dir ?? '', opts.fileName)

  await fsWriteFile(targetDir, opts.fileName, opts.data as BlobPart)

  const newHash = await computeContentHash(opts.data.buffer as ArrayBuffer)
  const existingMeta = await readMetaFile(targetDir, opts.fileName)

  if (existingMeta) {
    existingMeta.contentHash = newHash
    existingMeta.fileSize = opts.data.byteLength
    existingMeta.updatedAt = Date.now()
    if (opts.type) existingMeta.type = opts.type
    if (opts.openWith !== undefined) existingMeta.openWith = opts.openWith
    if (opts.origin) existingMeta.origin = opts.origin
    if (opts.pipeline) existingMeta.pipeline = [...(existingMeta.pipeline ?? []), ...opts.pipeline]
    if (opts.moduleData) existingMeta.moduleData = { ...existingMeta.moduleData, ...opts.moduleData }
    if (opts.tags) existingMeta.tags = opts.tags
    if (opts.relations) {
      const existing = existingMeta.relations ?? []
      for (const newRel of opts.relations) {
        const idx = existing.findIndex(r => r.rel === newRel.rel && r.uid === newRel.uid)
        if (idx >= 0) existing[idx] = newRel
        else existing.push(newRel)
      }
      existingMeta.relations = existing
    }
    await writeMetaFile(targetDir, opts.fileName, existingMeta)
    await syncUidIndex(root, existingMeta.uid, path)
    if (opts.sourceUid) {
      await addProducesRelation(root, opts.sourceUid, existingMeta.uid)
    }
    if (!opts.skipNotify) notifyFileChanged()
    return { uid: existingMeta.uid, path }
  }

  const meta = await createMetaForFile(targetDir, opts.fileName, opts.data.buffer as ArrayBuffer, {
    type: opts.type,
    origin: opts.origin,
    pipeline: opts.pipeline,
    openWith: opts.openWith,
    tags: opts.tags,
    moduleData: opts.moduleData,
  })
  if (opts.relations && opts.relations.length > 0) {
    meta.relations = opts.relations
    await writeMetaFile(targetDir, opts.fileName, meta)
  }
  await syncUidIndex(root, meta.uid, path)
  if (opts.sourceUid) {
    await addProducesRelation(root, opts.sourceUid, meta.uid)
  }
  if (!opts.skipNotify) notifyFileChanged()
  return { uid: meta.uid, path }
}

/**
 * Save multiple files in a batch, sharing a single uid-index read/write cycle.
 */
export interface BatchOptions {
  files: SaveFileOptions[]
  sourceMetaUpdate?: (meta: MetaFile) => void
}

export async function saveFileBatch(filesOrOpts: SaveFileOptions[] | BatchOptions): Promise<SaveResult[]> {
  const { files, sourceMetaUpdate } = Array.isArray(filesOrOpts)
    ? { files: filesOrOpts, sourceMetaUpdate: undefined }
    : filesOrOpts

  const root = getWorkspaceHandle()
  if (!root) throw new Error('No workspace connected')

  const index = await readUidIndex(root)
  const producesQueue: Array<{ sourceUid: string; producedUid: string }> = []

  async function saveOne(opts: SaveFileOptions): Promise<SaveResult> {
    const targetDir = opts.dir ? await resolveDir(opts.dir, true) : root
    const path = joinPath(opts.dir ?? '', opts.fileName)

    const [, newHash] = await Promise.all([
      fsWriteFile(targetDir, opts.fileName, opts.data as BlobPart),
      computeContentHash(opts.data.buffer as ArrayBuffer),
    ])

    const existingMeta = await readMetaFile(targetDir, opts.fileName)

    let uid: string
    if (existingMeta) {
      existingMeta.contentHash = newHash
      existingMeta.fileSize = opts.data.byteLength
      existingMeta.updatedAt = Date.now()
      if (opts.type) existingMeta.type = opts.type
      if (opts.openWith !== undefined) existingMeta.openWith = opts.openWith
      if (opts.origin) existingMeta.origin = opts.origin
      if (opts.pipeline) existingMeta.pipeline = [...(existingMeta.pipeline ?? []), ...opts.pipeline]
      if (opts.moduleData) existingMeta.moduleData = { ...existingMeta.moduleData, ...opts.moduleData }
      if (opts.tags) existingMeta.tags = opts.tags
      if (opts.relations) {
        const existing = existingMeta.relations ?? []
        for (const newRel of opts.relations) {
          const idx = existing.findIndex(r => r.rel === newRel.rel && r.uid === newRel.uid)
          if (idx >= 0) existing[idx] = newRel
          else existing.push(newRel)
        }
        existingMeta.relations = existing
      }
      await writeMetaFile(targetDir, opts.fileName, existingMeta)
      uid = existingMeta.uid
    } else {
      const meta = await createMetaForFile(targetDir, opts.fileName, opts.data.buffer as ArrayBuffer, {
        type: opts.type,
        origin: opts.origin,
        pipeline: opts.pipeline,
        openWith: opts.openWith,
        tags: opts.tags,
        moduleData: opts.moduleData,
      })
      if (opts.relations && opts.relations.length > 0) {
        meta.relations = opts.relations
        await writeMetaFile(targetDir, opts.fileName, meta)
      }
      uid = meta.uid
    }

    index[uid] = path
    if (opts.sourceUid) {
      producesQueue.push({ sourceUid: opts.sourceUid, producedUid: uid })
    }
    return { uid, path }
  }

  const results = await Promise.all(files.map(saveOne))

  const grouped = new Map<string, string[]>()
  for (const { sourceUid, producedUid } of producesQueue) {
    const list = grouped.get(sourceUid) ?? []
    list.push(producedUid)
    grouped.set(sourceUid, list)
  }
  for (const [sourceUid, producedUids] of grouped) {
    const sourcePath = index[sourceUid]
    if (!sourcePath) continue
    try {
      const { dir: srcDir, fileName: srcFile } = splitPath(sourcePath)
      const dirHandle = srcDir ? await resolveDir(srcDir) : root
      const sourceMeta = await readMetaFile(dirHandle, srcFile)
      if (!sourceMeta) continue
      const rels = sourceMeta.relations ?? []
      for (const uid of producedUids) {
        if (!rels.some(r => r.rel === 'produces' && r.uid === uid)) {
          rels.push({ rel: 'produces', uid })
        }
      }
      sourceMeta.relations = rels
      sourceMeta.updatedAt = Date.now()
      if (sourceMetaUpdate) sourceMetaUpdate(sourceMeta)
      await writeMetaFile(dirHandle, srcFile, sourceMeta)
    } catch { /* non-fatal */ }
  }

  if (grouped.size === 0 && sourceMetaUpdate) {
    const allSourceUids = new Set(files.map(f => f.sourceUid).filter(Boolean) as string[])
    for (const sourceUid of allSourceUids) {
      const sourcePath = index[sourceUid]
      if (!sourcePath) continue
      try {
        const { dir: srcDir, fileName: srcFile } = splitPath(sourcePath)
        const dirHandle = srcDir ? await resolveDir(srcDir) : root
        const sourceMeta = await readMetaFile(dirHandle, srcFile)
        if (!sourceMeta) continue
        sourceMeta.updatedAt = Date.now()
        sourceMetaUpdate(sourceMeta)
        await writeMetaFile(dirHandle, srcFile, sourceMeta)
      } catch { /* non-fatal */ }
    }
  }

  writeUidIndex(root, index).catch(() => {})

  notifyFileChanged()
  return results
}

async function addProducesRelation(root: FileSystemDirectoryHandle, sourceUid: string, producedUid: string): Promise<void> {
  try {
    const index = await readUidIndex(root)
    const sourcePath = index[sourceUid]
    if (!sourcePath) return
    const { dir: srcDir, fileName: srcFile } = splitPath(sourcePath)
    const dirHandle = srcDir ? await resolveDir(srcDir) : root
    const sourceMeta = await readMetaFile(dirHandle, srcFile)
    if (!sourceMeta) return
    const rels = sourceMeta.relations ?? []
    if (rels.some(r => r.rel === 'produces' && r.uid === producedUid)) return
    rels.push({ rel: 'produces', uid: producedUid })
    sourceMeta.relations = rels
    sourceMeta.updatedAt = Date.now()
    await writeMetaFile(dirHandle, srcFile, sourceMeta)
  } catch { /* non-fatal */ }
}

export type ReadFileResult = FsResult<{ data: Uint8Array; meta: MetaFile | null }>

export async function readFileFromWorkspace(
  filePath: string,
): Promise<ReadFileResult> {
  const root = getWorkspaceHandle()
  if (!root) return { ok: false, error: 'not-found', message: 'No workspace connected' }

  const { dir: dirPath, fileName } = splitPath(filePath)

  try {
    const dir = dirPath ? await resolveDir(dirPath) : root
    const data = await fsReadFile(dir, fileName)
    const metaResult = await readMetaFileFsResult(dir, fileName)
    const meta = metaResult.ok ? metaResult.data : null
    return { ok: true, data: { data, meta } }
  } catch (err) {
    return { ok: false, error: classifyError(err), message: String(err) }
  }
}

async function syncUidIndex(root: FileSystemDirectoryHandle, uid: string, path: string): Promise<void> {
  const index = await readUidIndex(root)
  index[uid] = path
  await writeUidIndex(root, index)
}

export async function deleteFileFromWorkspace(
  filePath: string,
): Promise<{ deletedUid?: string; referencedBy?: string[] }> {
  const root = getWorkspaceHandle()
  if (!root) throw new Error('No workspace connected')

  const { dir: dirPath, fileName } = splitPath(filePath)
  const dirHandle = dirPath ? await resolveDir(dirPath) : root
  const meta = await readMetaFile(dirHandle, fileName)
  const deletedUid = meta?.uid

  let referencedBy: string[] | undefined
  if (deletedUid) {
    referencedBy = await findRelationReferences(root, deletedUid)
  }

  await dirHandle.removeEntry(fileName)
  await deleteMetaFile(dirHandle, fileName)

  if (deletedUid) {
    const index = await readUidIndex(root)
    delete index[deletedUid]
    await writeUidIndex(root, index)
  }

  notifyFileChanged()
  return { deletedUid, referencedBy }
}

async function findRelationReferences(root: FileSystemDirectoryHandle, uid: string): Promise<string[]> {
  const refs: string[] = []
  try {
    const index = await readUidIndex(root)
    for (const [, path] of Object.entries(index)) {
      try {
        const { dir: d, fileName: f } = splitPath(path)
        const dh = d ? await resolveDir(d) : root
        const m = await readMetaFile(dh, f)
        if (m?.relations?.some(r => r.uid === uid)) {
          refs.push(path)
        }
      } catch { /* skip inaccessible */ }
    }
  } catch { /* uid-index read failure */ }
  return refs
}

export function isWorkspaceConnected(): boolean {
  return getWorkspaceHandle() !== null
}
