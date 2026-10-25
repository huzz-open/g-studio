import { buildUmbrella, type ProxyMesh, type UmbrellaShape } from './geometry'
import { add, camera, dot, lookAt, multiply, normalize, perspective, sub, transform, type CameraSettings, type Mat4, type Vec3 } from './math'

export interface DemoFrame { light: Vec3; camera: CameraSettings; wireframe: boolean; shadowsOnly: boolean; filtered: boolean }
const FAR = 24, MAP_SIZE = 1024
const DIRECTIONS: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
const UPS: Vec3[] = [[0, -1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], [0, -1, 0]]

export function createUmbrellaRenderer(canvas: HTMLCanvasElement, initialShape: UmbrellaShape) {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false })
  if (!gl) throw new Error('WebGL is unavailable')
  const shaders: WebGLShader[] = [], programs: WebGLProgram[] = [], buffers: WebGLBuffer[] = []
  function program(vertex: string, fragment: string) {
    const result = gl!.createProgram()!; programs.push(result)
    for (const [type, source] of [[gl!.VERTEX_SHADER, vertex], [gl!.FRAGMENT_SHADER, fragment]] as const) {
      const shader = gl!.createShader(type)!; shaders.push(shader)
      gl!.shaderSource(shader, source); gl!.compileShader(shader)
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) throw new Error(gl!.getShaderInfoLog(shader) || 'Shader compilation failed')
      gl!.attachShader(result, shader)
    }
    gl!.linkProgram(result)
    if (!gl!.getProgramParameter(result, gl!.LINK_STATUS)) throw new Error(gl!.getProgramInfoLog(result) || 'Shader linking failed')
    return result
  }
  const depthProgram = program(`
    attribute vec3 position; uniform mat4 matrix; varying vec3 world;
    void main() { world = position; gl_Position = matrix * vec4(position, 1.0); }
  `, `
    precision highp float; varying vec3 world; uniform vec3 light; uniform float farPlane;
    void main() {
      float depth = min(length(world - light) / farPlane, 0.999999);
      vec4 encoded = fract(depth * vec4(1.0, 255.0, 65025.0, 16581375.0));
      encoded -= encoded.yzww * vec4(1.0/255.0, 1.0/255.0, 1.0/255.0, 0.0);
      gl_FragColor = encoded;
    }
  `)
  const surfaceProgram = program(`
    attribute vec3 position; attribute vec3 normal; attribute vec3 albedo;
    uniform mat4 matrix; varying vec3 world; varying vec3 surfaceNormal; varying vec3 surfaceColor;
    void main() { world = position; surfaceNormal = normal; surfaceColor = albedo; gl_Position = matrix * vec4(position, 1.0); }
  `, `
    precision highp float;
    varying vec3 world; varying vec3 surfaceNormal; varying vec3 surfaceColor;
    uniform vec3 light; uniform samplerCube shadowMap; uniform float farPlane; uniform float filtered; uniform float shadowsOnly;
    float depthAt(vec3 direction) {
      return dot(textureCube(shadowMap, direction), vec4(1.0, 1.0/255.0, 1.0/65025.0, 1.0/16581375.0)) * farPlane;
    }
    void main() {
      vec3 toLight = light - world;
      float distance = length(toLight);
      vec3 n = normalize(surfaceNormal), l = normalize(toLight), direction = -l;
      float diffuse = max(dot(n, l), 0.0);
      float cosine = max(diffuse, 0.1);
      float slope = sqrt(max(0.0, 1.0 - cosine * cosine)) / cosine;
      float bias = max(0.003, distance * (2.0 / 1024.0) * (filtered > 0.5 ? 2.5 : 1.0) * slope + 0.001);
      float visibility = distance - bias <= depthAt(direction) ? 1.0 : 0.0;
      if (filtered > 0.5) {
        vec3 helper = abs(direction.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 u = normalize(cross(direction, helper)), v = cross(direction, u);
        visibility = 0.0;
        for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) {
          vec3 sampleDirection = direction + (u * float(a) + v * float(b)) * (2.0 / 1024.0);
          visibility += distance - bias <= depthAt(sampleDirection) ? 1.0 / 9.0 : 0.0;
        }
      }
      if (shadowsOnly > 0.5) { gl_FragColor = vec4(vec3(mix(0.12, 0.72, visibility)), 1.0); return; }
      vec3 base = surfaceColor;
      if (abs(world.y) < 0.001) {
        vec2 gridDistance = abs(fract(world.xz + 0.5) - 0.5);
        float grid = 1.0 - step(0.008, min(gridDistance.x, gridDistance.y));
        base *= mix(1.0, 1.2, grid);
      }
      vec3 linearColor = base * (0.22 + 14.0 * diffuse * visibility / max(distance * distance, 0.1));
      gl_FragColor = vec4(pow(clamp(linearColor, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
    }
  `)
  const lineProgram = program(`
    attribute vec3 position; uniform mat4 matrix; uniform float pointSize;
    void main() { gl_Position = matrix * vec4(position, 1.0); gl_PointSize = pointSize; }
  `, `precision highp float; uniform vec3 color; void main() { gl_FragColor = vec4(color, 1.0); }`)
  const uniform = (p: WebGLProgram, name: string) => gl.getUniformLocation(p, name)
  function buffer() { const b = gl!.createBuffer()!; buffers.push(b); return b }
  const meshBuffer = buffer(), wireBuffer = buffer(), lightBuffer = buffer()
  let mesh: ProxyMesh = buildUmbrella(initialShape), shadowDirty = true
  function uploadMesh() {
    gl!.bindBuffer(gl!.ARRAY_BUFFER, meshBuffer); gl!.bufferData(gl!.ARRAY_BUFFER, mesh.vertices, gl!.STATIC_DRAW)
    gl!.bindBuffer(gl!.ARRAY_BUFFER, wireBuffer); gl!.bufferData(gl!.ARRAY_BUFFER, mesh.wires, gl!.STATIC_DRAW)
    shadowDirty = true
  }
  uploadMesh()
  const cube = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, cube)
  for (let i = 0; i < 6; i++) gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, gl.RGBA, MAP_SIZE, MAP_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const framebuffer = gl.createFramebuffer()!, depth = gl.createRenderbuffer()!
  gl.bindRenderbuffer(gl.RENDERBUFFER, depth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, MAP_SIZE, MAP_SIZE)
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth)
  const lightProjection = perspective(Math.PI / 2, 1, 0.03, FAR)
  let lightMatrices: Mat4[] = [], lastLight: Vec3 | undefined, lastFrame: DemoFrame | undefined
  function attribute(p: WebGLProgram, name: string, size: number, stride: number, offset: number) {
    const location = gl!.getAttribLocation(p, name)
    gl!.enableVertexAttribArray(location); gl!.vertexAttribPointer(location, size, gl!.FLOAT, false, stride, offset)
  }
  function bindMesh(p: WebGLProgram, color = false) {
    for (let i = 0; i < 3; i++) gl!.disableVertexAttribArray(i)
    gl!.bindBuffer(gl!.ARRAY_BUFFER, meshBuffer); attribute(p, 'position', 3, 36, 0)
    if (color) { attribute(p, 'normal', 3, 36, 12); attribute(p, 'albedo', 3, 36, 24) }
  }
  function updateShadow(light: Vec3) {
    if (!shadowDirty && lastLight?.every((value, i) => value === light[i])) return
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, framebuffer); gl!.viewport(0, 0, MAP_SIZE, MAP_SIZE)
    gl!.enable(gl!.DEPTH_TEST); gl!.depthFunc(gl!.LESS); gl!.disable(gl!.CULL_FACE); gl!.disable(gl!.BLEND); gl!.disable(gl!.DITHER); gl!.disable(gl!.POLYGON_OFFSET_FILL)
    gl!.useProgram(depthProgram); bindMesh(depthProgram)
    gl!.uniform3fv(uniform(depthProgram, 'light'), light); gl!.uniform1f(uniform(depthProgram, 'farPlane'), FAR)
    lightMatrices = DIRECTIONS.map((direction, i) => multiply(lightProjection, lookAt(light, add(light, direction), UPS[i])))
    for (let face = 0; face < 6; face++) {
      gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_CUBE_MAP_POSITIVE_X + face, cube, 0)
      if (gl!.checkFramebufferStatus(gl!.FRAMEBUFFER) !== gl!.FRAMEBUFFER_COMPLETE) throw new Error('Shadow map framebuffer is unavailable')
      gl!.clearColor(1, 1, 1, 1); gl!.clearDepth(1); gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT)
      gl!.uniformMatrix4fv(uniform(depthProgram, 'matrix'), false, lightMatrices[face])
      gl!.drawArrays(gl!.TRIANGLES, mesh.groundVertices, mesh.vertices.length / 9 - mesh.groundVertices)
    }
    shadowDirty = false; lastLight = [...light]
  }
  function render(frame: DemoFrame) {
    lastFrame = frame
    const rect = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.max(1, Math.round(rect.width * dpr)), height = Math.max(1, Math.round(rect.height * dpr))
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
    updateShadow(frame.light)
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null); gl!.viewport(0, 0, width, height)
    gl!.enable(gl!.DITHER)
    gl!.clearColor(0.075, 0.085, 0.1, 1); gl!.clearDepth(1); gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT)
    gl!.enable(gl!.DEPTH_TEST); gl!.depthFunc(gl!.LESS)
    const view = camera(frame.camera, width / height)
    gl!.useProgram(surfaceProgram); bindMesh(surfaceProgram, true)
    gl!.uniformMatrix4fv(uniform(surfaceProgram, 'matrix'), false, view.matrix)
    gl!.uniform3fv(uniform(surfaceProgram, 'light'), frame.light)
    gl!.uniform1f(uniform(surfaceProgram, 'farPlane'), FAR)
    gl!.uniform1f(uniform(surfaceProgram, 'filtered'), frame.filtered ? 1 : 0)
    gl!.uniform1f(uniform(surfaceProgram, 'shadowsOnly'), frame.shadowsOnly ? 1 : 0)
    gl!.activeTexture(gl!.TEXTURE0); gl!.bindTexture(gl!.TEXTURE_CUBE_MAP, cube); gl!.uniform1i(uniform(surfaceProgram, 'shadowMap'), 0)
    if (frame.wireframe) { gl!.enable(gl!.POLYGON_OFFSET_FILL); gl!.polygonOffset(1, 1) }
    gl!.drawArrays(gl!.TRIANGLES, 0, frame.shadowsOnly ? mesh.groundVertices : mesh.vertices.length / 9)
    gl!.disable(gl!.POLYGON_OFFSET_FILL)
    gl!.useProgram(lineProgram)
    for (let i = 0; i < 3; i++) gl!.disableVertexAttribArray(i)
    gl!.uniformMatrix4fv(uniform(lineProgram, 'matrix'), false, view.matrix)
    gl!.uniform1f(uniform(lineProgram, 'pointSize'), 9 * dpr)
    if (frame.wireframe && !frame.shadowsOnly) {
      gl!.bindBuffer(gl!.ARRAY_BUFFER, wireBuffer); attribute(lineProgram, 'position', 3, 0, 0)
      gl!.uniform3f(uniform(lineProgram, 'color'), 0.13, 0.09, 0.045); gl!.drawArrays(gl!.LINES, 0, mesh.wires.length / 3)
    }
    gl!.bindBuffer(gl!.ARRAY_BUFFER, lightBuffer)
    gl!.bufferData(gl!.ARRAY_BUFFER, new Float32Array([frame.light[0], 0.015, frame.light[2], ...frame.light]), gl!.DYNAMIC_DRAW)
    attribute(lineProgram, 'position', 3, 0, 0)
    gl!.uniform3f(uniform(lineProgram, 'color'), 0.7, 0.59, 0.32); gl!.drawArrays(gl!.LINES, 0, 2)
    gl!.uniform3f(uniform(lineProgram, 'color'), 1, 0.86, 0.44); gl!.drawArrays(gl!.POINTS, 0, 2)
  }
  return {
    render,
    setShape(shape: UmbrellaShape) { mesh = buildUmbrella(shape); uploadMesh() },
    /** Diagnostic samples use the rendered cubemap, independently compared with CPU ray/triangle intersections in tests. */
    probeShadow(points: Vec3[], normals?: Vec3[]) {
      if (!lastFrame) throw new Error('Render a frame first')
      const light = lastFrame.light; updateShadow(light)
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      const samples = points.map((point, index) => {
        const delta = sub(point, light), distance = Math.hypot(...delta)
        const axis = Math.abs(delta[0]) >= Math.abs(delta[1]) && Math.abs(delta[0]) >= Math.abs(delta[2]) ? 0 : Math.abs(delta[1]) >= Math.abs(delta[2]) ? 1 : 2
        const face = axis * 2 + (delta[axis] < 0 ? 1 : 0), clip = transform(lightMatrices[face], point)
        const x = Math.min(MAP_SIZE - 1, Math.max(0, Math.floor((clip[0] / clip[3] * 0.5 + 0.5) * MAP_SIZE)))
        const y = Math.min(MAP_SIZE - 1, Math.max(0, Math.floor((clip[1] / clip[3] * 0.5 + 0.5) * MAP_SIZE)))
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, cube, 0)
        const pixel = new Uint8Array(4); gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
        const stored = (pixel[0] / 255 + pixel[1] / 65025 + pixel[2] / 16581375 + pixel[3] / 4228250625) * FAR
        const cosine = Math.max(0.1, dot(normals?.[index] ?? [0, 1, 0], normalize(sub(light, point))))
        const slope = Math.sqrt(Math.max(0, 1 - cosine * cosine)) / cosine
        const bias = Math.max(0.003, distance * (2 / MAP_SIZE) * (lastFrame!.filtered ? 2.5 : 1) * slope + 0.001)
        return { point, shadow: distance - bias > stored, stored, distance }
      })
      render(lastFrame)
      return samples
    },
    dispose() {
      gl.deleteFramebuffer(framebuffer); gl.deleteRenderbuffer(depth); gl.deleteTexture(cube)
      buffers.forEach(b => gl.deleteBuffer(b)); programs.forEach(p => gl.deleteProgram(p)); shaders.forEach(s => gl.deleteShader(s))
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
