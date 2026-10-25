import { generateTileset, type GenerateInput } from './generator'
self.onmessage = (event: MessageEvent<{ id: number; input: GenerateInput }>) => {
  const { id, input } = event.data
  try {
    const result = generateTileset(input)
    self.postMessage({ id, result }, { transfer: [result.pixels.buffer] })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}
