import type { LocalJob } from './jobs'

export function jobStatus(job: LocalJob) {
  if (job.model) return 'succeeded'
  if (job.optimizing) return 'optimizing'
  if (job.postprocessCancelled) return 'cancelled'
  if (job.resultRejected || job.error) return 'failed'
  // A remote success still needs to be downloaded and persisted locally.
  if (job.remote?.status === 'succeeded') return 'receiving'
  return job.remote?.status ?? 'undefined'
}

export function jobRunning(job: LocalJob) {
  return !!job.optimizing || !job.model && !!job.remote && ['queued', 'running', 'cancel_requested'].includes(job.remote.status)
}

export function latestPartJob(jobs: LocalJob[], assetId: string) {
  return jobs.filter(job => job.source?.assetId === assetId)
    .reduce<LocalJob | undefined>((latest, job) => !latest || job.createdAt > latest.createdAt ? job : latest, undefined)
}
