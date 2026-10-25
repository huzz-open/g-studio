import type { GsType } from './types'
import type { WriteGsResult } from './writer'
import { createGsFile, GsDifferentTypeConflictError, GsSameTypeConflictError } from './writer'
import { getWorkspaceHandle } from '../workspace'
import { resolveDir, splitPath, saveImageToWorkspace, fileExists } from '../workspace/fs'
import { useSettings } from '../settings'
import { showToast } from '../components/toast'
import { promptExtended, type InlineChoice } from '../components/prompt'
import { confirm } from '../components/confirm'
import { useI18n } from '../i18n'

export interface SaveFlowConfig {
  type: GsType
  tabsManager: { saveSession: () => void }
  getInstance: () => SaveableInstance | null
  getSaveAsParams: (inst: any) => SaveAsParams | null
  onSaved: (inst: any, result: { gsPath: string; version: number; texturePath: string }) => void
}

export interface SaveableInstance {
  state: {
    gsPath: string | null
    gsLastKnownVersion: number
    dirty: boolean
  }
  saveToGsFile: () => Promise<WriteGsResult>
}

export interface SaveAsParams {
  defaultName: string
  imageFileName: string
  imageBuffer: () => Promise<Uint8Array>
  buildData: (texturePath: string) => unknown
}

export function useSaveFlow(config: SaveFlowConfig) {
  const { t } = useI18n()
  const { settings } = useSettings()

  async function saveWithResult(): Promise<boolean> {
    const inst = config.getInstance()
    if (!inst) return false

    if (inst.state.gsPath) {
      return overwriteSave(inst)
    } else {
      return saveAsNew()
    }
  }

  async function overwriteSave(inst: SaveableInstance): Promise<boolean> {
    try {
      const result = await inst.saveToGsFile()
      if (result.status === 'ok') {
        config.tabsManager.saveSession()
        showToast(t('toast.save.success'), 'success')
        return true
      } else {
        showToast(t('toast.save.conflict'), 'error')
      }
    } catch (e) {
      showToast(`${t('toast.save.error')}: ${(e as Error).message}`, 'error')
    }
    return false
  }

  async function findAvailableName(baseName: string): Promise<string> {
    try {
      const dirHandle = await resolveDir('', false)
      if (!await fileExists(dirHandle, `${baseName}.gs`)) return baseName
      let counter = 2
      while (await fileExists(dirHandle, `${baseName}-${counter}.gs`)) {
        counter++
      }
      return `${baseName}-${counter}`
    } catch {
      return baseName
    }
  }

  async function saveAsNew(): Promise<boolean> {
    const inst = config.getInstance()
    if (!inst) return false

    if (!getWorkspaceHandle()) {
      showToast(t('workspace.openFirst'), 'info')
      return false
    }

    const params = config.getSaveAsParams(inst)
    if (!params) {
      showToast(t('save.noSource'), 'error')
      return false
    }

    const suggestedName = await findAvailableName(params.defaultName)
    const strategy = settings.workspace.imageConflictStrategy

    const inlineChoices: InlineChoice[] = strategy === 'ask' ? [{
      id: 'imageConflict',
      label: t('save.imageConflictLabel'),
      options: [
        { value: 'skip', label: t('settings.workspace.imageConflict.skip') },
        { value: 'overwrite', label: t('settings.workspace.imageConflict.overwrite') },
      ],
      defaultValue: 'skip',
    }] : []

    const promptResult = await promptExtended({
      title: t('save.asTitle'),
      message: suggestedName !== params.defaultName ? t('save.nameAutoIncrement') : undefined,
      placeholder: params.defaultName,
      defaultValue: suggestedName,
      inlineChoices,
    })
    if (!promptResult) return false

    const userInput = promptResult.value
    const imageConflictChoice = promptResult.choices.imageConflict as 'skip' | 'overwrite' | undefined

    try {
      const gsFullName = userInput.endsWith('.gs') ? userInput : `${userInput}.gs`
      const { dir: subDir, fileName: gsFileName } = splitPath(gsFullName)

      const dirHandle = await resolveDir(subDir, true)

      const buffer = await params.imageBuffer()
      const effectiveStrategy: 'skip' | 'overwrite' = imageConflictChoice || (strategy === 'ask' ? 'skip' : strategy)
      const imgResult = await saveImageToWorkspace(dirHandle, params.imageFileName, buffer, effectiveStrategy)
      const texturePath = `./${imgResult.finalName}`

      const data = params.buildData(texturePath)

      let version: number
      const gsPath = subDir ? `${subDir}/${gsFileName}` : gsFileName

      try {
        const result = await createGsFile({ path: gsPath, type: config.type, data })
        version = result.version
      } catch (e) {
        if (e instanceof GsDifferentTypeConflictError) {
          showToast(t('save.typeMismatch'), 'error')
          return false
        }
        if (e instanceof GsSameTypeConflictError) {
          const overwrite = await confirm({
            title: t('save.conflictTitle'),
            message: t('save.sameTypeExists'),
            confirmText: t('save.overwrite'),
            cancelText: t('common.cancel'),
          })
          if (!overwrite) return false
          const result = await createGsFile({
            path: gsPath,
            type: config.type,
            data,
            allowOverwriteSameType: true,
          })
          version = result.version
        } else {
          throw e
        }
      }

      config.onSaved(inst, { gsPath, version, texturePath })
      config.tabsManager.saveSession()
      showToast(`${t('toast.save.success')}: ${gsPath}`, 'success')
      return true
    } catch (e) {
      showToast(`${t('toast.save.error')}: ${(e as Error).message}`, 'error')
    }
    return false
  }

  async function handleSave(): Promise<void> { await saveWithResult() }
  return { handleSave, saveAsNew, saveWithResult }
}
