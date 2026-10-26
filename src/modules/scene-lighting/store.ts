import { parseScene } from './scene-state'
export { parseScene } from './scene-state'
import { createObservedHistory } from '../../shared/history/createObservedHistory'
import { reactive, ref, watch, type Ref } from 'vue'
import { useEditorTabs, type UseEditorTabsReturn } from '../../shared/components/editor-shell/useEditorTabs'
import { translate } from '../../shared/i18n'
import { partMovementLimits } from './part-geometry'
import { createScene, createDefaultScene, DEFAULT_SCENE_ID, DEFAULT_ROOM, type Preset, type SceneState } from './model'
import { clonePart, MAX_SCENE_ITEMS, type PartAsset } from '../../shared/parts/schema'
import { loadPartLibrary, partLibrary } from '../../shared/parts/library'

export interface SceneDocument { id: string; name: string; state: SceneState }
type SavedScene = Pick<SceneDocument, 'id' | 'name' | 'state'> & { pinned?: boolean }
const hot = import.meta.hot?.data
const KEY = 'g-studio-scene-tabs-v3'
let number: number = hot?.number ?? 0
const histories = new Map<string, ReturnType<typeof createObservedHistory<SceneState>>>()
export function sceneHistory(doc: SceneDocument) {
  let history = histories.get(doc.id)
  if (!history) {
    history = createObservedHistory<SceneState>({
      capture: () => clonePart({...doc.state, selected: '', tool: 'objects', zoom: 14, target: undefined}),
      restore: snapshot => {
        const selected=doc.state.selected, zoom=doc.state.zoom, target=doc.state.target
        doc.state=clonePart({...snapshot,zoom,target,selected:snapshot.items.some(i=>i.id===selected)?selected:snapshot.items[0]?.id??''})
      },
    })
    histories.set(doc.id,history)
  }
  return history
}
export function emptyScene(): SceneState { return { ...createDefaultScene(), items: [], selected: '' } }
function makeDocument(id: string): SceneDocument {
  return reactive({ id, name: translate('parts.sceneTab', { number: ++number }), state: emptyScene() })
}
const tabs: UseEditorTabsReturn<SceneDocument> = hot?.tabs?.setPinned ? hot.tabs : useEditorTabs({ prefix: 'lighting', factory: makeDocument, autoEmptyTab: false })
if (hot?.tabs && hot.tabs !== tabs) { tabs.instances.value = hot.tabs.instances.value; tabs.activeTabId.value = hot.tabs.activeTabId.value }
export const closedScenes: Ref<SavedScene[]> = hot?.closedScenes ?? ref([])
export const sceneStorageError: Ref<string> = hot?.sceneStorageError ?? ref('')
let initialized = !!hot?.tabs && !!hot?.initialized
let initializing: Promise<void> | undefined
export function useSceneTabs() {
  for(const doc of tabs.instances.value){if(!doc.state.room)doc.state.room={...DEFAULT_ROOM};if(!doc.state.lightKind)doc.state.lightKind='point';if(!doc.state.sun)doc.state.sun={azimuth:45,elevation:45,intensity:1.2}}
  return tabs
}
export function activeScene() { return tabs.activeInstance.value ?? tabs.createTab() }
function snapshot(doc: SceneDocument): SavedScene { return { id: doc.id, name: doc.name, state: clonePart(doc.state), pinned: tabs.pinnedIds.value.has(doc.id) } }
function restore(value: any): SceneDocument {
  if (!value || typeof value.id !== 'string' || !/^[a-zA-Z0-9:_-]{1,160}$/.test(value.id) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120) throw new Error('Invalid scene tab')
  return reactive({ id: value.id, name: value.name === 'parts.sceneTab' ? translate('parts.sceneTab', {number: ++number}) : value.name, state: parseScene(value.state) })
}

function ensureDefaultScene() {
  if (tabs.instances.value.some(doc => doc.id === DEFAULT_SCENE_ID)) return
  const saved = closedScenes.value.find(doc => doc.id === DEFAULT_SCENE_ID)
  const doc = saved ? restore(saved) : reactive({ id: DEFAULT_SCENE_ID, name: translate('parts.defaultScene'), state: createDefaultScene() })
  closedScenes.value = closedScenes.value.filter(scene => scene.id !== DEFAULT_SCENE_ID)
  tabs.instances.value = [doc, ...tabs.instances.value]
  tabs.switchTab(doc.id)
}

export function initializeScene(): Promise<void> {
  if (initialized) return loadPartLibrary().then(() => { ensureDefaultScene(); persist() })
  return initializing ??= (async () => {
    await loadPartLibrary(); await tabs.ready
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) {
        const saved = JSON.parse(raw)
        if (saved.version !== 3 || !Array.isArray(saved.tabs) || !Array.isArray(saved.closed)) throw new Error('Invalid scene session')
        const open = saved.tabs.map(restore) as SceneDocument[], closed = saved.closed.map(restore) as SceneDocument[]
        if (new Set([...open, ...closed].map(d => d.id)).size !== open.length + closed.length) throw new Error('Duplicate scene tabs')
        tabs.instances.value = open
        tabs.pinnedIds.value = new Set(saved.tabs.filter((doc: SavedScene) => doc.pinned === true).map((doc: SavedScene) => doc.id))
        closedScenes.value = closed.map((doc, i) => ({ ...snapshot(doc), pinned: saved.closed[i].pinned === true }))
        number = Math.max(saved.number || 0, open.length + closed.length)
        tabs.activeTabId.value = open.some(d => d.id === saved.activeId) ? saved.activeId : open[0]?.id ?? null
      } else {
        const legacy = localStorage.getItem('g-studio-scene-lighting-v2') ?? localStorage.getItem('g-studio-scene-lighting-v1')
        if (legacy || hot?.sceneState) {
          const doc = tabs.createTab(); doc.state = parseScene(legacy ? JSON.parse(legacy) : hot.sceneState)
        }
      }
    } catch (error) { sceneStorageError.value = String(error) }
    ensureDefaultScene()
    initialized = true; persist()
  })()
}
function persist() {
  if (!initialized) return
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: 3, number, tabs: tabs.instances.value.map(snapshot), activeId: tabs.activeTabId.value, closed: closedScenes.value }))
  } catch (error) { sceneStorageError.value = String(error) }
}
const stopPersistence = watch(() => [tabs.instances.value, tabs.activeTabId.value, tabs.pinnedIds.value, closedScenes.value], persist, { deep: true })
if (import.meta.hot) import.meta.hot.dispose(data => {
  histories.forEach(history=>history.dispose()); histories.clear();
  persist(); stopPersistence(); Object.assign(data, { tabs, closedScenes, sceneStorageError, initialized, number })
})
export async function newSceneTab(name?: string, state?: SceneState) {
  await initializeScene()
  const doc = tabs.createTab()
  if (name?.trim()) doc.name = name.trim().slice(0, 120)
  if (state) doc.state = parseScene(state)
  histories.get(doc.id)?.clear()
  return doc
}
export function closeSceneTab(id: string) {
  if (id === DEFAULT_SCENE_ID) return
  const doc = tabs.instances.value.find(d => d.id === id); if (!doc) return
  closedScenes.value = [...closedScenes.value.filter(d => d.id !== id), snapshot(doc)]
  histories.get(id)?.dispose(); histories.delete(id)
  tabs.closeTab(id)
  if (!tabs.instances.value.length) tabs.createTab()
}
export function reopenSceneTab() {
  const saved = closedScenes.value.pop(); if (!saved) return
  const doc = restore(saved); tabs.instances.value = [...tabs.instances.value, doc]; tabs.switchTab(doc.id)
  if (saved.pinned) tabs.setPinned(doc.id, true)
}
export function renameSceneTab(id: string, name: string) {
  if (id === DEFAULT_SCENE_ID) return
  const doc = tabs.instances.value.find(d => d.id === id)
  if (doc && name.trim()) doc.name = name.trim().slice(0, 120)
}
export function setExampleScene(preset: Preset) { const doc = activeScene(); sceneHistory(doc).batch(()=>{doc.state = createScene(preset)}) }
export function clearScene() { const doc = activeScene(); sceneHistory(doc).batch(()=>{doc.state = emptyScene()}) }
export async function addPartsToScene(parts: PartAsset[], targetId?: string, point?: {x:number;z:number}) {
  await initializeScene()
  const doc = targetId ? tabs.instances.value.find(d => d.id === targetId) : activeScene()
  if (!doc) throw new Error('目标场景已关闭')
  const state = doc.state
  if (state.items.length + parts.length > MAX_SCENE_ITEMS) throw new Error(`场景最多支持 ${MAX_SCENE_ITEMS} 个物品`)
  for (const part of parts) if (!partLibrary[part.id]) throw new Error(`部件未保存：${part.name}`)
  sceneHistory(doc).batch(()=>{
  const start = state.items.length
  parts.forEach((part, index) => {
    const slot = start + index, id = crypto.randomUUID()
    const bounds=partMovementLimits(part,1,state.room)
    const x=point?.x ?? (slot % 3 - 1)*2.7, z=point?.z ?? -1.5+(Math.floor(slot/3)%3)*2.3
    state.items.push({ id, assetId: part.id, x:Math.max(bounds.minX,Math.min(bounds.maxX,x)), z:Math.max(bounds.minZ,Math.min(bounds.maxZ,z)),
      scale: 1, visible: true, casts: true, receives: true })
    state.selected = id
  })
  })
}
export function removeSceneItem(id: string) {
  const doc = activeScene(); sceneHistory(doc).batch(()=>{
  doc.state.items = doc.state.items.filter(i => i.id !== id)
  if (doc.state.selected === id) doc.state.selected = doc.state.items[0]?.id ?? ''
  })
}
