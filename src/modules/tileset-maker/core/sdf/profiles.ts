import type { EdgeProfile } from '../types'

export const PROFILE_NAMES = ['stone', 'dirt', 'grass', 'brick', 'crystal', 'wood'] as const
export type ProfileName = (typeof PROFILE_NAMES)[number]

export const SLIDER_DEFS: Array<{ key: keyof EdgeProfile; labelKey: string; min: number; max: number }> = [
  { key: 'edgeOffset', labelKey: 'tileset.profile.edgeOffset', min: 0.10, max: 0.40 },
  { key: 'cornerRadius', labelKey: 'tileset.profile.cornerRadius', min: 0, max: 0.30 },
  { key: 'innerDepth', labelKey: 'tileset.profile.innerDepth', min: 0, max: 0.20 },
  { key: 'haloWidth', labelKey: 'tileset.profile.haloWidth', min: 0, max: 0.25 },
  { key: 'borderWidth', labelKey: 'tileset.profile.borderWidth', min: 0, max: 0.15 },
  { key: 'borderDarken', labelKey: 'tileset.profile.borderDarken', min: 0, max: 0.70 },
  { key: 'noiseAmp', labelKey: 'tileset.profile.noiseAmp', min: 0, max: 2.0 },
]

export function getProfile(name: string): EdgeProfile {
  switch (name) {
    case 'stone':
      return { style: 'stone', edgeOffset: 0.25, cornerRadius: 0.12, innerDepth: 0.0, noiseAmp: 1.0, haloWidth: 0.15, borderWidth: 0.06, borderDarken: 0.45 }
    case 'dirt':
      return { style: 'dirt', edgeOffset: 0.22, cornerRadius: 0.15, innerDepth: 0.0, noiseAmp: 1.0, haloWidth: 0.12, borderWidth: 0.05, borderDarken: 0.35 }
    case 'grass':
      return { style: 'grass', edgeOffset: 0.20, cornerRadius: 0.18, innerDepth: 0.0, noiseAmp: 1.0, haloWidth: 0.08, borderWidth: 0.04, borderDarken: 0.20 }
    case 'brick':
      return { style: 'brick', edgeOffset: 0.25, cornerRadius: 0.03, innerDepth: 0.0, noiseAmp: 1.0, haloWidth: 0.12, borderWidth: 0.07, borderDarken: 0.50 }
    case 'crystal':
      return { style: 'crystal', edgeOffset: 0.25, cornerRadius: 0.06, innerDepth: 0.0, noiseAmp: 1.0, haloWidth: 0.18, borderWidth: 0.05, borderDarken: 0.30 }
    case 'wood':
      return { style: 'wood', edgeOffset: 0.23, cornerRadius: 0.08, innerDepth: 0.0, noiseAmp: 1.0, haloWidth: 0.12, borderWidth: 0.06, borderDarken: 0.40 }
    default:
      return getProfile('stone')
  }
}
