import { createPart, type PartAsset } from './schema'
import { loadPartLibrary, partLibrary, hydrateParts } from './library'
import type { SlicerInstance } from '../../modules/sprite-slicer/store'
import type { DetectedSprite } from '../../modules/sprite-slicer/interfaces/sprite-detector'

const hashes = new WeakMap<HTMLImageElement, Promise<string>>()
async function hash(text: string) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('') }
const pending = new WeakMap<DetectedSprite, Promise<PartAsset>>()
export function ensureSpritePart(store: Pick<SlicerInstance,'state'|'attachPartAsset'>, sprite: DetectedSprite, current:()=>boolean=()=>true): Promise<PartAsset> {
  const existing = pending.get(sprite); if(existing)return existing
  const operation = (async()=>{
    await loadPartLibrary()
    if(sprite.partAsset){await hydrateParts([sprite.partAsset]);return partLibrary[sprite.partAsset.id]??sprite.partAsset}
    const image=store.state.sourceImage;if(!image)throw new Error('没有源图')
    let sheetHash=hashes.get(image);if(!sheetHash){sheetHash=hash(image.src);hashes.set(image,sheetHash)}
    const rect={...(sprite._origRect??sprite.rect)},uri=sprite._origDataUrl??sprite.dataUrl
    const source:NonNullable<PartAsset['source']>={sheetHash:await sheetHash,pixelHash:await hash(uri),fileName:store.state.sourceFileName,rect:[rect.x,rect.y,rect.w,rect.h],gsPath:store.state.gsPath??undefined}
    if(!current()||!store.state.sprites.includes(sprite)||store.state.sourceImage!==image)throw new Error('切分结果已变化')
    // Identity follows the crop content, not its sheet, position or file name.
    // Hydration atomically keeps the existing revision, including across browser tabs.
    const id=`sprite:${rect.w}x${rect.h}:${source.pixelHash}`
    const candidate=createPart(sprite.name,{uri,width:rect.w,height:rect.h},id)
    candidate.source=source
    if(sprite.normalSettings)candidate.normal={...sprite.normalSettings}
    await hydrateParts([candidate])
    const part=partLibrary[id]!
    // Detection may have changed while hashing/persisting. Never attach to a reused numeric id.
    if(!current()||!store.state.sprites.includes(sprite)||store.state.sourceImage!==image)throw new Error('切分结果已变化，请重新选择部件')
    store.attachPartAsset(sprite.id,part);return part
  })()
  pending.set(sprite,operation);void operation.finally(()=>pending.delete(sprite)).catch(()=>undefined);return operation
}
