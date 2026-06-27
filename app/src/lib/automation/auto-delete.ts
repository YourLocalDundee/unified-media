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

// C-4: configured library roots (colon-separated container paths, e.g. /media/movies:/media/tv).
// The empty-dir cleanup below only removes directories that live STRICTLY inside one of these, so
// it can never delete a media root itself or walk upward past the boundary.
const MEDIA_ROOTS = (process.env.MEDIA_ROOTS ?? '')
  .split(':')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((p) => path.resolve(p))

function isPrunableDir(dir: string): boolean {
  const resolved = path.resolve(dir)
  return MEDIA_ROOTS.some((root) => resolved !== root && resolved.startsWith(root + path.sep))
}

interface ExpiredRequest {
  id: number
  tmdb_id: number
  media_type: string
  title: string
  created_at: number
}

// Returns the number of requests successfully deleted during this run.
export async function runAutoDelete(): Promise<number> {
  const db = getDb()
  const now = Date.now()

  // auto_approved=1 guards against accidentally deleting long-term requests that
  // somehow got an auto_delete_at set; only quick-mode content has this flag.
  const expired = db.prepare(
    `SELECT id, tmdb_id, media_type, title, created_at FROM media_requests
     WHERE auto_approved = 1 AND status = 'available'
     AND auto_delete_at IS NOT NULL AND auto_delete_at <= ?`
  ).all(now) as ExpiredRequest[]

  if (expired.length === 0) return 0

  let deleted = 0

  for (const req of expired) {
    try {
      // D1 (ownership guard #1 — shared content). The old code matched media_items by tmdb_id+type
      // ONLY, so an expiring quick request could delete files a *different* request still depends on
      // (another user's request, or a long-term request for the same title). If any other
      // non-terminal request references this title, free this slot but leave the files alone.
      const sharedWithOther = db.prepare(
        `SELECT 1 FROM media_requests
         WHERE tmdb_id = ? AND media_type = ? AND id <> ?
         AND status NOT IN ('expired', 'declined') LIMIT 1`
      ).get(req.tmdb_id, req.media_type, req.id)
      if (sharedWithOther) {
        db.prepare(
          `UPDATE media_requests SET status = 'expired', auto_delete_at = NULL WHERE id = ?`
        ).run(req.id)
        console.log(`[auto-delete] Freed slot for "${req.title}" (tmdb:${req.tmdb_id}); kept files — another active request references this title`)
        deleted++
        continue
      }

      // For TV: episode rows (type='episode') hold actual file_path values.
      // The series stub row (type='series') has file_path=NULL and must also
      // be deleted, but has no file to unlink.
      const items = req.media_type === 'movie'
        ? db.prepare(
            'SELECT id, file_path, added_at FROM media_items WHERE tmdb_id = ? AND type = ?'
          ).all(req.tmdb_id, 'movie') as { id: string; file_path: string | null; added_at: number }[]
        : db.prepare(
            `SELECT id, file_path, added_at FROM media_items
             WHERE tmdb_id = ? AND type IN ('episode', 'series')`
          ).all(req.tmdb_id) as { id: string; file_path: string | null; added_at: number }[]

      // Collect unique parent directories so we can clean up subtitles and empty dirs after
      const dirs = new Set<string>()
      for (const item of items) {
        // D1 (ownership guard #2 — pre-existing library). Only remove content this request brought
        // in. Anything added before the request was created is library the user already had, so it
        // is never touched. This also scopes a single-episode quick request to just that episode
        // instead of nuking every episode of a series that shares the tmdb_id.
        if (item.added_at < req.created_at) continue
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
      // C-4: each rmdir is gated on isPrunableDir so a momentarily-empty intermediate — or the
      // MEDIA_ROOTS boundary itself — is never removed by the upward walk.
      for (const dir of dirs) {
        try {
          if (isPrunableDir(dir) && fs.readdirSync(dir).length === 0) {
            fs.rmdirSync(dir)
          }
          const parent = path.dirname(dir)
          if (isPrunableDir(parent) && fs.readdirSync(parent).length === 0) {
            fs.rmdirSync(parent)
          }
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
