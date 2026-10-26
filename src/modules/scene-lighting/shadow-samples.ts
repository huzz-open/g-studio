import { roomBounds, type Mesh, type SceneState } from './model'

/** Position + normal for each triangle centroid, in the asset's local space. */
export function meshShadowSamples(mesh: Mesh): Float32Array {
  const points: number[] = [], m = mesh.vertices
  for (let v = 0; v < m.length; v += 27) {
    for (let axis = 0; axis < 3; axis++) points.push((m[v + axis] + m[v + 9 + axis] + m[v + 18 + axis]) / 3)
    points.push(m[v + 3], m[v + 4], m[v + 5])
  }
  return new Float32Array(points)
}

/** Room samples use a regular grid; its large triangles alone are too sparse. */
export function roomShadowSamples(state: SceneState): Float32Array {
  const points: number[] = [], b = roomBounds(state.room)
  for (let x = b.minX + .25; x < b.maxX; x += .5)
    for (let z = b.minZ + .25; z < b.maxZ; z += .5) points.push(x, 0, z, 0, 1, 0)
  if (state.scene === 'corner') for (let y = .2; y < b.height; y += .35) {
    for (let x = b.minX + .2; x < b.maxX; x += .35) points.push(x, y, b.minZ, 0, 0, 1)
    for (let z = b.minZ + .2; z < b.maxZ; z += .35) points.push(b.minX, y, z, 1, 0, 0)
  }
  return new Float32Array(points)
}
