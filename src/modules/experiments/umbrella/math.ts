export type Vec3 = [number, number, number]
export type Mat4 = Float32Array
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s]
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const normalize = (v: Vec3): Vec3 => scale(v, 1 / (Math.hypot(...v) || 1))

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16)
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
    for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k]
  }
  return out
}
export function transform(m: Mat4, p: Vec3) {
  return [0, 1, 2, 3].map(row => m[row] * p[0] + m[4 + row] * p[1] + m[8 + row] * p[2] + m[12 + row])
}
export function lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const z = normalize(sub(eye, target)), x = normalize(cross(up, z)), y = cross(z, x)
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1])
}
export function perspective(fov: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fov / 2)
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0])
}
export function orthographic(halfHeight: number, aspect: number, near: number, far: number): Mat4 {
  return new Float32Array([1 / (halfHeight * aspect), 0, 0, 0, 0, 1 / halfHeight, 0, 0, 0, 0, -2 / (far - near), 0, 0, 0, -(far + near) / (far - near), 1])
}

export interface CameraSettings { yaw: number; pitch: number; distance: number; projection: 'orthographic' | 'perspective' }
export function camera(settings: CameraSettings, aspect: number) {
  const yaw = settings.yaw * Math.PI / 180, pitch = settings.pitch * Math.PI / 180
  const target: Vec3 = [0, 1.15, 0]
  const eye = add(target, scale([Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)], settings.distance))
  const forward = normalize(sub(target, eye)), right = normalize(cross(forward, [0, 1, 0])), up = cross(right, forward)
  const half = settings.distance * 0.4, fov = 45 * Math.PI / 180
  const projection = settings.projection === 'perspective' ? perspective(fov, aspect, 0.05, 40) : orthographic(half, aspect, 0.05, 40)
  const matrix = multiply(projection, lookAt(eye, target, [0, 1, 0]))
  return {
    matrix, eye,
    pickGround(nx: number, ny: number): Vec3 | null {
      const origin = settings.projection === 'perspective' ? eye : add(eye, add(scale(right, nx * half * aspect), scale(up, ny * half)))
      const direction = settings.projection === 'perspective' ? normalize(add(forward, add(scale(right, nx * Math.tan(fov / 2) * aspect), scale(up, ny * Math.tan(fov / 2))))) : forward
      const t = -origin[1] / direction[1]
      return Number.isFinite(t) && t > 0 ? add(origin, scale(direction, t)) : null
    },
  }
}
