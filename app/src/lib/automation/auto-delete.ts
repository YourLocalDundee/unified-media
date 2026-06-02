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

export async function runAutoDelete(): Promise<number> {
  const db = getDb()
  const now = Date.now()

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

      // Delete files from disk
      const dirs = new Set<string>()
      for (const item of items) {
        if (item.file_path && fs.existsSync(item.file_path)) {
          fs.unlinkSync(item.file_path)
          dirs.add(path.dirname(item.file_path))
        }
        db.prepare('DELETE FROM media_items WHERE id = ?').run(item.id)
      }
      // Also delete subtitle files alongside each video file
      for (const dir of dirs) {
        try {
          for (const f of fs.readdirSync(dir)) {
            if (/\.(srt|vtt|ass|ssa|sub)$/i.test(f)) {
              fs.unlinkSync(path.join(dir, f))
            }
          }
        } catch { /* dir already cleaned or gone */ }
      }

      // Remove empty directories (season dirs for TV, movie dir)
      for (const dir of dirs) {
        try {
          const remaining = fs.readdirSync(dir)
          if (remaining.length === 0) fs.rmdirSync(dir)
          // Try parent too (show root for TV)
          const parent = path.dirname(dir)
          const parentFiles = fs.readdirSync(parent)
          if (parentFiles.length === 0) fs.rmdirSync(parent)
        } catch { /* directory not empty or already gone — ok */ }
      }

      // Mark request expired — slot is now free
      db.prepare(
        `UPDATE media_requests SET status = 'expired', auto_delete_at = NULL WHERE id = ?`
      ).run(req.id)

      console.log(`[auto-delete] Removed "${req.title}" (tmdb:${req.tmdb_id})`)
      deleted++
    } catch (err) {
      console.error(`[auto-delete] Failed to delete request ${req.id}:`, err)
    }
  }

  return deleted
}
