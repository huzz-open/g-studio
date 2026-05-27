export async function pixelsToBlob(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  type = 'image/png',
): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0)
  return canvas.convertToBlob({ type })
}

export async function pixelsToBlobUrl(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<string> {
  const blob = await pixelsToBlob(pixels, width, height)
  return URL.createObjectURL(blob)
}
