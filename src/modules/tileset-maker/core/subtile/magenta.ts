const MAGENTA_R = 255
const MAGENTA_G = 0
const MAGENTA_B = 255

/**
 * Replace magenta-colored pixels with transparent.
 * Operates directly on pixel buffer, no Canvas round-trip.
 */
export function replaceMagentaWithTransparent(
  pixels: Uint8ClampedArray,
  tolerance: number = 30,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels)
  for (let i = 0; i < out.length; i += 4) {
    const dr = Math.abs(out[i] - MAGENTA_R)
    const dg = Math.abs(out[i + 1] - MAGENTA_G)
    const db = Math.abs(out[i + 2] - MAGENTA_B)
    if (dr <= tolerance && dg <= tolerance && db <= tolerance) {
      out[i + 3] = 0
    }
  }
  return out
}
