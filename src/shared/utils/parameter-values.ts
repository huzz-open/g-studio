/** Ignore round-off from Float32 geometry and slider serialization. */
export function parameterValuesEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b)) {
    return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b))
  }
  return Object.is(a, b)
}
