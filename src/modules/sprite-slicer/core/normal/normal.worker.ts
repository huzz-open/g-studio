import { generateNormals, type PixelImage } from './generator'
import type { NormalSettings } from '../../../../shared/types/normal-settings'

self.onmessage = (event: MessageEvent<{ image: PixelImage; settings: NormalSettings }>) => {
  try {
    const result = generateNormals(event.data.image, event.data.settings)
    self.postMessage({ result }, { transfer: [result.data.buffer] })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
