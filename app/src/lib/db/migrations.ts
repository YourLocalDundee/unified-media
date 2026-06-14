/**
 * runMigrations — single entry point for all SQLite schema setup.
 *
 * All CREATE TABLE statements use IF NOT EXISTS so the function is safe to call
 * on every app start. Column additions use ALTER TABLE wrapped in try/catch so
 * they silently no-op on databases that already have the column.
 *
 * SQLite cannot ALTER a CHECK constraint after creation. When a CHECK widening
 * is needed (e.g. adding 'expired' to media_requests.status), the affected
 * table is recreated inside a BEGIN...COMMIT transaction and data is copied.
 * A guard checks the current schema text before running the recreation to make
 * the block idempotent.
 */
import type Database from 'better-sqlite3'

export function runMigrations(db: Database.Database): void {
  // --------------------------------------------------------------------------
  // Core auth tables
  // --------------------------------------------------------------------------
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
    -- Durable fixed-window rate-limit buckets. Backs lib/rate-limit.ts so the
    -- limits survive deploys/restarts and are shared across instances, instead of
    -- living in a per-process Map that resets on every restart (A1-005).
    CREATE TABLE IF NOT EXISTS rate_limits (
      key       TEXT PRIMARY KEY,
      count     INTEGER NOT NULL,
      reset_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits(reset_at);
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

  // --------------------------------------------------------------------------
  // Independence build tables — replace external *arr / Jellyfin services
  // --------------------------------------------------------------------------

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

  // NOTE: watch_events.position_ticks is added in the addCols block at the bottom of this
  // function along with all other additive column migrations. It is placed there so that the
  // ordering is consistent — all ALTER TABLE statements run after every CREATE TABLE.

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

  // Grab results — stores search candidates for each monitored item grab attempt
  db.exec(`
    CREATE TABLE IF NOT EXISTS grab_results (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      monitored_item_id  INTEGER NOT NULL,
      searched_at        INTEGER NOT NULL,
      candidates         TEXT NOT NULL DEFAULT '[]',
      selected_hash      TEXT,
      total_found        INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_grab_results_item ON grab_results(monitored_item_id, searched_at);
  `)

  // PIECE 1: new quality system tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS quality_tiers (
      id     INTEGER PRIMARY KEY,
      name   TEXT NOT NULL UNIQUE,
      label  TEXT NOT NULL,
      weight INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS custom_formats (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      name  TEXT NOT NULL UNIQUE,
      specs TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS quality_profile_formats (
      profile_id INTEGER NOT NULL,
      format_id  INTEGER NOT NULL,
      score      INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (profile_id, format_id)
    );
  `)

  // Additive columns for quality_profiles (new system fields)
  const qpCols = [
    'ALTER TABLE quality_profiles ADD COLUMN upgrade_allowed INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE quality_profiles ADD COLUMN cutoff_quality_id INTEGER',
    'ALTER TABLE quality_profiles ADD COLUMN min_format_score INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE quality_profiles ADD COLUMN cutoff_format_score INTEGER NOT NULL DEFAULT 0',
  ]
  for (const sql of qpCols) {
    try { db.exec(sql) } catch { /* already exists */ }
  }

  // Seed canonical quality tiers (weight matches Sonarr's DefaultQualityDefinitions ordering)
  const insertTier = db.prepare(
    'INSERT OR IGNORE INTO quality_tiers (id, name, label, weight) VALUES (?, ?, ?, ?)'
  )
  const tiers: [number, string, string, number][] = [
    [1,  'Unknown',          'Unknown',           1],
    [2,  'SDTV',             'SDTV',              2],
    [3,  'WEBRip-480p',      'WEBRip-480p',       3],
    [4,  'WEBDL-480p',       'WEBDL-480p',        3],
    [5,  'DVD',              'DVD',               4],
    [6,  'Bluray-480p',      'Bluray-480p',       5],
    [7,  'WEBRip-720p',      'WEBRip-720p',       7],
    [8,  'WEBDL-720p',       'WEBDL-720p',        8],
    [9,  'HDTV-720p',        'HDTV-720p',         7],
    [10, 'Bluray-720p',      'Bluray-720p',       9],
    [11, 'HDTV-1080p',       'HDTV-1080p',        10],
    [12, 'WEBRip-1080p',     'WEBRip-1080p',      11],
    [13, 'WEBDL-1080p',      'WEBDL-1080p',       12],
    [14, 'Bluray-1080p',     'Bluray-1080p',      13],
    [15, 'Bluray-1080p-Remux','Bluray-1080p-Remux',14],
    [16, 'WEBDL-2160p',      'WEBDL-2160p',       15],
    [17, 'WEBRip-2160p',     'WEBRip-2160p',      15],
    [18, 'Bluray-2160p',     'Bluray-2160p',       17],
    [19, 'Bluray-2160p-Remux','Bluray-2160p-Remux',18],
  ]
  for (const row of tiers) insertTier.run(...row)

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
  // request_type: 'quick' = auto-approved + auto-deleted after 48h (old content only, slot-limited)
  //               'longterm' = admin approval required, never auto-deleted
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
      request_type TEXT DEFAULT 'longterm',
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
    "ALTER TABLE media_requests ADD COLUMN request_type TEXT DEFAULT 'longterm'",
    // PIECE 3: store the release the user picked in the torrent picker modal
    'ALTER TABLE media_requests ADD COLUMN preferred_release TEXT',
    // PIECE 3 (two-dimension model): 'auto-pick' | 'interactive'
    "ALTER TABLE media_requests ADD COLUMN request_method TEXT NOT NULL DEFAULT 'auto-pick'",
    // PIECE 4: per-request language constraint ('any' = no constraint; ISO 639-1 code = strict filter)
    "ALTER TABLE media_requests ADD COLUMN language TEXT NOT NULL DEFAULT 'any'",
  ]
  for (const sql of requestCols) {
    try { db.exec(sql) } catch { /* already exists */ }
  }

  // Widen media_requests.status CHECK to include 'expired' (auto-delete terminal state).
  // SQLite cannot ALTER a CHECK constraint, so recreate the table if the old constraint is present.
  // The new DDL includes every column. The INSERT is built dynamically so scope columns that may
  // not exist yet on very old databases are excluded from the SELECT rather than causing an error.
  // requestCols always runs before this block, so preferred_release/request_method/language exist.
  {
    const tblInfo = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='media_requests'"
    ).get() as { sql: string } | undefined
    if (tblInfo && !tblInfo.sql.includes("'expired'")) {
      const existingCols = new Set(
        (db.prepare('PRAGMA table_info(media_requests)').all() as { name: string }[])
          .map((r) => r.name)
      )
      const scopeCols = ['scope_type', 'scope_seasons', 'scope_episodes', 'monitor_future']
        .filter((c) => existingCols.has(c))

      const insertCols = [
        'id', 'user_id', 'tmdb_id', 'media_type', 'title', 'year',
        'poster_path', 'overview', 'seasons', 'status', 'created_at', 'updated_at',
        'auto_approved', 'auto_delete_at', 'available_at', 'release_date', 'request_type',
        'preferred_release', 'request_method', 'language',
        ...scopeCols,
      ].join(', ')

      const selectExprs = [
        'id', 'user_id', 'tmdb_id', 'media_type', 'title', 'year',
        'poster_path', 'overview', 'seasons', 'status', 'created_at', 'updated_at',
        'COALESCE(auto_approved, 0)', 'auto_delete_at', 'available_at', 'release_date',
        "COALESCE(request_type, 'longterm')",
        'preferred_release',
        "COALESCE(request_method, 'auto-pick')",
        "COALESCE(language, 'any')",
        ...scopeCols,
      ].join(', ')

      db.exec('BEGIN')
      try {
        db.exec(`
          CREATE TABLE media_requests_new (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id          TEXT NOT NULL,
            tmdb_id          INTEGER NOT NULL,
            media_type       TEXT NOT NULL CHECK(media_type IN ('movie','tv')),
            title            TEXT NOT NULL,
            year             INTEGER,
            poster_path      TEXT,
            overview         TEXT,
            seasons          TEXT,
            status           TEXT NOT NULL DEFAULT 'pending'
                               CHECK(status IN ('pending','approved','declined','available','expired')),
            created_at       INTEGER NOT NULL,
            updated_at       INTEGER NOT NULL,
            auto_approved    INTEGER DEFAULT 0,
            auto_delete_at   INTEGER,
            available_at     INTEGER,
            release_date     TEXT,
            request_type     TEXT DEFAULT 'longterm',
            preferred_release TEXT,
            request_method   TEXT NOT NULL DEFAULT 'auto-pick',
            language         TEXT NOT NULL DEFAULT 'any',
            scope_type       TEXT DEFAULT 'full',
            scope_seasons    TEXT,
            scope_episodes   TEXT,
            monitor_future   INTEGER DEFAULT 0,
            UNIQUE(user_id, tmdb_id, media_type)
          )
        `)
        db.exec(`INSERT INTO media_requests_new (${insertCols}) SELECT ${selectExprs} FROM media_requests`)
        db.exec('DROP TABLE media_requests')
        db.exec('ALTER TABLE media_requests_new RENAME TO media_requests')
        db.exec('CREATE INDEX IF NOT EXISTS idx_media_requests_user ON media_requests(user_id)')
        db.exec('CREATE INDEX IF NOT EXISTS idx_media_requests_status ON media_requests(status)')
        db.exec('CREATE INDEX IF NOT EXISTS idx_media_requests_tmdb ON media_requests(tmdb_id, media_type)')
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
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

  // Party Play — durable membership and existence (live position lives in memory).
  //
  // FK enforcement (M11): foreign_keys=ON is set per-connection (src/lib/db/index.ts),
  // so the FOREIGN KEY clauses below are REAL constraints, not documentation. A FRESH
  // database gets them enforced — deleting a user/media_items row is blocked (or, for
  // members, cascades) instead of orphaning party rows.
  //
  // EXISTING deployments keep their current FK-less tables: CREATE TABLE IF NOT EXISTS
  // does NOT alter a table that already exists, so already-deployed DBs retain
  // logical-only relationships. Recreation (the BEGIN...COMMIT copy pattern used for
  // the media_requests CHECK widening) is DELIBERATELY avoided here — a live party may
  // be in progress, and dropping/recreating watch_parties mid-session would destroy
  // an active viewing session and its checkpoint. Fresh-DB-only enforcement is the
  // safest correct choice; the risk of a live recreation outweighs the benefit of
  // retrofitting FKs onto existing rows that the synchronous single writer already
  // keeps consistent.
  db.exec(`
    CREATE TABLE IF NOT EXISTS watch_parties (
      id                  TEXT PRIMARY KEY,           -- opaque 32-char id (makeId(32))
      join_code           TEXT UNIQUE NOT NULL,       -- short shareable 6-char code
      host_user_id        TEXT NOT NULL,              -- creator, host-only powers
      media_id            TEXT NOT NULL,              -- the item being watched
      status              TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active','ended')),
      created_at          INTEGER NOT NULL,
      updated_at          INTEGER NOT NULL,
      ended_at            INTEGER,
      last_position_ticks INTEGER NOT NULL DEFAULT 0, -- checkpoint for restart recovery only
      last_paused         INTEGER NOT NULL DEFAULT 1, -- checkpoint for restart recovery only
      FOREIGN KEY (host_user_id) REFERENCES users(id),
      FOREIGN KEY (media_id)     REFERENCES media_items(id)
    );
    -- join_code is UNIQUE, which already creates an implicit index backing both the
    -- collision probe and the by-code lookup, so no separate idx_watch_parties_code (L1).
    CREATE INDEX IF NOT EXISTS idx_watch_parties_status ON watch_parties(status);

    CREATE TABLE IF NOT EXISTS watch_party_members (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      party_id      TEXT NOT NULL,
      user_id       TEXT NOT NULL,
      joined_at     INTEGER NOT NULL,
      left_at       INTEGER,
      is_host       INTEGER NOT NULL DEFAULT 0,
      UNIQUE(party_id, user_id),                      -- makes join idempotent (reactivate, not duplicate)
      FOREIGN KEY (party_id) REFERENCES watch_parties(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)  REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_watch_party_members_party ON watch_party_members(party_id);
  `)

  // --------------------------------------------------------------------------
  // Additive column migrations — ALL placed here so every table exists before
  // any ALTER TABLE runs. Each statement is wrapped in try/catch so re-runs on
  // an existing DB silently no-op (better-sqlite3 throws on duplicate columns).
  // --------------------------------------------------------------------------
  const addCols = [
    // users — profile fields added post-launch
    'ALTER TABLE users ADD COLUMN display_name TEXT',
    'ALTER TABLE users ADD COLUMN first_name TEXT',
    'ALTER TABLE users ADD COLUMN last_name TEXT',
    'ALTER TABLE users ADD COLUMN bio TEXT',
    'ALTER TABLE users ADD COLUMN location TEXT',
    // sessions — device label for the sessions UI
    'ALTER TABLE sessions ADD COLUMN device_name TEXT',
    // watch_events — resume-position tick counter for native media server
    'ALTER TABLE watch_events ADD COLUMN position_ticks INTEGER',
    // indexers — extended fields added in later phases
    'ALTER TABLE indexers ADD COLUMN requires_auth INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE indexers ADD COLUMN requires_flaresolverr INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE indexers ADD COLUMN search_type TEXT NOT NULL DEFAULT 'torznab'",
    'ALTER TABLE indexers ADD COLUMN description TEXT',
    'ALTER TABLE indexers ADD COLUMN pending_credentials TEXT',
    'ALTER TABLE indexers ADD COLUMN base_url TEXT',
    // quality_profiles — language constraint for per-profile language filtering
    "ALTER TABLE quality_profiles ADD COLUMN language TEXT NOT NULL DEFAULT 'any'",
    // monitored_items — download completion timestamp for 48h auto-delete timer
    'ALTER TABLE monitored_items ADD COLUMN download_completed_at INTEGER',
    // monitored_items — TV series scope (full / seasons / episodes)
    "ALTER TABLE monitored_items ADD COLUMN scope_type TEXT DEFAULT 'full'",
    'ALTER TABLE monitored_items ADD COLUMN scope_seasons TEXT',
    'ALTER TABLE monitored_items ADD COLUMN scope_episodes TEXT',
    'ALTER TABLE monitored_items ADD COLUMN monitor_future INTEGER DEFAULT 0',
    // media_requests — mirrors monitored_items scope columns
    "ALTER TABLE media_requests ADD COLUMN scope_type TEXT DEFAULT 'full'",
    'ALTER TABLE media_requests ADD COLUMN scope_seasons TEXT',
    'ALTER TABLE media_requests ADD COLUMN scope_episodes TEXT',
    'ALTER TABLE media_requests ADD COLUMN monitor_future INTEGER DEFAULT 0',
    // media_items — enrichment fields from TMDB
    'ALTER TABLE media_items ADD COLUMN episode_title TEXT',
    'ALTER TABLE media_items ADD COLUMN genres TEXT',
  ]
  for (const sql of addCols) {
    try { db.exec(sql) } catch { /* column already exists — safe to ignore */ }
  }
}
