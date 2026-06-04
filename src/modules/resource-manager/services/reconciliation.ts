import type { ScanResult, FsEntry, MetaFile } from '../interfaces/meta'
import { computeContentHash } from './content-hash'
import { createMetaForFile, writeMetaFile } from './meta-service'
import { generateUid } from './uid'
import { readUidIndex, writeUidIndex, buildUidIndexFromLinked } from './uid-index'
import { resolveDir, splitPath, readJsonFileOrNull, deleteFile as fsDeleteFile } from '../../../shared/workspace/fs'

export interface ReconciliationReport {
  repaired: number
  newMetas: number
  orphansCleaned: number
  duplicateUids: number
  hashUpdated: number
}

/**
 * Full reconciliation: match orphaned .meta with unmatched files,
 * create new .meta for truly new files, detect duplicate UIDs,
 * verify contentHash consistency, rebuild uid-index.json.
 */
export async function reconcile(
  root: FileSystemDirectoryHandle,
  scanResult: ScanResult,
): Promise<ReconciliationReport> {
  const report: ReconciliationReport = {
    repaired: 0,
    newMetas: 0,
    orphansCleaned: 0,
    duplicateUids: 0,
    hashUpdated: 0,
  }

  const uidIndex = await readUidIndex(root)
  const { linked, unmatchedFiles, orphanedMetas } = scanResult

  // Phase 2: Match orphaned metas to unmatched files by contentHash
  const remainingOrphans = [...orphanedMetas]
  const remainingUnmatched = [...unmatchedFiles]

  for (let i = remainingUnmatched.length - 1; i >= 0; i--) {
    const file = remainingUnmatched[i]
    if (file.kind !== 'file') continue

    const fileHandle = file.handle as FileSystemFileHandle
    let fileObj: File
    try {
      fileObj = await fileHandle.getFile()
    } catch {
      continue
    }

    let matched = false
    for (let j = remainingOrphans.length - 1; j >= 0; j--) {
      const orphan = remainingOrphans[j]
      if (orphan.meta.fileSize !== fileObj.size) continue

      const hash = await computeContentHash(await fileObj.arrayBuffer())
      if (hash === orphan.meta.contentHash) {
        const { dir: dirPath } = splitPath(file.path)
        const dirHandle = await resolveDir(dirPath)
        orphan.meta.boundFileName = file.name
        orphan.meta.updatedAt = Date.now()
        await writeMetaFile(dirHandle, file.name, orphan.meta)

        // Delete old orphaned meta
        try {
          const { dir: oldMetaDirPath, fileName: oldMetaName } = splitPath(orphan.path)
          const oldMetaDir = await resolveDir(oldMetaDirPath)
          await oldMetaDir.removeEntry(oldMetaName)
        } catch { /* already gone */ }

        file.meta = orphan.meta
        linked.push({ file, meta: orphan.meta })
        remainingOrphans.splice(j, 1)
        remainingUnmatched.splice(i, 1)
        report.repaired++
        matched = true
        break
      }
    }

    if (matched) continue
  }

  // Phase 2b: For still-unmatched files, try uid-index recovery
  for (let i = remainingUnmatched.length - 1; i >= 0; i--) {
    const file = remainingUnmatched[i]
    if (file.kind !== 'file') continue

    const fileHandle = file.handle as FileSystemFileHandle
    let fileObj: File
    try {
      fileObj = await fileHandle.getFile()
    } catch {
      continue
    }

    let recoveredUid: string | undefined
    for (const [uid, path] of Object.entries(uidIndex)) {
      if (path === file.path) {
        recoveredUid = uid
        break
      }
    }

    const { dir: unmatchedDirPath } = splitPath(file.path)
    const dirHandle = await resolveDir(unmatchedDirPath)
    const buffer = await fileObj.arrayBuffer()

    if (!recoveredUid) {
      recoveredUid = await tryRecoverUidFromCorrupt(dirHandle, file.name)
    }

    if (recoveredUid) {
      const hash = await computeContentHash(buffer)
      const meta: MetaFile = {
        __version: 1,
        uid: recoveredUid,
        boundFileName: file.name,
        contentHash: hash,
        fileSize: buffer.byteLength,
        type: 'generic',
        tags: [],
        origin: { source: 'external', createdBy: 'external', importedAt: Date.now() },
        pipeline: [{ step: 'uid-recovered', at: Date.now(), detail: 'from uid-index.json' }],
        relations: [],
        moduleData: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      await writeMetaFile(dirHandle, file.name, meta)
      file.meta = meta
      linked.push({ file, meta })
      report.repaired++
    } else {
      const meta = await createMetaForFile(dirHandle, file.name, buffer)
      file.meta = meta
      linked.push({ file, meta })
      report.newMetas++
    }
    remainingUnmatched.splice(i, 1)
  }

  // Phase 4: Consistency check — verify contentHash for all linked entries
  for (const { file, meta } of linked) {
    if (file.kind !== 'file') continue
    const fh = file.handle as FileSystemFileHandle
    let fileObj: File
    try {
      fileObj = await fh.getFile()
    } catch {
      continue
    }

    let needsUpdate = false
    if (meta.boundFileName !== file.name) {
      meta.boundFileName = file.name
      needsUpdate = true
    }
    if (meta.fileSize !== fileObj.size) {
      const buffer = await fileObj.arrayBuffer()
      meta.contentHash = await computeContentHash(buffer)
      meta.fileSize = buffer.byteLength
      needsUpdate = true
      report.hashUpdated++
    }

    if (needsUpdate) {
      meta.updatedAt = Date.now()
      const { dir: consistencyDirPath } = splitPath(file.path)
      const consistencyDir = await resolveDir(consistencyDirPath)
      await writeMetaFile(consistencyDir, file.name, meta)
    }
  }

  // Phase 4b: Duplicate UID check
  const uidMap = new Map<string, Array<{ file: FsEntry; meta: MetaFile }>>()
  for (const entry of linked) {
    const list = uidMap.get(entry.meta.uid) ?? []
    list.push(entry)
    uidMap.set(entry.meta.uid, list)
  }
  for (const [, entries] of uidMap) {
    if (entries.length <= 1) continue
    entries.sort((a, b) => a.meta.createdAt - b.meta.createdAt)
    const originalUid = entries[0].meta.uid
    for (let k = 1; k < entries.length; k++) {
      const dup = entries[k]
      dup.meta.uid = generateUid()
      dup.meta.relations = dup.meta.relations ?? []
      dup.meta.relations.push({ rel: 'variant-of', uid: originalUid })
      dup.meta.updatedAt = Date.now()
      const { dir: dupDirPath } = splitPath(dup.file.path)
      const dupDirHandle = await resolveDir(dupDirPath)
      await writeMetaFile(dupDirHandle, dup.file.name, dup.meta)
      report.duplicateUids++
    }
  }

  // Phase 5: Rebuild uid-index.json
  const newIndex = buildUidIndexFromLinked(linked)
  await writeUidIndex(root, newIndex)

  return report
}

async function tryRecoverUidFromCorrupt(
  dirHandle: FileSystemDirectoryHandle,
  fileName: string,
): Promise<string | undefined> {
  const corruptName = `.${fileName}.meta.corrupt`
  const data = await readJsonFileOrNull<{ uid?: string }>(dirHandle, corruptName)
  if (!data?.uid) return undefined
  try {
    await fsDeleteFile(dirHandle, corruptName)
  } catch { /* best effort cleanup */ }
  return data.uid
}

