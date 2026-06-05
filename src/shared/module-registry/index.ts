import { GsType } from '../gs-format/types'

export interface ModuleHandler {
  moduleId: string
  gsType: GsType
  label: string
  icon: string
  route: string
  createLabel: string
  fileSummary: (data: unknown) => string
}

const handlers: ModuleHandler[] = []

export function registerModuleHandler(handler: ModuleHandler): void {
  const existing = handlers.findIndex(h => h.gsType === handler.gsType)
  if (existing >= 0) {
    handlers[existing] = handler
  } else {
    handlers.push(handler)
  }
}

export function getHandlerByGsType(type: GsType): ModuleHandler | undefined {
  return handlers.find(h => h.gsType === type)
}

export function getHandlerByModuleId(moduleId: string): ModuleHandler | undefined {
  return handlers.find(h => h.moduleId === moduleId)
}

export function getAllHandlers(): ModuleHandler[] {
  return [...handlers]
}
