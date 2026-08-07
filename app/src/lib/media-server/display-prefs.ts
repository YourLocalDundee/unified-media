import { getDb } from '@/lib/db/index'

export type DisplayMode = 'arcs' | 'seasons'

// Explicit per-show override, or null if the show has no stored preference (falls back to the
// caller's own default — see the discover page: arcs when TMDB has arc-grouping data, else seasons).
export function getDisplayModeOverride(tmdbId: number): DisplayMode | null {
  const row = getDb()
    .prepare('SELECT mode FROM show_display_prefs WHERE tmdb_id = ?')
    .get(tmdbId) as { mode: DisplayMode } | undefined
  return row?.mode ?? null
}

export function setDisplayModeOverride(tmdbId: number, mode: DisplayMode): void {
  getDb()
    .prepare(
      `INSERT INTO show_display_prefs (tmdb_id, mode, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(tmdb_id) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at`,
    )
    .run(tmdbId, mode, Date.now())
}
