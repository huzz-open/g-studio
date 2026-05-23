import type { MetaFile, MetaResourceType } from '../interfaces/meta'
import { META_VERSION } from '../interfaces/meta'
import { generateUid } from './uid'
import { computeContentHash } from './content-hash'
import { writeMetaFile } from './meta-service'

interface OldRegistryRecord {
  id: string
  name: string
  type: string
  tags: string[]
  thumbnail: string | null
  metadata: Record<string, unknown>
  filePath: string
  createdAt: number
  updatedAt: number
}

interface OldRegistry {
  version: number
  updatedAt: number
  stores: {
    resources: OldRegistryRecord[]
  }
}

const REGISTRY_FILE = '.g-studio-registry.json'
const REGISTRY_BAK = '.g-studio-registry.json.bak'

/**
 * Migrate from old .g-studio-registry.json to per-file .meta sidecars.
 * Returns number of files migrated. Renames registry to .bak on success.
 */
export async function migrateFromRegistry(
  root: FileSystemDirectoryHandle,
): Promise<number> {
  let registryText: string
  try {
    const file = await root.getFileHandle(REGISTRY_FILE)
    registryText = await (await file.getFile()).text()
  } catch {
    return 0
  }

  let registry: OldRegistry
  try {
    registry = JSON.parse(registryText)
  } catch {
    return 0
  }

  const records = registry.stores?.resources ?? []
  if (records.length === 0) return 0

  let migrated = 0
  for (const rec of records) {
    try {
      await migrateRecord(root, rec)
      migrated++
    } catch (err) {
      console.warn('[Migration] Failed to migrate resource:', rec.id, err)
    }
  }

  // Rename old registry to .bak
  try {
    const bakHandle = await root.getFileHandle(REGISTRY_BAK, { create: true })
    const writable = await bakHandle.createWritable()
    await writable.write(registryText)
    await writable.close()
    await root.removeEntry(REGISTRY_FILE)
  } catch {
    /* leave registry in place if rename fails */
  }

  return migrated
}

async function migrateRecord(
  root: FileSystemDirectoryHandle,
  rec: OldRegistryRecord,
): Promise<void> {
  const filePath = rec.filePath
  if (!filePath) return

  const parts = filePath.split('/')
  const fileName = parts.pop()!
  let dir = root
  for (const part of parts) {
    try {
      dir = await dir.getDirectoryHandle(part)
    } catch {
      return
    }
  }

  // Verify file exists
  let fileObj: File
  try {
    const fh = await dir.getFileHandle(fileName)
    fileObj = await fh.getFile()
  } catch {
    return
  }

  // Check if .meta already exists (skip if so)
  try {
    await dir.getFileHandle(`.${fileName}.meta`)
    return
  } catch {
    /* doesn't exist, proceed */
  }

  const buffer = await fileObj.arrayBuffer()
  const contentHash = await computeContentHash(buffer)

  const meta: MetaFile = {
    __version: META_VERSION,
    uid: generateUid(),
    boundFileName: fileName,
    contentHash,
    fileSize: buffer.byteLength,
    type: (rec.type as MetaResourceType) ?? 'generic',
    tags: rec.tags ?? [],
    openWith: rec.type === 'spritesheet' ? 'sprite-slicer' : undefined,
    origin: {
      source: 'uploaded',
      createdBy: 'g-studio',
      importedAt: rec.createdAt,
    },
    pipeline: [
      { step: 'migrated', at: Date.now(), detail: `from registry id=${rec.id}` },
    ],
    relations: [],
    moduleData: {},
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  }

  // Carry over slicer metadata if present
  if (rec.metadata && Object.keys(rec.metadata).length > 0) {
    meta.moduleData = {
      'sprite-slicer': {
        sliceConfig: rec.metadata as MetaFile['moduleData'] extends { 'sprite-slicer'?: infer T } ? T extends { sliceConfig?: infer S } ? S : undefined : undefined,
      },
    }
  }

  await writeMetaFile(dir, fileName, meta)
}
