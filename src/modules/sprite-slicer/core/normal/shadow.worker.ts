import { buildShadowModel } from './shadow-model'
self.onmessage = (event: MessageEvent<{ data: Uint8ClampedArray; width: number; height: number }>) => {
  try {
    const { data, width, height } = event.data
    const result = buildShadowModel(data, width, height)
    self.postMessage({ result }, { transfer: [result.vertices.buffer] })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
