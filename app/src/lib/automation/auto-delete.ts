/**
 * Auto-delete cron job for quick-mode requests.
 *
 * Quick requests borrow a slot in the user's media library for 48 hours. Once
 * auto_delete_at passes, this job removes the media files from disk, cleans up
 * the media_items rows, and marks the request 'expired' so the slot is freed.
 *
 * Run on an hourly cron by scheduler.ts. The 'server-only' import prevents this
 * module from being bundled into client code (it uses fs which is Node-only).
 *
 * Deletion order: files → subtitle files → empty dirs → media_items rows → request status.
 * Doing DB writes last means a crash partway through will re-try on the next hourly run
 * (auto_delete_at still <= now) at the cost of attempting to re-delete already-gone files.
 */

import 'server-only'
import fs from 'fs'
import path from 'path'
import { getDb } from '@/lib/db/index'

interface ExpiredRequest {
  id: number
  tmdb_id: number
  media_type: string
  title: string
}

// Returns the number of requests successfully deleted during this run.
export async function runAutoDelete(): Promise<number> {
  const db = getDb()
  const now = Date.now()

  // auto_approved=1 guards against accidentally deleting long-term requests that
  // somehow got an auto_delete_at set; only quick-mode content has this flag.
  const expired = db.prepare(
    `SELECT id, tmdb_id, media_type, title FROM media_requests
     WHERE auto_approved = 1 AND status = 'available'
     AND auto_delete_at IS NOT NULL AND auto_delete_at <= ?`
  ).all(now) as ExpiredRequest[]

  if (expired.length === 0) return 0

  let deleted = 0

  for (const req of expired) {
    try {
      // For TV: episode rows (type='episode') hold actual file_path values.
      // The series stub row (type='series') has file_path=NULL and must also
      // be deleted, but has no file to unlink.
      const items = req.media_type === 'movie'
        ? db.prepare(
            'SELECT id, file_path FROM media_items WHERE tmdb_id = ? AND type = ?'
          ).all(req.tmdb_id, 'movie') as { id: string; file_path: string | null }[]
        : db.prepare(
            `SELECT id, file_path FROM media_items
             WHERE tmdb_id = ? AND type IN ('episode', 'series')`
          ).all(req.tmdb_id) as { id: string; file_path: string | null }[]

      // Collect unique parent directories so we can clean up subtitles and empty dirs after
      const dirs = new Set<string>()
      for (const item of items) {
        if (item.file_path && fs.existsSync(item.file_path)) {
          fs.unlinkSync(item.file_path)
          dirs.add(path.dirname(item.file_path))
        }
        // DB row deleted regardless of whether the file existed — it shouldn't stay orphaned
        db.prepare('DELETE FROM media_items WHERE id = ?').run(item.id)
      }

      // Subtitle files share the same directory and are not tracked in media_items
      for (const dir of dirs) {
        try {
          for (const f of fs.readdirSync(dir)) {
            if (/\.(srt|vtt|ass|ssa|sub)$/i.test(f)) {
              fs.unlinkSync(path.join(dir, f))
            }
          }
        } catch { /* dir already cleaned or gone */ }
      }

      // Remove empty directories (season dirs for TV, movie dir).
      // Also try the parent in case the season dir was the only child (show root for TV).
      for (const dir of dirs) {
        try {
          const remaining = fs.readdirSync(dir)
          if (remaining.length === 0) fs.rmdirSync(dir)
          const parent = path.dirname(dir)
          const parentFiles = fs.readdirSync(parent)
          if (parentFiles.length === 0) fs.rmdirSync(parent)
        } catch { /* directory not empty or already gone — ok */ }
      }

      // Clearing auto_delete_at prevents a re-trigger if status ever gets reset accidentally
      db.prepare(
        `UPDATE media_requests SET status = 'expired', auto_delete_at = NULL WHERE id = ?`
      ).run(req.id)

      console.log(`[auto-delete] Removed "${req.title}" (tmdb:${req.tmdb_id})`)
      deleted++
    } catch (err) {
      // Per-request errors are non-fatal — log and attempt the next request
      console.error(`[auto-delete] Failed to delete request ${req.id}:`, err)
    }
  }

  return deleted
}
