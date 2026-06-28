import { getDb } from '@/lib/db/index'

// Allowlist of persistable app_settings keys. The admin settings PUT rejects anything not listed
// here so a typo'd key can't silently persist and the table can't be stuffed with arbitrary pairs
// (C-3). Add new setting keys here when introducing them.
export const KNOWN_SETTING_KEYS = new Set<string>([
  'auto_approve',
  'gate_min_seeders',
  'gate_max_size_movie_gb',
  'gate_max_size_tv_gb',
  'reaper_metadata_minutes',
  'reaper_stall_minutes',
  'reaper_max_grab_attempts',
  // Notifications (lib/notify) — fired when a requested item becomes available.
  'notify_on_available',
  'notify_discord_webhook',
  'notify_ntfy_url',
  // Import lists (lib/automation/import-lists) — Trakt API client id for trakt-type lists.
  'trakt_client_id',
])

export function getSetting(key: string, defaultValue = ''): string {
  const db = getDb()
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? defaultValue
}

export function setSetting(key: string, value: string): void {
  const db = getDb()
  db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(key, value)
}

export function getSettings(): Record<string, string> {
  const db = getDb()
  const rows = db.prepare('SELECT key, value FROM app_settings').all() as {
    key: string
    value: string
  }[]
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}
