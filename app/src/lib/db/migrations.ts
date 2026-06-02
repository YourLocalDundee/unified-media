import type Database from 'better-sqlite3'

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      email         TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'user',
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      last_login    INTEGER,
      is_active     INTEGER NOT NULL DEFAULT 1,
      invite_used   TEXT,
      force_pw_change INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS invite_codes (
      code          TEXT PRIMARY KEY,
      created_by    TEXT NOT NULL,
      label         TEXT,
      max_uses      INTEGER DEFAULT 1,
      use_count     INTEGER DEFAULT 0,
      used_by       TEXT,
      used_at       INTEGER,
      expires_at    INTEGER,
      created_at    INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      ip_address    TEXT,
      user_agent    TEXT,
      created_at    INTEGER NOT NULL,
      expires_at    INTEGER NOT NULL,
      last_seen     INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       TEXT,
      username      TEXT,
      event_type    TEXT NOT NULL,
      details       TEXT,
      ip_address    TEXT,
      country       TEXT,
      city          TEXT,
      created_at    INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS watch_events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       TEXT NOT NULL,
      item_id       TEXT NOT NULL,
      item_title    TEXT NOT NULL,
      series_title  TEXT,
      item_type     TEXT NOT NULL,
      season_num    INTEGER,
      episode_num   INTEGER,
      progress_pct  REAL,
      duration_sec  INTEGER,
      watched_sec   INTEGER,
      completed     INTEGER DEFAULT 0,
      started_at    INTEGER NOT NULL,
      ended_at      INTEGER
    );
    CREATE TABLE IF NOT EXISTS login_attempts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      ip_address    TEXT NOT NULL,
      username      TEXT,
      success       INTEGER NOT NULL,
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_audit_log_user_created ON audit_log(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_watch_events_user_started ON watch_events(user_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_created ON login_attempts(ip_address, created_at);
  `)

  // password reset tokens
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      token_hash  TEXT NOT NULL,
      expires_at  INTEGER NOT NULL,
      used        INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
    CREATE INDEX IF NOT EXISTS idx_password_resets_expires ON password_resets(expires_at);
  `)

  // pending email verifications (two-step registration)
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_registrations (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL,
      username      TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      code          TEXT NOT NULL,
      first_name    TEXT,
      last_name     TEXT,
      bio           TEXT,
      location      TEXT,
      attempts      INTEGER NOT NULL DEFAULT 0,
      expires_at    INTEGER NOT NULL,
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pending_reg_email ON pending_registrations(email);
    CREATE INDEX IF NOT EXISTS idx_pending_reg_expires ON pending_registrations(expires_at);
  `)

  // Additive migrations — safe to run on an existing DB
  const addCols = [
    'ALTER TABLE users ADD COLUMN display_name TEXT',
    'ALTER TABLE users ADD COLUMN first_name TEXT',
    'ALTER TABLE users ADD COLUMN last_name TEXT',
    'ALTER TABLE users ADD COLUMN bio TEXT',
    'ALTER TABLE users ADD COLUMN location TEXT',
    'ALTER TABLE sessions ADD COLUMN device_name TEXT',
    'ALTER TABLE media_items ADD COLUMN episode_title TEXT',
  ]
  for (const sql of addCols) {
    try { db.exec(sql) } catch { /* already exists */ }
  }

  // Indexer aggregation (Phase 1 independence build)
  db.exec(`
    CREATE TABLE IF NOT EXISTS indexers (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      name              TEXT NOT NULL,
      torznab_url       TEXT NOT NULL,
      api_key           TEXT NOT NULL DEFAULT '',
      enabled           INTEGER NOT NULL DEFAULT 1,
      last_health_check INTEGER,
      health_status     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_indexers_enabled ON indexers(enabled);
  `)

  // Additive migration: watch position for custom media server (future)
  try { db.exec('ALTER TABLE watch_events ADD COLUMN position_ticks INTEGER') } catch { /* already exists */ }

  // Download automation — Phase 2 independence build
  db.exec(`
    CREATE TABLE IF NOT EXISTS quality_profiles (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      conditions TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS monitored_items (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tmdb_id            INTEGER,
      tvdb_id            INTEGER,
      type               TEXT NOT NULL CHECK(type IN ('movie','tv')),
      title              TEXT NOT NULL,
      year               INTEGER,
      quality_profile_id INTEGER NOT NULL DEFAULT 1,
      root_path          TEXT NOT NULL DEFAULT '',
      monitored          INTEGER NOT NULL DEFAULT 1,
      status             TEXT NOT NULL DEFAULT 'wanted' CHECK(status IN ('wanted','grabbed','imported','ignored')),
      created_at         INTEGER NOT NULL,
      updated_at         INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_monitored_status ON monitored_items(status);
    CREATE INDEX IF NOT EXISTS idx_monitored_tmdb ON monitored_items(tmdb_id);

    CREATE TABLE IF NOT EXISTS grab_history (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id       INTEGER NOT NULL,
      indexer       TEXT NOT NULL,
      release_title TEXT NOT NULL,
      info_hash     TEXT NOT NULL,
      grabbed_at    INTEGER NOT NULL,
      import_status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE INDEX IF NOT EXISTS idx_grab_history_item ON grab_history(item_id);
    CREATE INDEX IF NOT EXISTS idx_grab_history_grabbed ON grab_history(grabbed_at);
  `)

  // Seed default quality profiles (safe — INSERT OR IGNORE)
  const seedProfiles = db.prepare(
    "INSERT OR IGNORE INTO quality_profiles (name, conditions) VALUES (?, ?)"
  )
  seedProfiles.run('Any', '[]')
  seedProfiles.run('1080p', JSON.stringify([{ type: 'resolution', value: '1080p', required: true }]))
  seedProfiles.run('4K',    JSON.stringify([{ type: 'resolution', value: '2160p', required: true }]))

  // Subtitle management — Phase 4 independence build
  db.exec(`
    CREATE TABLE IF NOT EXISTS subtitle_wants (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      jellyfin_item_id     TEXT NOT NULL,
      jellyfin_item_type   TEXT NOT NULL DEFAULT 'Movie',
      title                TEXT NOT NULL,
      imdb_id              TEXT,
      media_path           TEXT,
      language             TEXT NOT NULL DEFAULT 'en',
      forced               INTEGER NOT NULL DEFAULT 0,
      hi                   INTEGER NOT NULL DEFAULT 0,
      status               TEXT NOT NULL DEFAULT 'wanted'
        CHECK(status IN ('wanted','downloaded','skipped','failed')),
      subtitle_file_id     INTEGER,
      subtitle_path        TEXT,
      created_at           INTEGER NOT NULL,
      updated_at           INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_subtitle_wants_status ON subtitle_wants(status);
    CREATE INDEX IF NOT EXISTS idx_subtitle_wants_item ON subtitle_wants(jellyfin_item_id, language);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_subtitle_wants_unique
      ON subtitle_wants(jellyfin_item_id, language, forced, hi);
  `)

  // Media requests — Phase 7 independence build
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_requests (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     TEXT NOT NULL,
      tmdb_id     INTEGER NOT NULL,
      media_type  TEXT NOT NULL CHECK(media_type IN ('movie','tv')),
      title       TEXT NOT NULL,
      year        INTEGER,
      poster_path TEXT,
      overview    TEXT,
      seasons     TEXT,
      status      TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending','approved','declined','available','expired')),
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      UNIQUE(user_id, tmdb_id, media_type)
    );
    CREATE INDEX IF NOT EXISTS idx_media_requests_user ON media_requests(user_id);
    CREATE INDEX IF NOT EXISTS idx_media_requests_status ON media_requests(status);
    CREATE INDEX IF NOT EXISTS idx_media_requests_tmdb ON media_requests(tmdb_id, media_type);
  `)

  // App settings — key-value store for admin-configurable options
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  // Seed defaults (INSERT OR IGNORE so re-runs are safe)
  db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('auto_approve', '0')").run()

  // Additive migrations for media_requests
  const requestCols = [
    'ALTER TABLE media_requests ADD COLUMN auto_approved INTEGER DEFAULT 0',
    'ALTER TABLE media_requests ADD COLUMN auto_delete_at INTEGER',
    'ALTER TABLE media_requests ADD COLUMN available_at INTEGER',
    'ALTER TABLE media_requests ADD COLUMN release_date TEXT',
  ]
  for (const sql of requestCols) {
    try { db.exec(sql) } catch { /* already exists */ }
  }

  // Widen media_requests.status CHECK to include 'expired' (auto-delete terminal state).
  // SQLite cannot ALTER a CHECK constraint, so recreate the table if the old constraint is present.
  {
    const tblInfo = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='media_requests'"
    ).get() as { sql: string } | undefined
    if (tblInfo && !tblInfo.sql.includes("'expired'")) {
      db.exec(`
        BEGIN;
        CREATE TABLE media_requests_new (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id     TEXT NOT NULL,
          tmdb_id     INTEGER NOT NULL,
          media_type  TEXT NOT NULL CHECK(media_type IN ('movie','tv')),
          title       TEXT NOT NULL,
          year        INTEGER,
          poster_path TEXT,
          overview    TEXT,
          seasons     TEXT,
          status      TEXT NOT NULL DEFAULT 'pending'
                        CHECK(status IN ('pending','approved','declined','available','expired')),
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL,
          auto_approved INTEGER DEFAULT 0,
          auto_delete_at INTEGER,
          available_at INTEGER,
          release_date TEXT,
          UNIQUE(user_id, tmdb_id, media_type)
        );
        INSERT INTO media_requests_new SELECT id, user_id, tmdb_id, media_type, title, year,
          poster_path, overview, seasons, status, created_at, updated_at,
          auto_approved, auto_delete_at, available_at, release_date
          FROM media_requests;
        DROP TABLE media_requests;
        ALTER TABLE media_requests_new RENAME TO media_requests;
        CREATE INDEX IF NOT EXISTS idx_media_requests_user ON media_requests(user_id);
        CREATE INDEX IF NOT EXISTS idx_media_requests_status ON media_requests(status);
        CREATE INDEX IF NOT EXISTS idx_media_requests_tmdb ON media_requests(tmdb_id, media_type);
        COMMIT;
      `)
    }
  }

  // Media server — Phase 5 independence build
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_items (
      id              TEXT PRIMARY KEY,           -- UUID
      type            TEXT NOT NULL               -- 'movie' | 'episode' | 'series' | 'season'
        CHECK(type IN ('movie','episode','series','season')),
      title           TEXT NOT NULL,
      sort_title      TEXT,
      year            INTEGER,
      overview        TEXT,
      runtime_ticks   INTEGER,                    -- duration in 100-nanosecond ticks (Jellyfin compat)
      tmdb_id         INTEGER,
      tvdb_id         INTEGER,
      imdb_id         TEXT,
      series_id       TEXT,                       -- FK to media_items.id for episodes
      season_number   INTEGER,
      episode_number  INTEGER,
      file_path       TEXT,                       -- absolute path to media file
      poster_path     TEXT,                       -- cached poster image path
      backdrop_path   TEXT,
      added_at        INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL,
      scanned_at      INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_media_type ON media_items(type);
    CREATE INDEX IF NOT EXISTS idx_media_tmdb ON media_items(tmdb_id);
    CREATE INDEX IF NOT EXISTS idx_media_series ON media_items(series_id);
    CREATE INDEX IF NOT EXISTS idx_media_file ON media_items(file_path);

    CREATE TABLE IF NOT EXISTS media_watch_state (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         TEXT NOT NULL,
      media_id        TEXT NOT NULL,
      position_ticks  INTEGER NOT NULL DEFAULT 0,
      played          INTEGER NOT NULL DEFAULT 0,
      play_count      INTEGER NOT NULL DEFAULT 0,
      last_played     INTEGER,
      updated_at      INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_state_user_media
      ON media_watch_state(user_id, media_id);
  `)
}
