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
import { computeScopeKey } from '@/lib/automation/scope-key'

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
    -- One watch_events row per (user, item): the native progress beacon upserts this
    -- row (A3-01) instead of appending, so /history shows distinct items, not a flood.
    -- watch_events has had no writer until now, so existing DBs hold no duplicate rows.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_events_user_item ON watch_events(user_id, item_id);
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
      status             TEXT NOT NULL DEFAULT 'wanted' CHECK(status IN ('wanted','grabbing','grabbed','imported','ignored')),
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

  // Decision gate-chain (feature 1) — releases that must never be (auto-)grabbed again.
  // Keyed by lowercased info_hash. Populated by the metadata reaper (dead stuck torrents)
  // and by the admin "block release" action; the grabber gates every candidate against it.
  db.exec(`
    CREATE TABLE IF NOT EXISTS grab_blocklist (
      info_hash  TEXT PRIMARY KEY,
      title      TEXT,
      reason     TEXT,
      blocked_at INTEGER NOT NULL
    );
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
  // Stalled-metadata reaper threshold in minutes (Regression 2). Tunable at runtime via setSetting
  // without a redeploy; the reaper cron reads it each tick.
  db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('reaper_metadata_minutes', '60')").run()

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
    -- Composite for per-season episode fetch + next-episode/resume ordering (A3-17).
    CREATE INDEX IF NOT EXISTS idx_media_series_season_ep ON media_items(series_id, season_number, episode_number);

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

    -- Party Play shared queue (feature 3). Durable mirror of the in-memory queue so a server
    -- restart rehydrates "up next". Ordered by position (0-based, gap-free after each mutation).
    CREATE TABLE IF NOT EXISTS watch_party_queue (
      id           TEXT PRIMARY KEY,                  -- queue item id (uuid)
      party_id     TEXT NOT NULL,
      media_id     TEXT NOT NULL,
      title        TEXT,
      position     INTEGER NOT NULL,
      added_by     TEXT NOT NULL,
      added_by_name TEXT,
      added_at     INTEGER NOT NULL,
      FOREIGN KEY (party_id) REFERENCES watch_parties(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_watch_party_queue_party ON watch_party_queue(party_id, position);
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
    // monitored_items — per-item language constraint ('any' = no constraint; ISO 639-1 = strict).
    // The grab cron passes this to grabItem so background grabs honor the chosen language.
    "ALTER TABLE monitored_items ADD COLUMN language TEXT NOT NULL DEFAULT 'any'",
    // media_requests — mirrors monitored_items scope columns
    "ALTER TABLE media_requests ADD COLUMN scope_type TEXT DEFAULT 'full'",
    'ALTER TABLE media_requests ADD COLUMN scope_seasons TEXT',
    'ALTER TABLE media_requests ADD COLUMN scope_episodes TEXT',
    'ALTER TABLE media_requests ADD COLUMN monitor_future INTEGER DEFAULT 0',
    // scope_label — human arc/saga name for a TMDB episode-group ("arc") grab, e.g. "Impel Down".
    // NULL for plain season/full/movie scopes. Lets the Requests UI show the arc the user picked
    // rather than the merged TMDB season that bundles multiple arcs (Bug 7). Stored on both tables.
    'ALTER TABLE monitored_items ADD COLUMN scope_label TEXT',
    'ALTER TABLE media_requests ADD COLUMN scope_label TEXT',
    // media_items — enrichment fields from TMDB
    'ALTER TABLE media_items ADD COLUMN episode_title TEXT',
    'ALTER TABLE media_items ADD COLUMN genres TEXT',
    // monitored_items — A6-02 scope-aware dedup discriminator (backfilled + uniquely indexed below)
    "ALTER TABLE monitored_items ADD COLUMN scope_key TEXT NOT NULL DEFAULT ''",
    // grab_results — decision gate-chain: why a search attempt did not produce a grab.
    // null = successful grab (selected_hash is set); non-null = specific skip reason.
    // Values: 'no_results' | 'scope_mismatch' | 'language_mismatch' | 'quality_reject' | 'degenerate_scope'
    'ALTER TABLE grab_results ADD COLUMN skip_reason TEXT',
    // media_requests — quality profile the user chose at request time; forwarded to monitored_items.
    // NULL means "use the default profile" (ID 1 — 'Any'). Rows created before this migration
    // stay NULL and the existing behaviour (quality_profile_id: 1) is preserved.
    'ALTER TABLE media_requests ADD COLUMN quality_profile_id INTEGER',
    // media_items — TMDB enrichment fields for sort/filter support on browse + library pages.
    // Populated by enricher.ts; NULL until an enrichment run completes for that item.
    'ALTER TABLE media_items ADD COLUMN popularity REAL',
    'ALTER TABLE media_items ADD COLUMN vote_average REAL',
    'ALTER TABLE media_items ADD COLUMN vote_count INTEGER',
    // quality_profiles — user-owned profiles. NULL = admin-shared (visible to all users).
    // Non-null = private to that user_id. Existing profiles keep NULL (shared).
    'ALTER TABLE quality_profiles ADD COLUMN user_id TEXT',
    // users — preferred quality profile for auto-grab requests. NULL = no preference (uses "Any").
    'ALTER TABLE users ADD COLUMN default_quality_profile_id INTEGER',
  ]
  for (const sql of addCols) {
    try { db.exec(sql) } catch { /* column already exists — safe to ignore */ }
  }

  // --------------------------------------------------------------------------
  // D3 — widen monitored_items.status CHECK to include 'grabbing' (atomic claim
  // state for the immediate-grab-vs-cron race). SQLite cannot ALTER a CHECK
  // constraint, so recreate the table if the old constraint is present. Mirrors
  // the media_requests widening above: runs AFTER all additive columns exist so
  // the new DDL/INSERT covers every column, and BEFORE the dedup/unique-index
  // block below (which recreates idx_monitored_scope_unique idempotently). The
  // base indexes are recreated here; the unique scope index is recreated below.
  // --------------------------------------------------------------------------
  {
    const tblInfo = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='monitored_items'"
    ).get() as { sql: string } | undefined
    if (tblInfo && !tblInfo.sql.includes("'grabbing'")) {
      db.exec('BEGIN')
      try {
        db.exec(`
          CREATE TABLE monitored_items_new (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            tmdb_id            INTEGER,
            tvdb_id            INTEGER,
            type               TEXT NOT NULL CHECK(type IN ('movie','tv')),
            title              TEXT NOT NULL,
            year               INTEGER,
            quality_profile_id INTEGER NOT NULL DEFAULT 1,
            root_path          TEXT NOT NULL DEFAULT '',
            monitored          INTEGER NOT NULL DEFAULT 1,
            status             TEXT NOT NULL DEFAULT 'wanted'
                                 CHECK(status IN ('wanted','grabbing','grabbed','imported','ignored')),
            created_at         INTEGER NOT NULL,
            updated_at         INTEGER NOT NULL,
            download_completed_at INTEGER,
            scope_type         TEXT DEFAULT 'full',
            scope_seasons      TEXT,
            scope_episodes     TEXT,
            monitor_future     INTEGER DEFAULT 0,
            language           TEXT NOT NULL DEFAULT 'any',
            scope_key          TEXT NOT NULL DEFAULT ''
          )
        `)
        const cols = [
          'id', 'tmdb_id', 'tvdb_id', 'type', 'title', 'year', 'quality_profile_id',
          'root_path', 'monitored', 'status', 'created_at', 'updated_at',
          'download_completed_at', 'scope_type', 'scope_seasons', 'scope_episodes',
          'monitor_future', 'language', 'scope_key',
        ].join(', ')
        db.exec(`INSERT INTO monitored_items_new (${cols}) SELECT ${cols} FROM monitored_items`)
        db.exec('DROP TABLE monitored_items')
        db.exec('ALTER TABLE monitored_items_new RENAME TO monitored_items')
        db.exec('CREATE INDEX IF NOT EXISTS idx_monitored_status ON monitored_items(status)')
        db.exec('CREATE INDEX IF NOT EXISTS idx_monitored_tmdb ON monitored_items(tmdb_id)')
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    }
  }

  // --------------------------------------------------------------------------
  // Stall-reaper retry ceiling — widen monitored_items.status CHECK to include the terminal
  // 'failed' state (set by reaper.ts after MAX_GRAB_ATTEMPTS reaps without a healthy download).
  // SQLite cannot ALTER a CHECK, so recreate the table when the constraint is absent. Runs AFTER
  // the 'grabbing' widening + all additive columns, and BEFORE the dedup/unique-index block below
  // (which recreates idx_monitored_scope_unique on the result). Columns are copied by PRAGMA
  // intersection so this never drops a column the column set may have gained/lost across migrations.
  // --------------------------------------------------------------------------
  {
    const tblInfo = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='monitored_items'"
    ).get() as { sql: string } | undefined
    if (tblInfo && !tblInfo.sql.includes("'failed'")) {
      db.exec('BEGIN')
      try {
        db.exec(`
          CREATE TABLE monitored_items_new (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            tmdb_id            INTEGER,
            tvdb_id            INTEGER,
            type               TEXT NOT NULL CHECK(type IN ('movie','tv')),
            title              TEXT NOT NULL,
            year               INTEGER,
            quality_profile_id INTEGER NOT NULL DEFAULT 1,
            root_path          TEXT NOT NULL DEFAULT '',
            monitored          INTEGER NOT NULL DEFAULT 1,
            status             TEXT NOT NULL DEFAULT 'wanted'
                                 CHECK(status IN ('wanted','grabbing','grabbed','imported','ignored','failed')),
            created_at         INTEGER NOT NULL,
            updated_at         INTEGER NOT NULL,
            download_completed_at INTEGER,
            scope_type         TEXT DEFAULT 'full',
            scope_seasons      TEXT,
            scope_episodes     TEXT,
            monitor_future     INTEGER DEFAULT 0,
            language           TEXT NOT NULL DEFAULT 'any',
            scope_label        TEXT,
            scope_key          TEXT NOT NULL DEFAULT ''
          )
        `)
        // Copy only columns present in BOTH tables so a column added by a later migration (or one
        // briefly dropped by the 'grabbing' rebuild on a very old DB) never breaks the INSERT/SELECT.
        const newCols = new Set(
          (db.prepare('PRAGMA table_info(monitored_items_new)').all() as Array<{ name: string }>).map((c) => c.name)
        )
        const shared = (db.prepare('PRAGMA table_info(monitored_items)').all() as Array<{ name: string }>)
          .map((c) => c.name)
          .filter((name) => newCols.has(name))
          .join(', ')
        db.exec(`INSERT INTO monitored_items_new (${shared}) SELECT ${shared} FROM monitored_items`)
        db.exec('DROP TABLE monitored_items')
        db.exec('ALTER TABLE monitored_items_new RENAME TO monitored_items')
        db.exec('CREATE INDEX IF NOT EXISTS idx_monitored_status ON monitored_items(status)')
        db.exec('CREATE INDEX IF NOT EXISTS idx_monitored_tmdb ON monitored_items(tmdb_id)')
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    }
  }

  // --------------------------------------------------------------------------
  // A6-02 — enforce one monitored_items row per (tmdb_id, type, scope_key).
  //
  // A bare (tmdb_id, type) unique index would break the season/episode fan-out, which
  // legitimately creates multiple rows per (tmdb_id, type). scope_key (never null) is the
  // discriminator. Order matters: backfill keys → merge existing duplicates → THEN create the
  // unique index (it would fail if duplicates still existed). The whole block is idempotent.
  // --------------------------------------------------------------------------
  {
    // 1. Backfill scope_key for rows that don't have one yet (fresh column default '' or legacy).
    const needKey = db
      .prepare(
        "SELECT id, type, scope_type, scope_seasons, scope_episodes FROM monitored_items WHERE scope_key = '' OR scope_key IS NULL"
      )
      .all() as Array<{
        id: number
        type: 'movie' | 'tv'
        scope_type: string | null
        scope_seasons: string | null
        scope_episodes: string | null
      }>
    if (needKey.length > 0) {
      const setKey = db.prepare('UPDATE monitored_items SET scope_key = ? WHERE id = ?')
      const backfill = db.transaction(() => {
        for (const r of needKey) {
          setKey.run(
            computeScopeKey(r.type, r.scope_type, r.scope_seasons, r.scope_episodes),
            r.id
          )
        }
      })
      backfill()
    }

    // 2. Merge duplicate rows sharing (tmdb_id, type, scope_key): keep the lowest id, repoint
    //    child rows (grab_history, grab_results) to it, delete the losers.
    const dupGroups = db
      .prepare(
        `SELECT tmdb_id, type, scope_key, MIN(id) AS keep_id, COUNT(*) AS n
         FROM monitored_items
         WHERE tmdb_id IS NOT NULL
         GROUP BY tmdb_id, type, scope_key
         HAVING n > 1`
      )
      .all() as Array<{ tmdb_id: number; type: string; scope_key: string; keep_id: number; n: number }>
    if (dupGroups.length > 0) {
      const losersOf = db.prepare(
        'SELECT id FROM monitored_items WHERE tmdb_id = ? AND type = ? AND scope_key = ? AND id <> ?'
      )
      const repointHistory = db.prepare('UPDATE grab_history SET item_id = ? WHERE item_id = ?')
      const repointResults = db.prepare('UPDATE grab_results SET monitored_item_id = ? WHERE monitored_item_id = ?')
      const deleteItem = db.prepare('DELETE FROM monitored_items WHERE id = ?')
      const merge = db.transaction(() => {
        for (const g of dupGroups) {
          const losers = losersOf.all(g.tmdb_id, g.type, g.scope_key, g.keep_id) as Array<{ id: number }>
          for (const loser of losers) {
            repointHistory.run(g.keep_id, loser.id)
            repointResults.run(g.keep_id, loser.id)
            deleteItem.run(loser.id)
          }
        }
      })
      merge()
    }

    // 3. Now the index can be created safely.
    try {
      db.exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_monitored_scope_unique ON monitored_items(tmdb_id, type, scope_key)'
      )
    } catch { /* duplicates somehow remained — leave index absent rather than crash startup */ }
  }

  // Additive: index on media_items(added_at) for ORDER BY added_at sort on /library.
  // Not present in the original media_items block, so existing DBs need the explicit exec.
  db.exec('CREATE INDEX IF NOT EXISTS idx_media_added_at ON media_items(added_at)')
}
