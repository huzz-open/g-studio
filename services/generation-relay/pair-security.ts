import { isIP } from 'node:net';
const normalize = (ip: string) => ip.startsWith('::ffff:') ? ip.slice(7) : ip;
/** Only explicitly trusted immediate proxies may supply a client address. */
export function clientAddress(peer: string, forwarded: string | undefined, trusted: string[]) {
  let address = normalize(peer);
  const proxies = new Set(trusted.map(normalize));
  if (!proxies.has(address) || !forwarded) return address;
  const chain = forwarded.split(',').map(ip => normalize(ip.trim()));
  if (chain.some(ip => !isIP(ip))) return address;
  for (const ip of chain.reverse()) {
    if (!proxies.has(address)) break;
    address = ip;
  }
  return address;
}
export class PairFailureGuard {
  private records = new Map<string, { failures: number; reset: number; blockedUntil: number }>();
  constructor(private now = Date.now, private limit = 5, private banMs = 15 * 60000) {}
  check(ip: string) {
    const entry = this.records.get(ip);
    if (entry && entry.blockedUntil > this.now()) throw Object.assign(Error('Too many invalid pairing attempts; try again later'), { code: 'PAIR_BLOCKED', status: 429, retryAfter: Math.ceil((entry.blockedUntil-this.now())/1000) });
  }
  failed(ip: string) {
    this.sweep();
    let entry = this.records.get(ip);
    if (!entry) {
      if (this.records.size >= 10000) throw Object.assign(Error('Pairing temporarily busy'), { code:'RATE_LIMIT',status:429 });
      entry = { failures:0, reset:this.now()+10*60000, blockedUntil:0 };
      this.records.set(ip, entry);
    }
    if (++entry.failures >= this.limit) entry.blockedUntil = this.now()+this.banMs;
    this.check(ip);
  }
  sweep() { for (const [ip, entry] of this.records) if (Math.max(entry.reset, entry.blockedUntil) <= this.now()) this.records.delete(ip); }
}
