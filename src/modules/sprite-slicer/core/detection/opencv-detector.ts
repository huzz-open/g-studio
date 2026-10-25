import type { DetectedSprite, AutoDetectOptions } from '../../interfaces/sprite-detector'
import { getCV } from '../opencv/loader'
import { spritesFromLabels } from './sprites-from-labels'

export async function opencvDetect(
  imageData: ImageData, width: number, height: number, options: AutoDetectOptions,
): Promise<DetectedSprite[]> {
  const cv = await getCV()
  const mats: { delete(): void }[] = []
  const track = <T extends { delete(): void }>(mat: T): T => { mats.push(mat); return mat }
  try {
    const src = track(cv.matFromImageData(imageData))
    const channels = track(new cv.MatVector())
    cv.split(src, channels)
    const alpha = track(channels.get(3))
    const binary = track(new cv.Mat())
    cv.threshold(alpha, binary, 60, 255, cv.THRESH_BINARY)
    const kernel = track(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3)))
    const eroded = track(new cv.Mat())
    cv.erode(binary, eroded, kernel, new cv.Point(-1, -1), 2)
    const labels = track(new cv.Mat())
    const stats = track(new cv.Mat())
    const centroids = track(new cv.Mat())
    cv.connectedComponentsWithStats(eroded, labels, stats, centroids)
    return spritesFromLabels(imageData, width, height, labels.data32S, options)
  } finally {
    for (const mat of mats.reverse()) mat.delete()
  }
}
