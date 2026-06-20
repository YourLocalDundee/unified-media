import crypto from 'crypto'

export type JobStatus = 'queued' | 'running' | 'done' | 'failed'

export interface JobRecord {
  id: string
  label: string
  status: JobStatus
  result?: unknown
  error?: string
  queuedAt: number
  startedAt?: number
  finishedAt?: number
}

const MAX_CONCURRENCY = 1
const JOB_TTL_MS = 60 * 60 * 1000 // keep completed jobs 1h

const jobs = new Map<string, JobRecord>()
let running = 0
const pending: Array<() => void> = []

function purgeExpired() {
  const cutoff = Date.now() - JOB_TTL_MS
  for (const [id, job] of jobs) {
    if (job.status !== 'queued' && job.status !== 'running' && (job.finishedAt ?? 0) < cutoff) {
      jobs.delete(id)
    }
  }
}

function drain() {
  if (running >= MAX_CONCURRENCY || pending.length === 0) return
  const run = pending.shift()!
  void run()
}

export function enqueue<T>(label: string, fn: () => Promise<T>): JobRecord {
  purgeExpired()
  const id = crypto.randomBytes(8).toString('hex')
  const record: JobRecord = { id, label, status: 'queued', queuedAt: Date.now() }
  jobs.set(id, record)

  pending.push(async () => {
    running++
    record.status = 'running'
    record.startedAt = Date.now()
    try {
      record.result = await fn()
      record.status = 'done'
    } catch (err) {
      record.error = String(err)
      record.status = 'failed'
    } finally {
      record.finishedAt = Date.now()
      running--
      drain()
    }
  })

  drain()
  return { ...record }
}

export function getJob(id: string): JobRecord | undefined {
  return jobs.get(id)
}
