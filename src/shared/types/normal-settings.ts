export interface NormalSettings {
  alphaThreshold: number
  shapeRadius: number
  shapeStrength: number
  shapeSoftness: number
  detailStrength: number
  detailScale: number
  normalStrength: number
  normalFormat: 'opengl' | 'directx'
  invertX: boolean
  invertY: boolean
}

export const DEFAULT_NORMAL_SETTINGS: Readonly<NormalSettings> = Object.freeze({
  alphaThreshold: 0.03, shapeRadius: 4, shapeStrength: 1.15, shapeSoftness: 1.15,
  detailStrength: 6, detailScale: 0.6, normalStrength: 1.5,
  normalFormat: 'opengl', invertX: false, invertY: false,
})

export const NORMAL_RANGES = {
  alphaThreshold: [0, 0.99], shapeRadius: [0.5, 512], shapeStrength: [0, 8],
  shapeSoftness: [0, 8], detailStrength: [0, 8], detailScale: [0.6, 8], normalStrength: [0, 8],
} as const

export function normalSettings(value?: Partial<NormalSettings>): NormalSettings {
  const result = { ...DEFAULT_NORMAL_SETTINGS, ...value }
  for (const key of Object.keys(NORMAL_RANGES) as (keyof typeof NORMAL_RANGES)[]) {
    const [min, max] = NORMAL_RANGES[key]
    if (!Number.isFinite(result[key]) || result[key] < min || result[key] > max) {
      throw new Error(`Invalid normal setting: ${key} (${min}–${max})`)
    }
  }
  if (!['opengl', 'directx'].includes(result.normalFormat)
    || typeof result.invertX !== 'boolean' || typeof result.invertY !== 'boolean') {
    throw new Error('Invalid normal orientation')
  }
  return result
}
