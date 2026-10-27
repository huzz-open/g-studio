import type { LocalJob } from './jobs'

export function jobStatus(job: LocalJob) {
  if (job.geometry) return 'succeeded'
  if (job.resultRejected || job.error) return 'failed'
  // A remote success still needs to be downloaded and persisted locally.
  if (job.remote?.status === 'succeeded') return 'receiving'
  return job.remote?.status ?? 'undefined'
}

export function jobRunning(job: LocalJob) {
  return !job.geometry && !!job.remote && ['queued', 'running', 'cancel_requested'].includes(job.remote.status)
}

export function latestPartJob(jobs: LocalJob[], assetId: string) {
  return jobs.filter(job => job.source?.assetId === assetId)
    .reduce<LocalJob | undefined>((latest, job) => !latest || job.createdAt > latest.createdAt ? job : latest, undefined)
}
