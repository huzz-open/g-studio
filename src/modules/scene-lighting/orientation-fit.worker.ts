import { findOrientation, type Pixels } from './orientation-fit'
import type { Vec3 } from '../experiments/umbrella/math'

self.onmessage = (event: MessageEvent<{ positions: Float32Array; pixels: Pixels; initial: Vec3; initialProjection: Vec3 }>) => {
  try {
    const { positions, pixels, initial, initialProjection } = event.data
    const result = findOrientation(positions, pixels, initial, progress => self.postMessage({ progress }), initialProjection)
    self.postMessage({ result })
  } catch (error) { self.postMessage({ error: String(error) }) }
}
