const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])

export function isImageFile(name: string): boolean {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false
  return IMAGE_EXTS.has(name.substring(dot).toLowerCase())
}

export function isGsFile(name: string): boolean {
  return name.toLowerCase().endsWith('.gs')
}
