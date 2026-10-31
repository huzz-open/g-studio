import { cross, normalize, sub, type Vec3 } from './math'
export interface UmbrellaShape { radius: number; rimHeight: number; rise: number }
export const DEFAULT_SHAPE: UmbrellaShape = { radius: 1.2, rimHeight: 2.1, rise: 0.5 }
export interface ProxyMesh { vertices: Float32Array; wires: Float32Array; casterTriangles: Vec3[][]; groundVertices: number }

export function buildUmbrella(shape: UmbrellaShape): ProxyMesh {
  const vertices: number[] = [], wires: number[] = [], casterTriangles: Vec3[][] = []
  function triangle(a: Vec3, b: Vec3, c: Vec3, color: Vec3, caster = true) {
    const normal = normalize(cross(sub(b, a), sub(c, a)))
    const linear = color.map(v => Math.pow(v, 2.2))
    for (const p of [a, b, c]) vertices.push(...p, ...normal, ...linear)
    if (caster) {
      casterTriangles.push([a, b, c])
      for (const p of [a, b, b, c, c, a]) wires.push(...p)
    }
  }
  function quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: Vec3, caster = true) {
    triangle(a, b, c, color, caster); triangle(a, c, d, color, caster)
  }
  quad([-5, 0, -5], [-5, 0, 5], [5, 0, 5], [5, 0, -5], [0.4, 0.42, 0.43], false)
  const groundVertices = vertices.length / 9
  const sectors = 48, top = shape.rimHeight + shape.rise, thickness = 0.025
  const rim = (i: number, y: number): Vec3 => [shape.radius * Math.cos(i * 2 * Math.PI / sectors), y, shape.radius * Math.sin(i * 2 * Math.PI / sectors)]
  for (let i = 0; i < sectors; i++) {
    const color: Vec3 = i % 3 === 0 ? [0.68, 0.47, 0.23] : [0.76, 0.56, 0.29]
    triangle([0, top, 0], rim(i + 1, shape.rimHeight), rim(i, shape.rimHeight), color)
    triangle([0, top - thickness, 0], rim(i, shape.rimHeight - thickness), rim(i + 1, shape.rimHeight - thickness), [0.42, 0.28, 0.13])
    quad(rim(i, shape.rimHeight), rim(i + 1, shape.rimHeight), rim(i + 1, shape.rimHeight - thickness), rim(i, shape.rimHeight - thickness), [0.38, 0.24, 0.12])
  }
  function cylinder(radius: number, bottom: number, upper: number, color: Vec3) {
    const count = 16
    const ring = (i: number, y: number): Vec3 => [radius * Math.cos(i * 2 * Math.PI / count), y, radius * Math.sin(i * 2 * Math.PI / count)]
    for (let i = 0; i < count; i++) {
      quad(ring(i, bottom), ring(i, upper), ring(i + 1, upper), ring(i + 1, bottom), color)
      triangle([0, upper, 0], ring(i + 1, upper), ring(i, upper), color)
      triangle([0, bottom, 0], ring(i, bottom), ring(i + 1, bottom), color)
    }
  }
  cylinder(0.035, 0, top + 0.14, [0.47, 0.3, 0.14])
  cylinder(0.075, top - 0.01, top + 0.035, [0.54, 0.36, 0.16])
  return { vertices: new Float32Array(vertices), wires: new Float32Array(wires), casterTriangles, groundVertices }
}
