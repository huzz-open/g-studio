import type { AutoDetectOptions, DetectedSprite } from '../../interfaces/sprite-detector'
import { imageDataToDataUrl, padIndex } from '../utils/canvas-utils'
import { restorePixelOwnership, groupNearbyLabels, extractOwnedRegions } from './pixel-ownership'

export function spritesFromLabels(
  image: ImageData, width: number, height: number, seeds: Int32Array, options: AutoDetectOptions,
): DetectedSprite[] {
  const owners = restorePixelOwnership(image.data, width, height, seeds)
  const areas = new Map<number, number>()
  const solidOwners = new Int32Array(owners.length)
  for (let p = 0; p < owners.length; p++) {
    if (owners[p] && image.data[p * 4 + 3]! > 60) {
      solidOwners[p] = owners[p]!
      areas.set(owners[p]!, (areas.get(owners[p]!) ?? 0) + 1)
    }
  }
  const groups = groupNearbyLabels(solidOwners, width, height, Math.max(0, Math.floor(options.mergeGap)))
    .filter(labels => labels.reduce((sum, id) => sum + (areas.get(id) ?? 0), 0) >= options.minArea)
  const regions = extractOwnedRegions(image.data, width, owners, groups)
  const rowThreshold = regions.length
    ? regions.reduce((sum, r) => sum + r.rect.h, 0) / regions.length * 0.5 : 20
  regions.sort((a, b) => Math.abs(a.rect.y - b.rect.y) > rowThreshold
    ? a.rect.y - b.rect.y : a.rect.x - b.rect.x)
  return regions.map(({ rect, pixels }, id) => {
    const imageData = new ImageData(pixels, rect.w, rect.h)
    return {
      id, rect, imageData,
      dataUrl: imageDataToDataUrl(imageData, rect.w, rect.h),
      name: `sprite-${padIndex(id)}`,
    }
  })
}
