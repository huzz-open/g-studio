import { buildShadowGeometry } from './shadow-geometry'
self.onmessage = (event: MessageEvent<{ data: Uint8ClampedArray; width: number; height: number }>) => {
  try {
    const { data, width, height } = event.data
    const result = buildShadowGeometry(data, width, height)
    self.postMessage({ result }, { transfer: [result.vertices.buffer] })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
