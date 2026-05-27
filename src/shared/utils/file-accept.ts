export function matchesAccept(file: File, accept: string): boolean {
  if (!accept || accept === '*/*') return true
  const exts = accept.split(',').map(s => s.trim())
  return exts.some(ext => {
    if (ext.startsWith('.')) return file.name.toLowerCase().endsWith(ext)
    if (ext.endsWith('/*')) return file.type.startsWith(ext.replace('/*', '/'))
    return file.type === ext
  })
}

export function filterFilesByAccept(files: File[], accept: string): File[] {
  if (!accept || accept === '*/*') return files
  return files.filter(f => matchesAccept(f, accept))
}
