export function isLocalServiceHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true
  if (/^(fc|fd)[0-9a-f]{2}:|^fe[89ab][0-9a-f]:/.test(host)) return true
  const bytes = host.split('.').map(Number)
  return bytes.length === 4 && bytes.every(value => Number.isInteger(value) && value >= 0 && value <= 255)
    && (bytes[0] === 127 || bytes[0] === 10 || bytes[0] === 192 && bytes[1] === 168 || bytes[0] === 172 && bytes[1]! >= 16 && bytes[1]! <= 31)
}

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

/** Build a single-line command using the current site's deployment path. */
export function installCommand(siteBase: string, remote = false) {
  const site = new URL(siteBase)
  if (!['http:', 'https:'].includes(site.protocol) || site.username || site.password || site.search || site.hash) throw Error('Invalid installation site')
  const base = site.href.endsWith('/') ? site.href : site.href + '/'
  return `curl -fsSL ${shellQuote(base + 'install-generation.sh')} | bash -s -- --site ${shellQuote(base)}${remote ? ' --host 0.0.0.0' : ''}`
}
