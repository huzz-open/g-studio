import { directionalShadowCamera, sunDirection } from './lighting-math'
import { add, dot, lookAt, multiply, normalize, perspective, sub, transform, type Mat4, type Vec3 } from '../experiments/umbrella/math'
import { buildRoom, FORWARD, RIGHT, roomBounds, UP, type Mesh, type SceneState, type SpriteBounds } from './model'
import { sceneCamera } from './scene-camera'
export { sceneCamera } from './scene-camera'
import { buildPartGeometry, alignedBounds, activeRepair } from './part-geometry'
import { clonePart, partRenderKey, partSurfaceKey, type PartAsset } from '../../shared/parts/schema'
import { partPixels, normalImageUrl, loadImage } from '../../shared/parts/images'
import { depthFragment, fieldFragment, fieldVertex, meshVertex, spriteFragment, spriteVertex, surfaceFragment, shadowPointVertex, shadowPointFragment } from './shaders'
import { meshShadowSamples, roomShadowSamples } from './shadow-samples'

const FAR = 64, MAP_SIZE = 1024
const DIRECTIONS: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
const UPS: Vec3[] = [[0, -1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], [0, -1, 0]]
interface GpuPoints { vao: WebGLVertexArrayObject; buffer: WebGLBuffer; count: number }
interface GpuMesh extends GpuPoints { mesh: Mesh; points?: GpuPoints }
interface SpriteAsset extends GpuMesh {
  id: string; key: string; surfaceKey: string; directx: boolean; bounds: SpriteBounds; color: WebGLTexture; normal: WebGLTexture
  depth: WebGLTexture; surface: WebGLTexture; alpha: Uint8ClampedArray; width: number; height: number
  field: Uint8Array; coverage: number
}
export interface ReceiverReport { ground: number; walls: number; objects: { id: string; shadows: number }[]; samples: number }

export function createSceneRenderer(canvas: HTMLCanvasElement, { selectionOutline = true } = {}) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: true })
  if (!gl) throw new Error('WebGL 2 is required for scene lighting.')
  const shaders: WebGLShader[] = [], programs: WebGLProgram[] = [], buffers: WebGLBuffer[] = [], textures: WebGLTexture[] = [], vaos: WebGLVertexArrayObject[] = []
  let disposed = false
  function program(vertex: string, fragment: string) {
    const p = gl!.createProgram()!; programs.push(p)
    for (const [type, source] of [[gl!.VERTEX_SHADER, vertex], [gl!.FRAGMENT_SHADER, fragment]] as const) {
      const shader = gl!.createShader(type)!; shaders.push(shader); gl!.shaderSource(shader, source); gl!.compileShader(shader)
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) throw new Error(gl!.getShaderInfoLog(shader) || 'Shader compilation failed')
      gl!.attachShader(p, shader)
    }
    gl!.linkProgram(p)
    if (!gl!.getProgramParameter(p, gl!.LINK_STATUS)) throw new Error(gl!.getProgramInfoLog(p) || 'Shader linking failed')
    return p
  }
  const depthProgram = program(meshVertex, depthFragment), surfaceProgram = program(meshVertex, surfaceFragment)
  const fieldProgram = program(fieldVertex, fieldFragment), spriteProgram = program(spriteVertex, spriteFragment)
  const pointProgram = program(shadowPointVertex, shadowPointFragment)
  const uniformCache = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>()
  function u(p: WebGLProgram, name: string) {
    if (!uniformCache.has(p)) uniformCache.set(p, new Map())
    const entries = uniformCache.get(p)!
    if (!entries.has(name)) entries.set(name, gl!.getUniformLocation(p, name))
    return entries.get(name)!
  }
  function buffer(data: Float32Array) {
    const b = gl!.createBuffer()!; buffers.push(b); gl!.bindBuffer(gl!.ARRAY_BUFFER, b); gl!.bufferData(gl!.ARRAY_BUFFER, data, gl!.STATIC_DRAW)
    return b
  }
  function meshBuffer(mesh: Mesh): GpuMesh {
    const vao = gl!.createVertexArray()!; vaos.push(vao); gl!.bindVertexArray(vao); const vertexBuffer = buffer(mesh.vertices)
    for (let i = 0; i < 3; i++) { gl!.enableVertexAttribArray(i); gl!.vertexAttribPointer(i, 3, gl!.FLOAT, false, 36, i * 12) }
    return { mesh, vao, buffer: vertexBuffer, count: mesh.vertices.length / 9 }
  }
  function pointBuffer(data: Float32Array): GpuPoints {
    const vao = gl!.createVertexArray()!; vaos.push(vao); gl!.bindVertexArray(vao)
    const vertexBuffer = buffer(data)
    for (let i = 0; i < 2; i++) { gl!.enableVertexAttribArray(i); gl!.vertexAttribPointer(i, 3, gl!.FLOAT, false, 24, i * 12) }
    return { vao, buffer: vertexBuffer, count: data.length / 6 }
  }
  function releaseGeometry(mesh: GpuMesh) {
    for (const geometry of [mesh, ...(mesh.points ? [mesh.points] : [])]) {
      gl!.deleteBuffer(geometry.buffer); buffers.splice(buffers.indexOf(geometry.buffer), 1)
      gl!.deleteVertexArray(geometry.vao); vaos.splice(vaos.indexOf(geometry.vao), 1)
    }
  }
  let room:GpuMesh|undefined, roomKey=''
  function updateRoom(state:SceneState){
    const key=JSON.stringify([state.scene,state.room]);if(key===roomKey)return
    const next=meshBuffer(buildRoom(state.scene,state.room))
    if(room)releaseGeometry(room)
    room=next;roomKey=key;shadowKey=''
  }
  const quadVao = gl.createVertexArray()!; vaos.push(quadVao); gl.bindVertexArray(quadVao)
  buffer(new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1])); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  function texture(width: number, height: number, image?: HTMLImageElement) {
    const t = gl!.createTexture()!; textures.push(t); gl!.bindTexture(gl!.TEXTURE_2D, t)
    gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL, !!image)
    if (image) gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, image)
    else gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, width, height, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.NEAREST); gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.NEAREST)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE); gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE)
    return t
  }
  const sunMap=texture(MAP_SIZE,MAP_SIZE)
  const cube = gl.createTexture()!; textures.push(cube); gl.bindTexture(gl.TEXTURE_CUBE_MAP, cube)
  for (let i = 0; i < 6; i++) gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, gl.RGBA, MAP_SIZE, MAP_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  for (const key of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_CUBE_MAP, key, gl.NEAREST)
  for (const key of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_CUBE_MAP, key, gl.CLAMP_TO_EDGE)
  const shadowFbo = gl.createFramebuffer()!, shadowDepth = gl.createRenderbuffer()!
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo); gl.bindRenderbuffer(gl.RENDERBUFFER, shadowDepth)
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, MAP_SIZE, MAP_SIZE)
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, shadowDepth)
  const fieldFbo = gl.createFramebuffer()!, fieldDepth = gl.createRenderbuffer()!
  const assets = new Map<string, SpriteAsset>()
  const lightProjection = perspective(Math.PI / 2, 1, .03, FAR)
  let sunMatrix:Mat4=new Float32Array(16)
  let lightMatrices: Mat4[] = [], shadowKey = '', lastState: SceneState | undefined, lastShowShadowPoints = false
  function status() { if (gl!.checkFramebufferStatus(gl!.FRAMEBUFFER) !== gl!.FRAMEBUFFER_COMPLETE) throw new Error('Lighting framebuffer is unavailable') }
  function basis(p: WebGLProgram, bounds: SpriteBounds) {
    gl!.uniform3fv(u(p, 'right'), RIGHT); gl!.uniform3fv(u(p, 'up'), UP); gl!.uniform3fv(u(p, 'forward'), FORWARD)
    gl!.uniform4f(u(p, 'bounds'), bounds.left, bounds.bottom, bounds.width, bounds.height)
  }
  function bakeField(asset: SpriteAsset) {
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, fieldFbo); gl!.bindRenderbuffer(gl!.RENDERBUFFER, fieldDepth)
    gl!.renderbufferStorage(gl!.RENDERBUFFER, gl!.DEPTH_COMPONENT24, asset.width, asset.height)
    gl!.framebufferRenderbuffer(gl!.FRAMEBUFFER, gl!.DEPTH_ATTACHMENT, gl!.RENDERBUFFER, fieldDepth)
    gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, asset.depth, 0)
    gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT1, gl!.TEXTURE_2D, asset.surface, 0)
    gl!.drawBuffers([gl!.COLOR_ATTACHMENT0, gl!.COLOR_ATTACHMENT1]); status()
    gl!.viewport(0, 0, asset.width, asset.height); gl!.enable(gl!.DEPTH_TEST); gl!.depthFunc(gl!.LESS)
    gl!.disable(gl!.BLEND); gl!.disable(gl!.CULL_FACE); gl!.disable(gl!.DITHER)
    gl!.clearColor(0, 0, 0, 0); gl!.clearDepth(1); gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT)
    gl!.useProgram(fieldProgram); basis(fieldProgram, asset.bounds); gl!.bindVertexArray(asset.vao)
    gl!.drawArrays(gl!.TRIANGLES, 0, asset.count)
    gl!.readBuffer(gl!.COLOR_ATTACHMENT0); gl!.readPixels(0, 0, asset.width, asset.height, gl!.RGBA, gl!.UNSIGNED_BYTE, asset.field)
    let covered = 0, opaque = 0
    for (let y = 0; y < asset.height; y++) for (let x = 0; x < asset.width; x++) {
      if (asset.alpha[(y * asset.width + x) * 4 + 3] < 21) continue
      opaque++; if (asset.field[((asset.height - 1 - y) * asset.width + x) * 4 + 3]) covered++
    }
    asset.coverage = covered / Math.max(1, opaque)
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null)
  }
  function releaseAsset(asset: SpriteAsset) {
    releaseGeometry(asset)
    for (const tex of [asset.color, asset.normal, asset.depth, asset.surface]) { gl!.deleteTexture(tex); textures.splice(textures.indexOf(tex), 1) }
  }
  let syncEpoch = 0, geometryController:AbortController|undefined
  async function syncAssets(parts: PartAsset[], isCurrent: () => boolean = () => true): Promise<boolean> {
    geometryController?.abort();const controller=new AbortController();geometryController=controller
    const epoch = ++syncEpoch, snapshots = parts.map(clonePart), ids = new Set(parts.map(p => p.id))
    const staged = new Map<string, SpriteAsset>()
    const normalUpdates = new Map<string, { normal: WebGLTexture; key: string; directx: boolean }>()
    const current = () => !disposed && epoch === syncEpoch && isCurrent()
    try {
      for (const part of snapshots) {
        if (!current()) return false
        const key = partRenderKey(part), existing = assets.get(part.id)
        if (existing?.key === key) continue
        const surfaceKey = partSurfaceKey(part)
        if (existing?.surfaceKey === surfaceKey) {
          const image = await loadImage(await normalImageUrl(part))
          if (!current()) return false
          normalUpdates.set(part.id, { normal: texture(part.image.width, part.image.height, image), key, directx: part.normal.normalFormat === 'directx' })
          continue
        }
        const { image, pixels } = await partPixels(part)
        if (!current()) return false
        const normalImage = await loadImage(await normalImageUrl(part))
        if (!current()) return false
        const mesh = activeRepair(part)?await (await import('./part-geometry-async')).buildPartGeometryAsync(part,pixels,controller.signal):buildPartGeometry(part,pixels)
        if(!current())return false
        const bounds = alignedBounds(part, mesh), d = part.image
        const asset: SpriteAsset = {
          ...meshBuffer(mesh), id: part.id, key, surfaceKey, directx: part.normal.normalFormat === 'directx', bounds,
          color: texture(d.width, d.height, image), normal: texture(d.width, d.height, normalImage),
          depth: texture(d.width, d.height), surface: texture(d.width, d.height), width: d.width, height: d.height,
          alpha: pixels.data, field: new Uint8Array(d.width * d.height * 4), coverage: 0,
        }
        staged.set(part.id, asset)
        bakeField(asset)
      }
      if (!current()) return false
      // Publish the whole update together. The old frame stays usable during
      // decoding, normal generation and discarded intermediate requests.
      let geometryChanged = staged.size > 0
      for (const [id, asset] of staged) {
        const existing = assets.get(id)
        assets.set(id, asset)
        if (existing) releaseAsset(existing)
      }
      staged.clear()
      for (const [id, update] of normalUpdates) {
        const existing = assets.get(id)!
        gl!.deleteTexture(existing.normal); textures.splice(textures.indexOf(existing.normal), 1)
        Object.assign(existing, update)
      }
      normalUpdates.clear()
      for (const [id, asset] of assets) if (!ids.has(id)) { releaseAsset(asset); assets.delete(id); geometryChanged = true }
      if (geometryChanged) shadowKey = ''
      return true
    } catch(error){if(controller.signal.aborted)return false;throw error} finally {
      // dispose() already freed all GPU resources if the editor was closed.
      if (!disposed) {
        staged.forEach(releaseAsset)
        normalUpdates.forEach(({ normal }) => { gl!.deleteTexture(normal); textures.splice(textures.indexOf(normal), 1) })
        gl!.bindFramebuffer(gl!.FRAMEBUFFER, null)
      }
    }
  }
  function drawMesh(mesh: GpuMesh, p: WebGLProgram, offset: Vec3, id: number, scale = 1) {
    gl!.uniform1f(u(p, 'objectScale'), scale); gl!.uniform3fv(u(p, 'offset'), offset); gl!.uniform1f(u(p, 'objectId'), id); gl!.bindVertexArray(mesh.vao)
    gl!.drawArrays(gl!.TRIANGLES, 0, mesh.count)
  }
  function updateShadow(state: SceneState) {
    const key = JSON.stringify([state.scene, state.room,state.lightKind,state.sun.azimuth,state.sun.elevation,state.light, state.items.map(i => [i.id, i.assetId, i.scale, i.x, i.z, i.visible, i.casts]), assets.size])
    if (key === shadowKey) return
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, shadowFbo); gl!.drawBuffers([gl!.COLOR_ATTACHMENT0]); gl!.viewport(0, 0, MAP_SIZE, MAP_SIZE)
    gl!.enable(gl!.DEPTH_TEST); gl!.depthFunc(gl!.LESS); gl!.disable(gl!.CULL_FACE); gl!.disable(gl!.BLEND); gl!.disable(gl!.DITHER)
    const directional=state.lightKind==='directional'
    gl!.useProgram(depthProgram); gl!.uniform1f(u(depthProgram,'directional'),+directional); gl!.uniform3fv(u(depthProgram, 'light'), state.light); gl!.uniform1f(u(depthProgram, 'farPlane'), FAR)
    if(directional){sunMatrix=directionalShadowCamera(state).matrix;lightMatrices=[sunMatrix]}
    else lightMatrices = DIRECTIONS.map((dir, i) => multiply(lightProjection, lookAt(state.light, add(state.light, dir), UPS[i])))
    for (let face = 0; face < lightMatrices.length; face++) {
      gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, directional?gl!.TEXTURE_2D:gl!.TEXTURE_CUBE_MAP_POSITIVE_X + face, directional?sunMap:cube, 0); status()
      gl!.clearColor(1, 1, 1, 0); gl!.clearDepth(1); gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT)
      gl!.uniformMatrix4fv(u(depthProgram, 'matrix'), false, lightMatrices[face]); drawMesh(room!, depthProgram, [0, 0, 0], 1)
      state.items.forEach((item, i) => { const a = assets.get(item.assetId); if (a && item.visible && item.casts) drawMesh(a, depthProgram, [item.x, 0, item.z], i + 2, item.scale) })
    }
    shadowKey = key
  }
  function lighting(p: WebGLProgram, state: SceneState, matrix: Mat4) {
    gl!.useProgram(p); gl!.uniformMatrix4fv(u(p, 'matrix'), false, matrix); gl!.uniform3fv(u(p, 'light'), state.light)
    for (const [key, value] of Object.entries({ farPlane: FAR, filtered: +state.filtered, shadows: +state.shadows, ambient: state.ambient, power: state.lightKind==='directional'?state.sun.intensity:state.power, directional:+(state.lightKind==='directional'), visibilityOnly: +(state.mode === 'visibility') })) gl!.uniform1f(u(p, key), value)
    gl!.uniform3fv(u(p,'sunDirection'),sunDirection(state));gl!.uniformMatrix4fv(u(p,'sunMatrix'),false,sunMatrix)
    gl!.activeTexture(gl!.TEXTURE5);gl!.bindTexture(gl!.TEXTURE_2D,sunMap);gl!.uniform1i(u(p,'sunShadowMap'),5)
    gl!.activeTexture(gl!.TEXTURE0); gl!.bindTexture(gl!.TEXTURE_CUBE_MAP, cube); gl!.uniform1i(u(p, 'shadowMap'), 0)
  }
  function drawShadowPoints(state: SceneState, matrix: Mat4, dpr: number) {
    lighting(pointProgram, state, matrix)
    gl!.uniform1f(u(pointProgram, 'receives'), 1)
    gl!.uniform1f(u(pointProgram, 'pointSize'), 4 * dpr)
    gl!.depthMask(false); gl!.depthFunc(gl!.LEQUAL)
    function draw(mesh: GpuMesh, offset: Vec3, id: number, scale: number) {
      gl!.uniform1f(u(pointProgram, 'objectScale'), scale); gl!.uniform3fv(u(pointProgram, 'offset'), offset)
      gl!.uniform1f(u(pointProgram, 'objectId'), id); gl!.bindVertexArray(mesh.points!.vao)
      gl!.drawArrays(gl!.POINTS, 0, mesh.points!.count)
    }
    try {
      room!.points ??= pointBuffer(roomShadowSamples(state))
      gl!.uniform1f(u(pointProgram, 'spriteReceiver'), 0)
      // Bind a valid 2D texture even when sprite masking is disabled.
      gl!.activeTexture(gl!.TEXTURE1); gl!.bindTexture(gl!.TEXTURE_2D, sunMap); gl!.uniform1i(u(pointProgram, 'colorMap'), 1)
      draw(room!, [0, 0, 0], 1, 1)
      state.items.forEach((item, i) => {
        const asset = assets.get(item.assetId)
        if (!asset || !item.visible || !item.receives) return
        asset.points ??= pointBuffer(meshShadowSamples(asset.mesh))
        gl!.uniform1f(u(pointProgram, 'spriteReceiver'), +(state.mode === 'sprites'))
        basis(pointProgram, asset.bounds)
        gl!.activeTexture(gl!.TEXTURE1); gl!.bindTexture(gl!.TEXTURE_2D, asset.color)
        draw(asset, [item.x, 0, item.z], i + 2, item.scale)
      })
    } finally { gl!.depthMask(true); gl!.depthFunc(gl!.LESS) }
  }
  function render(state: SceneState, showShadowPoints = false) {
    if (disposed) return
    lastState = state; lastShowShadowPoints = showShadowPoints
    const rect = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    const width = Math.max(1, Math.round(rect.width * dpr)), height = Math.max(1, Math.round(rect.height * dpr))
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
    updateRoom(state); updateShadow(state)
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null); gl!.viewport(0, 0, width, height); gl!.clearColor(.065, .075, .08, 1)
    gl!.clearDepth(1); gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT); gl!.enable(gl!.DEPTH_TEST); gl!.enable(gl!.DITHER)
    const view = sceneCamera(state, width / height)
    lighting(surfaceProgram, state, view.matrix); gl!.uniform1f(u(surfaceProgram, 'receives'), 1); gl!.uniform1f(u(surfaceProgram, 'room'), 1)
    drawMesh(room!, surfaceProgram, [0, 0, 0], 1); gl!.uniform1f(u(surfaceProgram, 'room'), 0)
    if (state.mode !== 'sprites') {
      state.items.forEach((item, i) => { const asset = assets.get(item.assetId); if (asset && item.visible) { gl!.uniform1f(u(surfaceProgram, 'receives'), +item.receives); drawMesh(asset, surfaceProgram, [item.x, 0, item.z], i + 2, item.scale) } })
    } else {
      lighting(spriteProgram, state, view.matrix); gl!.bindVertexArray(quadVao)
      gl!.uniform1f(u(spriteProgram, 'outlinePixelRatio'), dpr)
      state.items.forEach((item, i) => {
        const asset = assets.get(item.assetId); if (!asset || !item.visible) return
        basis(spriteProgram, asset.bounds); gl!.uniform1f(u(spriteProgram, 'objectScale'), item.scale); gl!.uniform1f(u(spriteProgram, 'directx'), +asset.directx); gl!.uniform3f(u(spriteProgram, 'offset'), item.x, 0, item.z)
        gl!.uniform1f(u(spriteProgram, 'objectId'), i + 2); gl!.uniform1f(u(spriteProgram, 'receives'), +item.receives)
        gl!.uniform1f(u(spriteProgram, 'selected'), +(selectionOutline && item.id === state.selected))
        for (const [j, [name, tex]] of [['colorMap', asset.color], ['normalMap', asset.normal], ['fieldDepth', asset.depth], ['fieldNormal', asset.surface]].entries()) {
          gl!.activeTexture(gl!.TEXTURE1 + j); gl!.bindTexture(gl!.TEXTURE_2D, tex as WebGLTexture); gl!.uniform1i(u(spriteProgram, name as string), j + 1)
        }
        gl!.drawArrays(gl!.TRIANGLES, 0, 6)
      })
    }
    if (showShadowPoints && state.shadows) drawShadowPoints(state, view.matrix, dpr)
    const error = gl!.getError(); if (error !== gl!.NO_ERROR) throw new Error(`WebGL error ${error}`)
  }
  function project(point: Vec3, state: SceneState) {
    const rect = canvas.getBoundingClientRect(), clip = transform(sceneCamera(state, rect.width / rect.height).matrix, point)
    return { x: (clip[0] / clip[3] * .5 + .5) * rect.width, y: (.5 - clip[1] / clip[3] * .5) * rect.height }
  }
  function pick(x: number, y: number, state: SceneState): string | null {
    const view = sceneCamera(state, canvas.clientWidth / canvas.clientHeight)
    let nearest = Infinity, selected: string | null = null
    for (const item of state.items) {
      const a = assets.get(item.assetId); if (!a || !item.visible) continue
      const b = { left: a.bounds.left * item.scale, bottom: a.bounds.bottom * item.scale, width: a.bounds.width * item.scale, height: a.bounds.height * item.scale }, origin = project(add([item.x, 0, item.z], add(RIGHT.map(v => v * b.left) as Vec3, UP.map(v => v * b.bottom) as Vec3)), state)
      const pixelsPerUnit = canvas.clientHeight / (state.zoom * .8)
      const u = (x - origin.x) / (b.width * pixelsPerUnit), v = (origin.y - y) / (b.height * pixelsPerUnit)
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue
      const px = Math.floor(u * a.width), py = Math.floor((1 - v) * a.height)
      if (a.alpha[(Math.min(a.height - 1, py) * a.width + px) * 4 + 3] < 21) continue
      const index = (Math.min(a.height - 1, Math.floor(v * a.height)) * a.width + px) * 4
      const depth = a.field[index + 3] ? (a.field[index] / 255 + a.field[index + 1] / 65025 + a.field[index + 2] / 16581375) * 32 - 16 : 0
      const distance = dot(sub([item.x, 0, item.z], view.eye), FORWARD) + depth * item.scale
      if (distance < nearest) { nearest = distance; selected = item.id }
    }
    return selected
  }
  function inspect(state: SceneState): ReceiverReport {
    render(state)
    const faces: Uint8Array[] = []
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, shadowFbo); gl!.readBuffer(gl!.COLOR_ATTACHMENT0)
    const directional=state.lightKind==='directional',ROOM=roomBounds(state.room)
    for (let i = 0; i < (directional?1:6); i++) {
      gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, directional?gl!.TEXTURE_2D:gl!.TEXTURE_CUBE_MAP_POSITIVE_X + i, directional?sunMap:cube, 0)
      const bytes = new Uint8Array(MAP_SIZE * MAP_SIZE * 4); gl!.readPixels(0, 0, MAP_SIZE, MAP_SIZE, gl!.RGBA, gl!.UNSIGNED_BYTE, bytes); faces.push(bytes)
    }
    const result: ReceiverReport = { ground: 0, walls: 0, objects: [], samples: 0 }
    function blocked(point: Vec3, normal: Vec3, ownId: number) {
      result.samples++
      if (!state.shadows) return false
      const delta = sub(point, state.light), distance = Math.hypot(...delta)
      const diffuse = dot(normal, directional?sunDirection(state):normalize(sub(state.light, point)))
      if (diffuse <= 0) return false // Do not count surfaces that already face away from the light.
      const axis = Math.abs(delta[0]) >= Math.abs(delta[1]) && Math.abs(delta[0]) >= Math.abs(delta[2]) ? 0 : Math.abs(delta[1]) >= Math.abs(delta[2]) ? 1 : 2
      const face = directional?0:axis * 2 + +(delta[axis] < 0), clip = transform(lightMatrices[face], point)
      const x = Math.min(MAP_SIZE - 1, Math.max(0, Math.floor((clip[0] / clip[3] * .5 + .5) * MAP_SIZE)))
      const y = Math.min(MAP_SIZE - 1, Math.max(0, Math.floor((clip[1] / clip[3] * .5 + .5) * MAP_SIZE)))
      const i = (y * MAP_SIZE + x) * 4, bytes = faces[face], id = bytes[i + 3]
      if (!id || id === ownId) return false
      if(directional){const q=clip[2]/clip[3]*.5+.5,stored=bytes[i]/255+bytes[i+1]/65025+bytes[i+2]/16581375;const cosine=Math.max(diffuse,.2),slope=Math.sqrt(Math.max(0,1-cosine*cosine))/cosine;return q-Math.max(.0001,(state.filtered?.0013:.0007)*slope)>stored}
      const depth = (bytes[i] / 255 + bytes[i + 1] / 65025 + bytes[i + 2] / 16581375) * FAR
      const cosine = Math.max(diffuse, .2), slope = Math.sqrt(Math.max(0, 1 - cosine * cosine)) / cosine
      return distance - Math.max(.006, distance * 2 / MAP_SIZE * (state.filtered ? 1.8 : .8) * slope) > depth
    }
    for (let x = ROOM.minX + .25; x < ROOM.maxX; x += .5) for (let z = ROOM.minZ + .25; z < ROOM.maxZ; z += .5) if (blocked([x, .001, z], [0, 1, 0], 1)) result.ground++
    if (state.scene === 'corner') {
      for (let y = .2; y < ROOM.height; y += .35) {
        for (let x = ROOM.minX + .2; x < ROOM.maxX; x += .35) if (blocked([x, y, ROOM.minZ + .001], [0, 0, 1], 1)) result.walls++
        for (let z = ROOM.minZ + .2; z < ROOM.maxZ; z += .35) if (blocked([ROOM.minX + .001, y, z], [1, 0, 0], 1)) result.walls++
      }
    }
    state.items.forEach((item, index) => {
      let count = 0; const asset = assets.get(item.assetId)
      if (asset && item.visible && item.receives) for (let v = 0; v < asset.mesh.vertices.length; v += 27) {
        const m = asset.mesh.vertices, p: Vec3 = [item.x + (m[v] + m[v + 9] + m[v + 18]) / 3 * item.scale, (m[v + 1] + m[v + 10] + m[v + 19]) / 3 * item.scale, item.z + (m[v + 2] + m[v + 11] + m[v + 20]) / 3 * item.scale]
        const normal = Array.from(m.slice(v + 3, v + 6)) as Vec3
        if (blocked(p, normal, index + 2)) count++
      }
      result.objects.push({ id: item.id, shadows: count })
    })
    render(state); return result
  }
  function dispose() {
    geometryController?.abort()
    if (disposed) return; disposed = true
    syncEpoch++
    gl!.deleteFramebuffer(shadowFbo); gl!.deleteFramebuffer(fieldFbo); gl!.deleteRenderbuffer(shadowDepth); gl!.deleteRenderbuffer(fieldDepth)
    textures.forEach(t => gl!.deleteTexture(t)); buffers.forEach(b => gl!.deleteBuffer(b)); vaos.forEach(v => gl!.deleteVertexArray(v)); programs.forEach(p => gl!.deleteProgram(p)); shaders.forEach(s => gl!.deleteShader(s))
    assets.clear()
  }
  return { syncAssets, render, project, pick, inspect, dispose, coverage: () => Object.fromEntries([...assets].map(([id, a]) => [id, a.coverage])), repaint: () => lastState && render(lastState, lastShowShadowPoints) }
}
