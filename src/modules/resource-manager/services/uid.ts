/**
 * UID generation for G-Studio resources.
 * Format: gs://<timestamp-base36>-<random-6chars>
 * Once generated, a UID never changes.
 */

const RANDOM_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'

function randomChars(len: number): string {
  let result = ''
  for (let i = 0; i < len; i++) {
    result += RANDOM_CHARS[Math.floor(Math.random() * RANDOM_CHARS.length)]
  }
  return result
}

export function generateUid(): string {
  const ts = Date.now().toString(36)
  const rand = randomChars(6)
  return `gs://${ts}-${rand}`
}

export function isValidUid(uid: string): boolean {
  return /^gs:\/\/[a-z0-9]+-[a-z0-9]{6}$/.test(uid)
}
