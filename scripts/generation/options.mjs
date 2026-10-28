import { isIP } from 'node:net';

export function configureNetwork(flags, env = process.env) {
  const hostIndex = flags.indexOf('--host'), portIndex = flags.indexOf('--port');
  for (const [name, index] of [['--host', hostIndex], ['--port', portIndex]]) {
    if (index >= 0 && (!flags[index + 1] || flags[index + 1].startsWith('--'))) throw Error(`${name} requires a value`);
  }
  const host = (hostIndex >= 0 ? flags[hostIndex + 1] : env.GEN_HOST) || '127.0.0.1';
  if (!isIP(host) && host !== 'localhost') throw Error('--host / GEN_HOST must be an IP address (127.0.0.1 or 0.0.0.0)');
  const port = (portIndex >= 0 ? flags[portIndex + 1] : env.GEN_PORT) || '8765';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw Error('--port / GEN_PORT must be between 1 and 65535');
  env.GEN_HOST = host === 'localhost' ? '127.0.0.1' : host;
  env.GEN_PORT = port;
  const origins = [];
  flags.forEach((value, index) => {
    if (value !== '--origin') return;
    const input = flags[index + 1];
    if (!input) throw Error('--origin requires an http(s) origin');
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== input || url.hostname.includes('*') || url.username || url.password) throw Error('--origin requires an exact http(s) origin without a path');
    origins.push(url.origin);
  });
  const allowed = origins.length ? ['http://localhost:5173', 'http://127.0.0.1:5173', ...origins] : env.GEN_ORIGINS?.split(',');
  if (allowed) {
    env.GEN_ORIGINS = [...new Set(allowed.map(value => {
      const input = value.trim().replace(/\/$/, ''), url = new URL(input);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== input || url.hostname.includes('*') || url.username || url.password) throw Error('GEN_ORIGINS requires exact http(s) origins without paths or wildcards');
      return url.origin;
    }))].join(',');
  }
  const probeHost = ['0.0.0.0', '::'].includes(env.GEN_HOST) ? (env.GEN_HOST === '::' ? '::1' : '127.0.0.1') : env.GEN_HOST;
  return `http://${probeHost.includes(':') ? `[${probeHost}]` : probeHost}:${port}`;
}
