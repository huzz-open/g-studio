/**
 * Convert an ImageBitmap or HTMLImageElement to PNG Uint8Array using OffscreenCanvas.
 */
export async function imageToPngBuffer(
  source: ImageBitmap | HTMLImageElement,
): Promise<Uint8Array> {
  const cv = new OffscreenCanvas(source.width, source.height)
  cv.getContext('2d')!.drawImage(source, 0, 0)
  const blob = await cv.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}
