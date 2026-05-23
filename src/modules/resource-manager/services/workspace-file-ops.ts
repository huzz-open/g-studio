/**
 * High-level workspace file operations for module integration.
 * Writes files + .meta sidecars to the workspace filesystem.
 * Falls back to old IDB-based ResourceService when no workspace.
 */
import { getWorkspaceHandle } from '../../../shared/workspace'
import type { MetaFile, MetaResourceType, MetaOrigin, PipelineStep, SlicerModuleData } from '../interfaces/meta'
import { createMetaForFile, writeMetaFile, readMetaFile } from './meta-service'
import { computeContentHash } from './content-hash'
import { generateUid } from './uid'
import { META_VERSION } from '../interfaces/meta'
import { notifyFileChanged } from './workspace-cache'

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

  let targetDir = root
  if (opts.dir) {
    const parts = opts.dir.split('/').filter(Boolean)
    for (const part of parts) {
      targetDir = await targetDir.getDirectoryHandle(part, { create: true })
    }
  }

  // Write the file
  const fileHandle = await targetDir.getFileHandle(opts.fileName, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(new Blob([opts.data as BlobPart]))
  await writable.close()

  // Create .meta
  const meta = await createMetaForFile(targetDir, opts.fileName, opts.data.buffer as ArrayBuffer, {
    type: opts.type,
    origin: opts.origin,
    pipeline: opts.pipeline,
    openWith: opts.openWith,
    tags: opts.tags,
    moduleData: opts.moduleData,
  })

  const path = opts.dir ? `${opts.dir}/${opts.fileName}` : opts.fileName
  notifyFileChanged()
  return { uid: meta.uid, path }
}

/**
 * Save a spritesheet with full slicer metadata.
 */
export async function saveSpritesheetToWorkspace(
  fileName: string,
  data: Uint8Array,
  slicerData: SlicerModuleData,
  extraMeta?: { width?: number; height?: number; description?: string },
): Promise<SaveResult> {
  const root = getWorkspaceHandle()
  if (!root) throw new Error('No workspace connected')

  const dir = await root.getDirectoryHandle('spritesheets', { create: true })

  const fileHandle = await dir.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(new Blob([data as BlobPart]))
  await writable.close()

  const now = Date.now()
  const contentHash = await computeContentHash(data.buffer as ArrayBuffer)

  const meta: MetaFile = {
    __version: META_VERSION,
    uid: generateUid(),
    boundFileName: fileName,
    contentHash,
    fileSize: data.byteLength,
    type: 'spritesheet',
    tags: [],
    description: extraMeta?.description,
    openWith: 'sprite-slicer',
    origin: {
      source: 'derived',
      method: 'sprite-slicer/standardize',
      createdBy: 'g-studio',
      importedAt: now,
    },
    pipeline: [
      { step: 'save', at: now, detail: 'saved as spritesheet from slicer' },
    ],
    relations: [],
    moduleData: {
      'sprite-slicer': slicerData,
    },
    createdAt: now,
    updatedAt: now,
  }

  await writeMetaFile(dir, fileName, meta)
  notifyFileChanged()
  return { uid: meta.uid, path: `spritesheets/${fileName}` }
}

/**
 * Read a file + meta from workspace by path.
 */
export async function readFileFromWorkspace(
  filePath: string,
): Promise<{ data: Uint8Array; meta: MetaFile | null } | null> {
  const root = getWorkspaceHandle()
  if (!root) return null

  const parts = filePath.split('/')
  const fileName = parts.pop()!
  let dir = root
  for (const part of parts) {
    try {
      dir = await dir.getDirectoryHandle(part)
    } catch {
      return null
    }
  }

  try {
    const fh = await dir.getFileHandle(fileName)
    const file = await fh.getFile()
    const data = new Uint8Array(await file.arrayBuffer())
    const meta = await readMetaFile(dir, fileName)
    return { data, meta }
  } catch {
    return null
  }
}

export function isWorkspaceConnected(): boolean {
  return getWorkspaceHandle() !== null
}
