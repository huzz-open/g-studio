/**
 * Compute SHA-256 content hash (first 16 hex chars) for file binding.
 * Uses Web Crypto API — always async, never blocks UI.
 */

export async function computeContentHash(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hashBuffer)
  let hex = ''
  for (let i = 0; i < 8; i++) {
    hex += hashArray[i].toString(16).padStart(2, '0')
  }
  return hex
}

export async function computeContentHashFromFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  return computeContentHash(buffer)
}
