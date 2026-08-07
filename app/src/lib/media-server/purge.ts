/**
 * purgeMediaItem — admin "delete from server" (Part C).
 *
 * Removes a library title everywhere it could appear:
 *   1. Storage: unlink the file(s) and tidy now-empty season/series dirs (mirrors
 *      auto-delete.ts), but scoped to the explicit media_items id (and, for a series,
 *      its episode/season children) — NOT a broad tmdb_id+type file match (the D1 audit
 *      concern).
 *   2. Torrent list (best-effort): resolve hashes via grab_history.info_hash for the
 *      matching monitored_items and delete them from the download client (with files).
 *   3. DB: delete the media_items rows + their watch state, and the title's
 *      monitored_items / media_requests / grab_history / grab_results (by tmdb_id+type).
 *
 * Destructive + irreversible — callers must gate on requireAdmin + verifyOrigin.
 * 'server-only' keeps fs / the download client out of any client bundle.
 */

import 'server-only'
import fs from 'fs'
import path from 'path'
import { getDb } from '@/lib/db/index'
import { getClient } from '@/lib/download-client/registry'
import type { MediaItem } from './types'

export interface PurgeSummary {
  title: string
  filesDeleted: number
  torrentsDeleted: number
  rowsDeleted: number
  errors: string[]
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function purgeMediaItem(id: string): Promise<PurgeSummary | null> {
  const db = getDb()
  const item = db.prepare('SELECT * FROM media_items WHERE id = ?').get(id) as MediaItem | undefined
  if (!item) return null

  const summary: PurgeSummary = { title: item.title, filesDeleted: 0, torrentsDeleted: 0, rowsDeleted: 0, errors: [] }

  // Rows to remove: the item itself, plus (for a series) its episode/season children.
  const rows =
    item.type === 'series'
      ? (db.prepare('SELECT id, file_path FROM media_items WHERE id = ? OR series_id = ?')
          .all(id, id) as { id: string; file_path: string | null }[])
      : [{ id: item.id, file_path: item.file_path }]

  // --- 1. Storage: unlink files, then sibling subtitles, then empty dirs -----------------
  const dirs = new Set<string>()
  for (const r of rows) {
    if (!r.file_path) continue
    try {
      if (fs.existsSync(r.file_path)) {
        fs.unlinkSync(r.file_path)
        summary.filesDeleted++
      }
      dirs.add(path.dirname(r.file_path))
    } catch (e) {
      summary.errors.push(`file ${r.file_path}: ${msg(e)}`)
    }
  }
  for (const dir of dirs) {
    try {
      for (const f of fs.readdirSync(dir)) {
        if (/\.(srt|vtt|ass|ssa|sub)$/i.test(f)) fs.unlinkSync(path.join(dir, f))
      }
    } catch { /* dir already gone */ }
  }
  for (const dir of dirs) {
    try {
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
      const parent = path.dirname(dir)
      if (fs.readdirSync(parent).length === 0) fs.rmdirSync(parent)
    } catch { /* not empty / gone — ok */ }
  }

  // --- 2. Torrent list (best-effort): hashes via grab_history for matching monitored items ---
  const mType = item.type === 'movie' ? 'movie' : 'tv'
  if (item.tmdb_id != null) {
    try {
      const hashes = db
        .prepare(
          `SELECT DISTINCT gh.info_hash FROM grab_history gh
           JOIN monitored_items mi ON mi.id = gh.item_id
           WHERE mi.tmdb_id = ? AND mi.type = ?`,
        )
        .all(item.tmdb_id, mType) as { info_hash: string }[]
      const list = hashes.map((h) => h.info_hash).filter(Boolean)
      if (list.length > 0) {
        await getClient().deleteTorrents(list, true)
        summary.torrentsDeleted = list.length
      }
    } catch (e) {
      // qBit unreachable or hash gone — report, don't abort the rest of the purge.
      summary.errors.push(`torrent: ${msg(e)}`)
    }
  }

  // --- 3. DB: media_items + watch state, then the title's automation/request rows ----------
  const tx = db.transaction(() => {
    for (const r of rows) {
      db.prepare('DELETE FROM media_watch_state WHERE media_id = ?').run(r.id)
      db.prepare('DELETE FROM media_items WHERE id = ?').run(r.id)
      summary.rowsDeleted++
    }
    if (item.tmdb_id != null) {
      const miIds = db.prepare('SELECT id FROM monitored_items WHERE tmdb_id = ? AND type = ?')
        .all(item.tmdb_id, mType) as { id: number }[]
      for (const m of miIds) {
        db.prepare('DELETE FROM grab_results WHERE monitored_item_id = ?').run(m.id)
        db.prepare('DELETE FROM grab_history WHERE item_id = ?').run(m.id)
      }
      db.prepare('DELETE FROM monitored_items WHERE tmdb_id = ? AND type = ?').run(item.tmdb_id, mType)
      db.prepare('DELETE FROM media_requests WHERE tmdb_id = ? AND media_type = ?').run(item.tmdb_id, mType)
    }
  })
  tx()

  return summary
}
