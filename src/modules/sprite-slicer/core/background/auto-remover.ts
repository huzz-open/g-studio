import type { IBackgroundRemover, BgRemovalOptions } from '../../interfaces/background-remover'

export class AutoRemover implements IBackgroundRemover {
  readonly id = 'auto'
  readonly labelKey = 'slicer.bgRemoval.auto'

  remove(data: ImageData, options: BgRemovalOptions): ImageData {
    if (this.hasExistingTransparency(data)) return data

    const [bgR, bgG, bgB] = options.bgColor
    const isMagenta = bgR > 200 && bgG < 50 && bgB > 200

    if (isMagenta) {
      return this.reverseCompositeRemove(data, options.tolerance, options.spillStrength)
    }
    return this.colorDistanceRemove(data, options.bgColor, options.tolerance)
  }

  private hasExistingTransparency(data: ImageData): boolean {
    const d = data.data
    const total = d.length / 4
    let transparent = 0
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] === 0) transparent++
    }
    return (transparent / total) >= 0.01
  }

  private reverseCompositeRemove(
    data: ImageData, sensitivity: number, spillPct: number,
  ): ImageData {
    const d = data.data
    const len = d.length
    const softLower = 0.02 + (1 - sensitivity / 100) * 0.18
    const softUpper = softLower + 0.17
    const spillMul = spillPct / 100 * 0.85

    for (let i = 0; i < len; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3]
      if (a < 10) continue

      const rf = r / 255, gf = g / 255, bf = b / 255
      const alpha = Math.max(gf, 1 - rf, 1 - bf)

      const minRB = Math.min(r, b)
      const brightness = (r + g + b) / (3 * 255)
      const brightW = Math.min(brightness / 0.3, 1)
      const magScore = Math.max(0, (minRB - g) / 255) * brightW

      const blend = Math.min(1, Math.max(0, (magScore - softLower) / (softUpper - softLower)))

      if (blend < 0.001) continue

      const safeA = alpha > 0.001 ? alpha : 1
      const oneMinusA = 1 - alpha
      const rRev = Math.min(255, Math.max(0, (r - 255 * oneMinusA) / safeA))
      const gRev = Math.min(255, Math.max(0, g / safeA))
      const bRev = Math.min(255, Math.max(0, (b - 255 * oneMinusA) / safeA))
      const aRev = alpha * 255

      let rNew = r * (1 - blend) + rRev * blend
      let gNew = g * (1 - blend) + gRev * blend
      let bNew = b * (1 - blend) + bRev * blend
      let aNew = 255 * (1 - blend) + aRev * blend

      if (spillMul > 0 && aNew < 255) {
        const spillStr = Math.min(1, 1 - aNew / 255)
        const excess = Math.max(0, Math.min(rNew, bNew) - gNew)
        const corr = excess * spillStr * spillMul
        rNew = Math.max(0, rNew - corr)
        bNew = Math.max(0, bNew - corr)
      }

      if (magScore > 0.4 && alpha < 0.15) aNew = 0
      if (aNew < 15) { rNew = 0; gNew = 0; bNew = 0; aNew = 0 }

      d[i] = rNew; d[i + 1] = gNew; d[i + 2] = bNew; d[i + 3] = aNew
    }
    return data
  }

  private colorDistanceRemove(
    data: ImageData, bgColor: [number, number, number], tol: number,
  ): ImageData {
    const d = data.data
    const [br, bg, bb] = bgColor
    const hardTol = tol
    const softTol = tol * 2
    for (let i = 0; i < d.length; i += 4) {
      const dr = Math.abs(d[i] - br)
      const dg = Math.abs(d[i + 1] - bg)
      const db = Math.abs(d[i + 2] - bb)
      const dist = Math.max(dr, dg, db)
      if (dist <= hardTol) {
        d[i + 3] = 0
      } else if (dist <= softTol) {
        const alpha = Math.round(((dist - hardTol) / hardTol) * 255)
        d[i + 3] = Math.min(d[i + 3], alpha)
      }
    }
    return data
  }
}
