export function createOffscreenCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
} {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  return { canvas, ctx }
}

export function imageDataToDataUrl(imageData: ImageData, w: number, h: number): string {
  const { canvas, ctx } = createOffscreenCanvas(w, h)
  ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
}

export function imageDataToBlob(imageData: ImageData, w: number, h: number): Promise<Blob> {
  const { canvas, ctx } = createOffscreenCanvas(w, h)
  ctx.putImageData(imageData, 0, 0)
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob!), 'image/png')
  })
}

export function isCellEmpty(imgData: ImageData, alphaThreshold = 10): boolean {
  const d = imgData.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] >= alphaThreshold) return false
  }
  return true
}

export function padIndex(i: number, digits = 2): string {
  return String(i + 1).padStart(digits, '0')
}
