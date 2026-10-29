import { dismissToast, showToast, type ToastType } from '../components/toast'
import { generationServiceStatus } from './readiness'

let notice: number | undefined

export function clearGenerationFeedback() {
  if (notice !== undefined) dismissToast(notice)
  notice = undefined
}

export function showGenerationFeedback(message: string, type: ToastType, duration = 5000) {
  clearGenerationFeedback()
  notice = showToast(message, type, duration)
}

/** Testing the service uses the same readiness result as generation and its badge. */
export function showConnectionTestFeedback() {
  const status = generationServiceStatus.value
  showGenerationFeedback(status.detail,
    status.type, status.type === 'success' ? 3000 : 5000)
}
