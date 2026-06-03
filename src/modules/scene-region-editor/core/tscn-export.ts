import type { SceneRegion, SceneRegionData } from './types'
import { isRectRegion } from './types'

interface SubResource {
  id: string
  type: string
  props: Record<string, string>
}

function rectCenter(verts: [number, number][]): { x: number; y: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of verts) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
}

function rectSize(verts: [number, number][]): { w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of verts) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { w: maxX - minX, h: maxY - minY }
}

function formatPolygon(verts: [number, number][]): string {
  return 'PackedVector2Array(' + verts.map(([x, y]) => `${x}, ${y}`).join(', ') + ')'
}

function escapeNodeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_')
}

export function generateTscn(data: SceneRegionData): string {
  const occludeRegions = data.regions.filter(r => r.type === 'occlude')
  const collisionRegions = data.regions.filter(r => r.type === 'collision')

  const subResources: SubResource[] = []
  let subResCounter = 0

  const rectSubResMap = new Map<string, string>()

  function getOrCreateRectSubRes(region: SceneRegion): string {
    const existing = rectSubResMap.get(region.id)
    if (existing) return existing
    subResCounter++
    const id = `RectangleShape2D_${subResCounter}`
    const size = rectSize(region.vertices)
    subResources.push({
      id,
      type: 'RectangleShape2D',
      props: { size: `Vector2(${size.w}, ${size.h})` },
    })
    rectSubResMap.set(region.id, id)
    return id
  }

  for (const r of occludeRegions) {
    if (isRectRegion(r.vertices)) getOrCreateRectSubRes(r)
  }
  for (const r of collisionRegions) {
    if (isRectRegion(r.vertices)) getOrCreateRectSubRes(r)
  }

  const loadSteps = subResources.length + 1
  const lines: string[] = []

  lines.push(`[gd_scene load_steps=${loadSteps} format=3]`)
  lines.push('')

  for (const sr of subResources) {
    lines.push(`[sub_resource type="${sr.type}" id="${sr.id}"]`)
    for (const [k, v] of Object.entries(sr.props)) {
      lines.push(`${k} = ${v}`)
    }
    lines.push('')
  }

  lines.push('[node name="SceneRegions" type="Node2D"]')
  lines.push('')

  if (occludeRegions.length > 0) {
    lines.push('[node name="Obstacles" type="Node2D" parent="."]')
    lines.push('')

    for (const r of occludeRegions) {
      const safeName = escapeNodeName(r.name)
      const groupsStr = r.groups.length > 0
        ? ` groups=[${r.groups.map(g => `"${g}"`).join(', ')}]`
        : ''
      lines.push(`[node name="${safeName}" type="Area2D" parent="Obstacles"${groupsStr}]`)
      lines.push('')

      if (isRectRegion(r.vertices)) {
        const subResId = rectSubResMap.get(r.id)!
        const center = rectCenter(r.vertices)
        lines.push(`[node name="CollisionShape2D" type="CollisionShape2D" parent="Obstacles/${safeName}"]`)
        lines.push(`shape = SubResource("${subResId}")`)
        lines.push(`position = Vector2(${center.x}, ${center.y})`)
      } else {
        lines.push(`[node name="CollisionPolygon2D" type="CollisionPolygon2D" parent="Obstacles/${safeName}"]`)
        lines.push(`polygon = ${formatPolygon(r.vertices)}`)
      }
      lines.push('')
    }
  }

  if (collisionRegions.length > 0) {
    lines.push('[node name="Collision" type="StaticBody2D" parent="."]')
    lines.push('')

    for (const r of collisionRegions) {
      const safeName = escapeNodeName(r.name)
      if (isRectRegion(r.vertices)) {
        const subResId = rectSubResMap.get(r.id)!
        const center = rectCenter(r.vertices)
        lines.push(`[node name="${safeName}" type="CollisionShape2D" parent="Collision"]`)
        lines.push(`shape = SubResource("${subResId}")`)
        lines.push(`position = Vector2(${center.x}, ${center.y})`)
      } else {
        lines.push(`[node name="${safeName}" type="CollisionPolygon2D" parent="Collision"]`)
        lines.push(`polygon = ${formatPolygon(r.vertices)}`)
      }
      lines.push('')
    }
  }

  return lines.join('\n')
}
