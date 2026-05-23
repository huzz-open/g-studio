export interface BgRemovalOptions {
  bgColor: [number, number, number]
  tolerance: number
  spillStrength: number
}

export interface IBackgroundRemover {
  readonly id: string
  readonly labelKey: string
  remove(imageData: ImageData, options: BgRemovalOptions): ImageData
}
