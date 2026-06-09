import type { SceneRegion as EditorRegion, RegionType as EditorRegionType } from './types'
import { isRectRegion } from './types'
import {
  RegionType as GsRegionType,
  type SceneRegion as GsRegion,
  type SceneRegionData as GsSceneRegionData,
} from '../../../shared/gs-format/types'

const REGION_TYPE_TO_GS: Record<EditorRegionType, GsRegionType> = {
  occlude: GsRegionType.Occlude,
  collision: GsRegionType.Collision,
}

const GS_REGION_TYPE_TO_EDITOR: Record<GsRegionType, EditorRegionType> = {
  [GsRegionType.Occlude]: 'occlude',
  [GsRegionType.Collision]: 'collision',
}

function nextGsId(usedIds: string[]): string {
  const nums = usedIds
    .map(id => parseInt(id.replace('r', ''), 10))
    .filter(n => !isNaN(n))
  const max = nums.length > 0 ? Math.max(...nums) : 0
  return `r${max + 1}`
}

export function editorRegionsToGs(
  regions: EditorRegion[],
  _imageSize: { w: number; h: number },
  existingGsRegions?: GsRegion[],
): GsRegion[] {
  const existingById = new Map<string, GsRegion>()
  if (existingGsRegions) {
    for (const r of existingGsRegions) existingById.set(r.id, r)
  }

  const usedIds = existingGsRegions?.map(r => r.id) ?? []

  return regions.map((er): GsRegion => {
    const matchById = existingById.get(er.id)
    const gsId = matchById ? matchById.id : nextGsId(usedIds)
    if (!matchById) usedIds.push(gsId)

    const gsRegion: GsRegion = {
      id: gsId,
      name: er.name,
      type: REGION_TYPE_TO_GS[er.type],
    }

    if (er.type === 'occlude' && er.groups.length > 0) {
      gsRegion.groups = [...er.groups]
    }

    if (isRectRegion(er.vertices)) {
      const xs = er.vertices.map(v => v[0])
      const ys = er.vertices.map(v => v[1])
      const x = Math.min(...xs)
      const y = Math.min(...ys)
      const w = Math.max(...xs) - x
      const h = Math.max(...ys) - y
      gsRegion.rect = [x, y, w, h]
    } else {
      gsRegion.verts = er.vertices.map(v => [v[0], v[1]])
    }

    return gsRegion
  })
}

export function gsRegionsToEditor(gsRegions: GsRegion[]): EditorRegion[] {
  return gsRegions.map((gr): EditorRegion => {
    const type = GS_REGION_TYPE_TO_EDITOR[gr.type]
    const groups = (gr.groups ?? []).map(g => String(g))

    let vertices: [number, number][]
    if (gr.verts) {
      vertices = gr.verts.map(v => [v[0], v[1]])
    } else if (gr.rect) {
      const [x, y, w, h] = gr.rect
      vertices = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
    } else {
      throw new Error(`[gs-convert] region "${gr.id}" has neither verts nor rect — schema violation`)
    }

    return {
      id: gr.id,
      name: gr.name,
      type,
      vertices,
      groups,
      color: '',
      colorManuallySet: false,
      visible: true,
    }
  })
}

export function buildGsSceneRegionData(
  regions: EditorRegion[],
  imageSize: { w: number; h: number },
  sceneName: string,
  texturePath: string,
  existingGsRegions?: GsRegion[],
): GsSceneRegionData {
  return {
    name: sceneName,
    texture: texturePath,
    size: [imageSize.w, imageSize.h],
    y_sort: true,
    regions: editorRegionsToGs(regions, imageSize, existingGsRegions),
  }
}
