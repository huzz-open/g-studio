import { reactive } from 'vue'

export const DEFAULT_PREVIEW_LIGHT = Object.freeze({ brightness: 1, height: 0.6, ambient: 0.35, color: '#ffffff' })
export const previewLight = reactive({ ...DEFAULT_PREVIEW_LIGHT })

export function createLighting(canvas: HTMLCanvasElement, image: ImageData) {
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false })
  if (!gl) throw new Error('WebGL is unavailable')
  canvas.width = image.width; canvas.height = image.height
  const shaders: WebGLShader[] = []
  function shader(type: number, source: string) {
    const result = gl!.createShader(type)!
    gl!.shaderSource(result, source); gl!.compileShader(result)
    if (!gl!.getShaderParameter(result, gl!.COMPILE_STATUS)) throw new Error(gl!.getShaderInfoLog(result) || 'Shader failed')
    shaders.push(result)
    return result
  }
  const program = gl.createProgram()!
  gl.attachShader(program, shader(gl.VERTEX_SHADER, `
    attribute vec2 position; varying vec2 uv;
    void main() { uv = (position + 1.0) * 0.5; gl_Position = vec4(position, 0.0, 1.0); }
  `))
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `
    precision highp float;
    varying vec2 uv;
    uniform sampler2D colorMap; uniform sampler2D normalMap;
    uniform vec2 size; uniform vec3 light; uniform vec3 tint;
    uniform float brightness; uniform float ambient; uniform float normalView;
    uniform float ySign;
    void main() {
      vec2 sampleUv = vec2(uv.x, 1.0 - uv.y);
      vec4 color = texture2D(colorMap, sampleUv);
      vec3 encoded = texture2D(normalMap, sampleUv).rgb;
      if (normalView > 0.5) { gl_FragColor = vec4(encoded * color.a, color.a); return; }
      vec3 normal = normalize(encoded * 2.0 - 1.0);
      normal.y *= ySign;
      // Image coordinates increase downward; OpenGL normals increase upward.
      vec3 direction = normalize(vec3(light.x - uv.x * size.x, (1.0 - uv.y) * size.y - light.y, light.z));
      float diffuse = max(dot(normal, direction), 0.0);
      // The browser composites a premultiplied drawing buffer. Clamp before multiplying:
      // even a bright light must not expose hidden RGB in almost-transparent pixels.
      vec3 lit = clamp(color.rgb * (vec3(ambient) + tint * brightness * diffuse), 0.0, 1.0);
      gl_FragColor = vec4(lit * color.a, color.a);
    }
  `))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Shader link failed')
  gl.useProgram(program)
  const buffer = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'position')
  gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  const textures = [gl.createTexture()!, gl.createTexture()!]
  function upload(index: number, pixels: ImageData) {
    gl!.activeTexture(gl!.TEXTURE0 + index); gl!.bindTexture(gl!.TEXTURE_2D, textures[index])
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.NEAREST)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.NEAREST)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE)
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, pixels.width, pixels.height, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, pixels.data)
  }
  upload(0, image)
  const uniform = (name: string) => gl.getUniformLocation(program, name)
  gl.uniform1i(uniform('colorMap'), 0); gl.uniform1i(uniform('normalMap'), 1)
  gl.uniform2f(uniform('size'), image.width, image.height)
  gl.viewport(0, 0, image.width, image.height)
  return {
    update: (normal: ImageData) => upload(1, normal),
    draw(x: number, y: number, showNormal: boolean, directX: boolean) {
      const hex = previewLight.color.substring(1)
      gl.uniform3f(uniform('light'), x, y, Math.max(image.width, image.height) * previewLight.height)
      gl.uniform3f(uniform('tint'), parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255)
      gl.uniform1f(uniform('brightness'), previewLight.brightness)
      gl.uniform1f(uniform('ambient'), previewLight.ambient)
      gl.uniform1f(uniform('normalView'), showNormal ? 1 : 0)
      gl.uniform1f(uniform('ySign'), directX ? -1 : 1)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    },
    dispose(loseContext = true) {
      textures.forEach(texture => gl.deleteTexture(texture))
      gl.deleteBuffer(buffer); gl.deleteProgram(program); shaders.forEach(s => gl.deleteShader(s))
      if (loseContext) gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
