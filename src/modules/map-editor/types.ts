export interface IconSize {
  w: number
  h: number
}

export interface Position {
  x: number | null
  y: number | null
}

export interface MapLocation {
  id: number
  tileInventoryId: number
  name: string
  region: string
  realm: 'human' | 'underground' | 'underworld' | 'celestial'
  level: string
  iconSize: IconSize
  position: Position
  iconPath: string | null
  displayName: string
}

export interface Region {
  id: string
  name: string
  element?: string
  color: string
  promptDesc: string
  vertices: [number, number][]
}

export interface WaterFeature {
  id: string
  name: string
  type: 'lake' | 'river' | 'moat'
  color: string
  vertices?: [number, number][]
  points?: [number, number][]
  width?: number
  center?: [number, number]
  radius?: number
}

export interface RoadConnection {
  id: string
  from: number
  to: number
  type: 'main' | 'path' | 'special'
  note?: string
}

export interface BaseMapMeta {
  baseMap: { width: number; height: number }
  aiGen: { width: number; height: number }
  ratio: string
  path: string
}

export interface WorldMapData {
  meta: {
    version: string
    description: string
    canvas: { width: number; height: number }
    baseMap: BaseMapMeta
    layers: Record<string, string>
  }
  regions: Region[]
  waterFeatures: WaterFeature[]
  locations: MapLocation[]
  roads: RoadConnection[]
}

export type LocationStatus = 'placed' | 'positioned' | 'pending'

export function getLocationStatus(loc: MapLocation): LocationStatus {
  if (loc.position.x !== null && loc.position.y !== null && loc.iconPath) {
    return 'placed'
  }
  if (loc.position.x !== null && loc.position.y !== null) {
    return 'positioned'
  }
  return 'pending'
}

export const REALM_LABELS: Record<string, string> = {
  human: '人间',
  underground: '地下',
  underworld: '幽冥',
  celestial: '天界',
}

export const REALM_ORDER = ['human', 'underground', 'underworld', 'celestial'] as const
