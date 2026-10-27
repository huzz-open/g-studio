/** Bounded payload buffers. A lease keeps accounting intact until HTTP delivery ends. */
export class EphemeralFiles {
  private entries = new Map<string, { data: Buffer; expires: number; leases: number; deleted: boolean }>();
  private reserved = 0;
  constructor(readonly limit: number, private now = Date.now) {
    if (!Number.isFinite(limit) || limit <= 0) throw Error('Invalid relay memory limit');
  }
  get used() { return [...this.entries.values()].reduce((sum, entry) => sum + entry.data.length, 0); }
  reserve(bytes: number) {
    this.sweep();
    if (this.used + this.reserved + bytes > this.limit) throw Object.assign(Error('Relay transfer memory quota reached'), { code: 'STORAGE_FULL', status: 507 });
    this.reserved += bytes;
    let released = false;
    return () => { if (!released) { released = true; this.reserved -= bytes; } };
  }
  set(key: string, data: Buffer, ttlMs = 120000) {
    this.delete(key);
    if (this.entries.has(key)) throw Object.assign(Error('Transfer still in progress'), { code: 'TRANSFER_BUSY', status: 409 });
    const release = this.reserve(data.length);
    release();
    this.entries.set(key, { data, expires: this.now() + ttlMs, leases: 0, deleted: false });
  }
  has(key: string) { this.sweep(); return !!this.entries.get(key) && !this.entries.get(key)!.deleted; }
  acquire(key: string) {
    if (!this.has(key)) return undefined;
    const entry = this.entries.get(key)!;
    entry.leases++;
    let released = false;
    return { data: entry.data, release: () => {
      if (released) return;
      released = true;
      entry.leases--;
      if (!entry.leases && entry.deleted) this.entries.delete(key);
    } };
  }
  delete(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.deleted = true;
    if (!entry.leases) this.entries.delete(key);
  }
  sweep() { for (const [key, entry] of this.entries) if (entry.expires <= this.now()) this.delete(key); }
}
