import { reactive } from 'vue'
import { previewLight } from './lighting'
import { casterHeight, lightElevation, SHADOW_ALPHA_CUTOFF, type ShadowGeometry } from './shadow-geometry'

export const DEFAULT_SHADOW_PREVIEW = Object.freeze({ enabled: false })
export const previewShadow = reactive({ ...DEFAULT_SHADOW_PREVIEW })
export interface ShadowView { width: number; height: number; scale: number; panX: number; panY: number }

/** Project the closed alpha extrusion onto z=0. Its projected caps and walls form
 * a binary visibility mask (union, never additive alpha). Shade a separate ground
 * receiver using the SAME point light and elevation as the sprite renderer.
 */
export function createGroundShadow(canvas: HTMLCanvasElement, image: ImageData, geometry: ShadowGeometry) {
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false })
  if (!gl) throw new Error('WebGL is unavailable')
  const shaders: WebGLShader[] = [], programs: WebGLProgram[] = [], buffers: WebGLBuffer[] = [], textures: WebGLTexture[] = []
  function program(vertex: string, fragment: string) {
    const p = gl!.createProgram()!; programs.push(p)
    for (const [type, source] of [[gl!.VERTEX_SHADER, vertex], [gl!.FRAGMENT_SHADER, fragment]] as const) {
      const shader = gl!.createShader(type)!; shaders.push(shader)
      gl!.shaderSource(shader, source); gl!.compileShader(shader)
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) throw new Error(gl!.getShaderInfoLog(shader) || 'Shadow shader failed')
      gl!.attachShader(p, shader)
    }
    gl!.linkProgram(p)
    if (!gl!.getProgramParameter(p, gl!.LINK_STATUS)) throw new Error(gl!.getProgramInfoLog(p) || 'Shadow shader link failed')
    return p
  }
  const maskProgram = program(`
    attribute vec3 point;
    uniform vec2 origin; uniform vec2 extent; uniform vec2 imageSize;
    uniform vec3 light; uniform float capHeight; uniform float capW;
    varying vec2 uv;
    void main() {
      float z = point.z * capHeight;
      float w = mix(light.z, capW, point.z);
      vec2 projected = light.z * point.xy - z * light.xy;
      vec2 local = projected - origin * w;
      gl_Position = vec4(2.0 * local.x / extent.x - w, w - 2.0 * local.y / extent.y, 0.0, w);
      uv = point.xy / imageSize;
    }
  `, `
    precision highp float;
    uniform sampler2D source; uniform float masked; uniform float cutoff;
    varying vec2 uv;
    void main() {
      if (masked > 0.5 && texture2D(source, uv).a < cutoff) discard;
      gl_FragColor = vec4(1.0);
    }
  `)
  const groundProgram = program(`
    attribute vec2 point; varying vec2 uv;
    void main() { gl_Position = vec4(point, 0.0, 1.0); uv = (point + 1.0) * 0.5; }
  `, `
    precision highp float;
    uniform sampler2D shadow;
    uniform vec2 origin; uniform vec2 extent; uniform vec3 light; uniform vec3 tint;
    uniform float brightness; uniform float ambient;
    varying vec2 uv;
    void main() {
      vec2 position = origin + vec2(uv.x, 1.0 - uv.y) * extent;
      float diffuse = light.z / max(length(vec3(light.xy - position, light.z)), 0.0001);
      float visibility = 1.0 - texture2D(shadow, uv).r;
      vec3 ground = vec3(0.24) * (vec3(ambient) + tint * brightness * diffuse * visibility);
      gl_FragColor = vec4(clamp(ground, 0.0, 1.0), 1.0);
    }
  `)
  function buffer(data: Float32Array) {
    const b = gl!.createBuffer()!; buffers.push(b)
    gl!.bindBuffer(gl!.ARRAY_BUFFER, b); gl!.bufferData(gl!.ARRAY_BUFFER, data, gl!.STATIC_DRAW)
    return b
  }
  const walls = buffer(geometry.vertices)
  const cap = (z: number) => buffer(new Float32Array([0, 0, z, image.width, 0, z, 0, image.height, z, 0, image.height, z, image.width, 0, z, image.width, image.height, z]))
  const bottom = cap(0), top = cap(1)
  const quad = buffer(new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]))
  function texture() {
    const t = gl!.createTexture()!; textures.push(t); gl!.bindTexture(gl!.TEXTURE_2D, t)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.NEAREST)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.NEAREST)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE)
    return t
  }
  const source = texture()
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, image.width, image.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, image.data)
  const mask = texture(), framebuffer = gl.createFramebuffer()!
  let maskWidth = 0, maskHeight = 0
  const limit = Math.min(2048, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number)
  function vertices(p: WebGLProgram, b: WebGLBuffer, size: number) {
    gl!.bindBuffer(gl!.ARRAY_BUFFER, b)
    // Only one position attribute is used by either program.
    const location = gl!.getAttribLocation(p, 'point')
    gl!.enableVertexAttribArray(location); gl!.vertexAttribPointer(location, size, gl!.FLOAT, false, 0, 0)
  }
  return {
    draw(x: number, y: number, view: ShadowView, lightSettings = previewLight) {
      if (view.width <= 0 || view.height <= 0 || view.scale <= 0) return
      const extentX = view.width / view.scale, extentY = view.height / view.scale
      const reduction = Math.max(1, extentX / limit, extentY / limit, Math.sqrt(extentX * extentY / 2097152))
      const width = Math.min(limit, Math.max(1, Math.ceil(extentX / reduction))), height = Math.min(limit, Math.max(1, Math.ceil(extentY / reduction)))
      if (width !== maskWidth || height !== maskHeight) {
        maskWidth = width; maskHeight = height; canvas.width = width; canvas.height = height
        gl.bindTexture(gl.TEXTURE_2D, mask)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, mask, 0)
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Shadow framebuffer is unavailable')
      }
      gl.viewport(0, 0, width, height)
      const originX = -view.panX / view.scale, originY = -view.panY / view.scale
      const z = lightElevation(image.width, image.height, lightSettings.height)
      const objectHeight = casterHeight(image.width, image.height)
      let capHeight = objectHeight, capW = z - objectHeight
      if (z <= objectHeight) {
        // Bound the infinite projection by the receiver viewport, not a user-made
        // shadow length. For Q in the footprint, |Q-L| >= nearest, so a scale
        // greater than radius/nearest covers every receiver sample in this view.
        let nearest = Infinity
        const v = geometry.vertices
        for (let i = 0; i < v.length; i += 18) {
          const dx = Math.max(Math.min(v[i], v[i + 3]) - x, 0, x - Math.max(v[i], v[i + 3]))
          const dy = Math.max(Math.min(v[i + 1], v[i + 4]) - y, 0, y - Math.max(v[i + 1], v[i + 4]))
          nearest = Math.min(nearest, Math.hypot(dx, dy))
        }
        if (nearest < 1e-7) {
          // At an exact texel boundary the adjacent cell sectors are constant up
          // to the next grid line. That local radius bounds their projections
          // without using a numerically degenerate, almost-zero clip-space w.
          const gridRadius = (value: number) => {
            const fraction = value - Math.floor(value)
            return fraction < 1e-7 || 1 - fraction < 1e-7 ? 1 : Math.min(fraction, 1 - fraction)
          }
          nearest = Math.min(gridRadius(x), gridRadius(y))
        }
        const radius = Math.max(...[originX, originX + extentX].flatMap(px => [originY, originY + extentY].map(py => Math.hypot(px - x, py - y))))
        const inverseScale = 1 / (2 + radius / Math.max(nearest, 1e-7))
        capW = z * inverseScale; capHeight = z * (1 - inverseScale)
      }
      const common = (p: WebGLProgram) => {
        gl.uniform2f(gl.getUniformLocation(p, 'origin'), originX, originY)
        gl.uniform2f(gl.getUniformLocation(p, 'extent'), extentX, extentY)
        gl.uniform3f(gl.getUniformLocation(p, 'light'), x, y, z)
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      const lightPixelX = Math.floor(x), lightPixelY = Math.floor(y)
      const solid = (px: number, py: number) => px >= 0 && px < image.width && py >= 0 && py < image.height
        && image.data[(py * image.width + px) * 4 + 3] / 255 >= SHADOW_ALPHA_CUTOFF
      const onXEdge = Math.abs(x - lightPixelX) < 1e-7, onYEdge = Math.abs(y - lightPixelY) < 1e-7
      const lightInsideCaster = z <= objectHeight
        && solid(lightPixelX, lightPixelY)
        && (!onXEdge || solid(lightPixelX - 1, lightPixelY))
        && (!onYEdge || solid(lightPixelX, lightPixelY - 1))
        && (!onXEdge || !onYEdge || solid(lightPixelX - 1, lightPixelY - 1))
      // A light embedded in an opaque prism has no direct visibility to the ground.
      // Handle this analytically rather than relying on degenerate horizon polygons.
      gl.clearColor(lightInsideCaster ? 1 : 0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT)
      gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.disable(gl.DEPTH_TEST)
      gl.useProgram(maskProgram); common(maskProgram)
      gl.uniform2f(gl.getUniformLocation(maskProgram, 'imageSize'), image.width, image.height)
      gl.uniform1f(gl.getUniformLocation(maskProgram, 'capHeight'), capHeight)
      gl.uniform1f(gl.getUniformLocation(maskProgram, 'capW'), capW)
      gl.uniform1f(gl.getUniformLocation(maskProgram, 'cutoff'), SHADOW_ALPHA_CUTOFF)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, source)
      gl.uniform1i(gl.getUniformLocation(maskProgram, 'source'), 0)
      gl.uniform1f(gl.getUniformLocation(maskProgram, 'masked'), 1)
      vertices(maskProgram, bottom, 3); gl.drawArrays(gl.TRIANGLES, 0, 6)
      vertices(maskProgram, top, 3); gl.drawArrays(gl.TRIANGLES, 0, 6)
      gl.uniform1f(gl.getUniformLocation(maskProgram, 'masked'), 0)
      if (geometry.vertices.length) { vertices(maskProgram, walls, 3); gl.drawArrays(gl.TRIANGLES, 0, geometry.vertices.length / 3) }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.useProgram(groundProgram); common(groundProgram)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, mask)
      gl.uniform1i(gl.getUniformLocation(groundProgram, 'shadow'), 0)
      const hex = lightSettings.color.substring(1)
      gl.uniform3f(gl.getUniformLocation(groundProgram, 'tint'), parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255)
      gl.uniform1f(gl.getUniformLocation(groundProgram, 'brightness'), lightSettings.brightness)
      gl.uniform1f(gl.getUniformLocation(groundProgram, 'ambient'), lightSettings.ambient)
      vertices(groundProgram, quad, 2); gl.drawArrays(gl.TRIANGLES, 0, 6)
    },
    dispose(loseContext = true) {
      gl.deleteFramebuffer(framebuffer)
      buffers.forEach(b => gl.deleteBuffer(b)); textures.forEach(t => gl.deleteTexture(t))
      programs.forEach(p => gl.deleteProgram(p)); shaders.forEach(s => gl.deleteShader(s))
      if (loseContext) gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
