import { shallowRef } from 'vue'
export interface PartEditorSession { assetId: string; origin: 'slicer' | 'scene'; sourceTabId?: string; spriteId?: number }
export const partEditorSession = shallowRef<PartEditorSession | null>(null)
export function openPartEditor(session: PartEditorSession) { partEditorSession.value = session }
export function closePartEditor() { partEditorSession.value = null }
