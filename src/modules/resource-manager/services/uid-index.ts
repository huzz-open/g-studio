import type { UidIndex } from '../interfaces/meta'
import { readJsonFileOrNull, writeJsonFile } from '../../../shared/workspace/fs'
import { WORKSPACE_SYSTEM_DIR } from '../../../shared/workspace/interfaces'

const INDEX_FILE = 'uid-index.json'

export async function readUidIndex(
  root: FileSystemDirectoryHandle,
): Promise<UidIndex> {
  try {
    const dir = await root.getDirectoryHandle(WORKSPACE_SYSTEM_DIR)
    return await readJsonFileOrNull<UidIndex>(dir, INDEX_FILE) ?? {}
  } catch {
    return {}
  }
}

export async function writeUidIndex(
  root: FileSystemDirectoryHandle,
  index: UidIndex,
): Promise<void> {
  const dir = await root.getDirectoryHandle(WORKSPACE_SYSTEM_DIR, { create: true })
  await writeJsonFile(dir, INDEX_FILE, index)
}

export function buildUidIndexFromLinked(
  linked: Array<{ meta: { uid: string }; file: { path: string } }>,
): UidIndex {
  const index: UidIndex = {}
  for (const { meta, file } of linked) {
    index[meta.uid] = file.path
  }
  return index
}
