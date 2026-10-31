import type { SceneState } from './model'

/** Mutually exclusive render outputs, not user-combinable layers. */
export interface PreviewDisplay { mode: 'effect' | 'model' | 'shadow' | 'source' | 'alignment' }
export function previewLayers(state:SceneState,display?:PreviewDisplay){
  const mode=display?.mode??(state.mode==='sprites'?'effect':state.mode==='visibility'?'shadow':'model')
  return {image:mode==='effect'||mode==='source',model:mode==='model'||mode==='shadow'||mode==='alignment',shadowInspection:mode==='shadow',sourceOnly:mode==='source',room:mode!=='source'&&mode!=='alignment',shadows:mode==='source'||mode==='alignment'?false:mode==='shadow'&&display?true:state.shadows}
}
