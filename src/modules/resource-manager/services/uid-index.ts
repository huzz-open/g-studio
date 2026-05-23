import type { UidIndex } from '../interfaces/meta'

const INDEX_DIR = '.g-studio'
const INDEX_FILE = 'uid-index.json'

export async function readUidIndex(
  root: FileSystemDirectoryHandle,
): Promise<UidIndex> {
  try {
    const dir = await root.getDirectoryHandle(INDEX_DIR)
    const fileHandle = await dir.getFileHandle(INDEX_FILE)
    const file = await fileHandle.getFile()
    const text = await file.text()
    return JSON.parse(text) as UidIndex
  } catch {
    return {}
  }
}

export async function writeUidIndex(
  root: FileSystemDirectoryHandle,
  index: UidIndex,
): Promise<void> {
  const dir = await root.getDirectoryHandle(INDEX_DIR, { create: true })
  const fileHandle = await dir.getFileHandle(INDEX_FILE, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(JSON.stringify(index, null, 2))
  await writable.close()
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
