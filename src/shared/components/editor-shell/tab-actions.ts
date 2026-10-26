import type { TabItem } from './types'

export type TabCloseAction = 'current' | 'others' | 'left' | 'right'

/** Resolve once against the visible order before any close handler mutates it. */
export function tabCloseTargets(tabs: TabItem[], targetId: string, action: TabCloseAction): string[] {
  const index = tabs.findIndex(tab => tab.id === targetId)
  if (index < 0) return []
  return tabs.filter((tab, i) => {
    if (tab.closable === false) return false
    if (action === 'current') return i === index
    if (tab.pinned) return false
    return action === 'others' ? i !== index : action === 'left' ? i < index : i > index
  }).map(tab => tab.id)
}

export function movePinnedTab<T extends { id: string }>(tabs: T[], id: string, pinnedIds: Set<string>, pinned: boolean): T[] {
  const target = tabs.find(tab => tab.id === id)
  if (!target) return tabs
  const rest = tabs.filter(tab => tab.id !== id)
  if (pinned) return [target, ...rest]
  const boundary = rest.findIndex(tab => !pinnedIds.has(tab.id))
  const index = boundary < 0 ? rest.length : boundary
  return [...rest.slice(0, index), target, ...rest.slice(index)]
}
