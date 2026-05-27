import type { PanelConfig } from './types'

export function definePanelConfig(
  persistKey: string,
  defaultWidth = 260,
  min = 180,
  max = 480,
): PanelConfig {
  return { width: { default: defaultWidth, min, max }, persistKey }
}
