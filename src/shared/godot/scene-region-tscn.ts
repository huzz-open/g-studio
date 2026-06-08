/**
 * Generate a complete .tscn file from SceneRegionData (for lightweight export mode).
 */
import {
  TscnBuilder,
  formatVector2,
  formatPackedVector2Array,
  formatExtResourceRef,
  formatSubResourceRef,
  escapeNodeName,
} from './tscn-builder'
import { RegionType, type SceneRegionData, type SceneRegion } from '../gs-format/types'

function isRect(region: SceneRegion): boolean {
  return region.rect !== undefined
}

function rectCenter(rect: [number, number, number, number]): [number, number] {
  return [rect[0] + rect[2] / 2, rect[1] + rect[3] / 2]
}

export function generateSceneRegionTscn(data: SceneRegionData, texturePath: string): string {
  const builder = new TscnBuilder()

  builder.setRoot(data.name, 'Node2D', data.y_sort ? { y_sort_enabled: 'true' } : {})

  const textureId = builder.addExtResource('Texture2D', texturePath)

  const cx = data.size[0] / 2
  const cy = data.size[1] / 2

  builder.addNode({
    name: 'Sprite2D',
    type: 'Sprite2D',
    parent: '.',
    props: {
      z_index: '-1',
      texture: formatExtResourceRef(textureId),
      position: formatVector2(cx, cy),
    },
  })

  const occludeRegions = data.regions.filter(r => r.type === RegionType.Occlude)
  const collisionRegions = data.regions.filter(r => r.type === RegionType.Collision)

  if (occludeRegions.length > 0) {
    builder.addNode({
      name: 'Obstacles',
      type: 'Node2D',
      parent: '.',
      props: { position: formatVector2(cx, cy) },
    })

    for (const region of occludeRegions) {
      const safeName = escapeNodeName(region.name)
      const groups = (region.groups ?? []).filter(g => g.length > 0)

      builder.addNode({
        name: safeName,
        type: 'Area2D',
        parent: 'Obstacles',
        groups: groups.length > 0 ? groups : undefined,
      })

      if (isRect(region)) {
        const rect = region.rect!
        const center = rectCenter(rect)
        const subId = builder.addSubResource('RectangleShape2D', {
          size: formatVector2(rect[2], rect[3]),
        })
        builder.addNode({
          name: 'CollisionShape2D',
          type: 'CollisionShape2D',
          parent: `Obstacles/${safeName}`,
          props: {
            shape: formatSubResourceRef(subId),
            position: formatVector2(center[0] - cx, center[1] - cy),
          },
        })
      } else if (region.verts) {
        const offsetVerts: [number, number][] = region.verts.map(v => [v[0] - cx, v[1] - cy])
        builder.addNode({
          name: 'CollisionPolygon2D',
          type: 'CollisionPolygon2D',
          parent: `Obstacles/${safeName}`,
          props: {
            polygon: formatPackedVector2Array(offsetVerts),
          },
        })
      }
    }
  }

  if (collisionRegions.length > 0) {
    builder.addNode({
      name: 'Collision',
      type: 'StaticBody2D',
      parent: '.',
      props: { position: formatVector2(cx, cy) },
    })

    for (const region of collisionRegions) {
      const safeName = escapeNodeName(region.name)

      if (isRect(region)) {
        const rect = region.rect!
        const center = rectCenter(rect)
        const subId = builder.addSubResource('RectangleShape2D', {
          size: formatVector2(rect[2], rect[3]),
        })
        builder.addNode({
          name: safeName,
          type: 'CollisionShape2D',
          parent: 'Collision',
          props: {
            shape: formatSubResourceRef(subId),
            position: formatVector2(center[0] - cx, center[1] - cy),
          },
        })
      } else if (region.verts) {
        const offsetVerts: [number, number][] = region.verts.map(v => [v[0] - cx, v[1] - cy])
        builder.addNode({
          name: safeName,
          type: 'CollisionPolygon2D',
          parent: 'Collision',
          props: {
            polygon: formatPackedVector2Array(offsetVerts),
          },
        })
      }
    }
  }

  return builder.build()
}
