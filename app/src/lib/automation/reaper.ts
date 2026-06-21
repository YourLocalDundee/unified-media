/**
 * Stalled-metadata reaper (Regression 2).
 *
 * Torrents stuck in metaDL/forcedMetaDL with no peers never make progress and otherwise pile up
 * forever (nothing else removes them). This reaper is deliberately conservative:
 *   - ONLY metaDL / forcedMetaDL states — no data has been written yet.
 *   - ONLY when num_seeds === 0 AND num_leechs === 0 — genuinely no peers.
 *   - ONLY when older than the configurable threshold (app_settings 'reaper_metadata_minutes',
 *     default 60) — read each tick so it can be tuned at runtime without a redeploy.
 *   - Torrent-only delete (deleteFiles=false) — a metadata-stuck torrent has no files anyway.
 * It never touches a torrent that has peers, is downloading, or is seeding.
 *
 * Called every 10 minutes by scheduler.ts (dynamic import keeps the qBit session module out of the
 * initial server module graph).
 */

import { getSetting } from '@/lib/settings'

const REAPER_SETTING_KEY = 'reaper_metadata_minutes'
const DEFAULT_REAPER_MINUTES = 60

export function getReaperThresholdMinutes(): number {
  const raw = parseInt(getSetting(REAPER_SETTING_KEY, String(DEFAULT_REAPER_MINUTES)), 10)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_REAPER_MINUTES
}

interface ReapTorrent {
  hash: string
  name: string
  state: string
  added_on: number   // unix SECONDS
  num_seeds: number
  num_leechs: number
}

export async function reapStalledMetadata(): Promise<number> {
  const thresholdMs = getReaperThresholdMinutes() * 60 * 1000
  const { qbitFetch } = await import('@/lib/qbittorrent/session')

  let torrents: ReapTorrent[]
  try {
    torrents = await qbitFetch<ReapTorrent[]>('/api/v2/torrents/info')
  } catch (err) {
    process.stderr.write(`[reaper] qBittorrent unavailable: ${err instanceof Error ? err.message : String(err)}\n`)
    return 0
  }

  const cutoff = Date.now() - thresholdMs
  const dead = torrents.filter(
    (t) =>
      (t.state === 'metaDL' || t.state === 'forcedMetaDL') &&
      (t.num_seeds ?? 0) === 0 &&
      (t.num_leechs ?? 0) === 0 &&
      typeof t.added_on === 'number' &&
      t.added_on > 0 &&
      t.added_on * 1000 < cutoff,
  )
  if (dead.length === 0) return 0

  try {
    await qbitFetch<string>('/api/v2/torrents/delete', {
      method: 'POST',
      body: new URLSearchParams({ hashes: dead.map((t) => t.hash).join('|'), deleteFiles: 'false' }),
    })
  } catch (err) {
    process.stderr.write(`[reaper] delete failed: ${err instanceof Error ? err.message : String(err)}\n`)
    return 0
  }

  for (const t of dead) {
    const ageMin = Math.round((Date.now() - t.added_on * 1000) / 60000)
    process.stderr.write(
      `[reaper] removed stalled-metadata torrent "${t.name.replace(/[\r\n]/g, ' ')}" (${t.hash}) — 0 peers, age ${ageMin}min\n`,
    )
  }
  return dead.length
}
