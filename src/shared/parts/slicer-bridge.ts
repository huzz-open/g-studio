import type { PartAsset } from './schema'
import { partImageUrl } from './images'
import { useSlicerTabs } from '../../modules/sprite-slicer/store'
export { ensureSpritePart } from './sprite-assets'

export async function openPartInSlicer(part: PartAsset) {
  const tabs=useSlicerTabs();await tabs.ready
  for(const instance of tabs.instances.value){const sprite=instance.state.sprites.find(s=>s.partAsset?.id===part.id);if(sprite){tabs.switchTab(instance.id);return{tabId:instance.id,spriteId:sprite.id}}}
  const instance=tabs.createTab()
  instance.setPendingRestore([{name:part.name,rect:[0,0,part.image.width,part.image.height],normalSettings:part.normal,partAsset:part}])
  const response=await fetch(partImageUrl(part));if(!response.ok)throw new Error('部件图片无法打开')
  await instance.loadFile(new File([await response.blob()],part.name+'.png',{type:'image/png'}))
  const sprite=instance.state.sprites[0];if(!sprite)throw new Error('部件无法打开')
  instance.attachPartAsset(sprite.id,part);return{tabId:instance.id,spriteId:sprite.id}
}
