import type { IBackgroundRemover, BgRemovalOptions } from '../../interfaces/background-remover'

export class NullRemover implements IBackgroundRemover {
  readonly id = 'none'
  readonly labelKey = 'slicer.bgRemoval.none'

  remove(data: ImageData, _options: BgRemovalOptions): ImageData {
    return data
  }
}
