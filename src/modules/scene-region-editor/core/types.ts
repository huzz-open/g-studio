export type RegionType = 'occlude' | 'collision'

export interface SceneRegion {
  id: string
  name: string
  type: RegionType
  vertices: [number, number][]
  groups: string[]
  color: string
  colorManuallySet: boolean
  visible: boolean
}

/** Axis-aligned rectangle detection: exactly 4 distinct points forming 2 unique X and 2 unique Y values */
export function isRectRegion(vertices: [number, number][]): boolean {
  if (vertices.length !== 4) return false
  const xs = new Set(vertices.map(v => v[0]))
  const ys = new Set(vertices.map(v => v[1]))
  if (xs.size !== 2 || ys.size !== 2) return false
  const pointSet = new Set(vertices.map(([x, y]) => `${x},${y}`))
  return pointSet.size === 4
}

export interface RegionPreset {
  id: string
  name: string
  type: RegionType
  groups: string[]
  color: string
}

export interface SceneRegionData {
  version: '1.0'
  imageSize: { w: number; h: number }
  regions: SceneRegion[]
}
