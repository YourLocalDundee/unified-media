/**
 * Database singleton — opens the SQLite file, applies migrations, seeds the
 * admin account, and prunes stale sessions on first access.
 *
 * better-sqlite3 is synchronous and single-connection by design. WAL mode lets
 * readers run concurrently with a single writer, which is fine for this workload.
 * Foreign-key enforcement is off by default in SQLite and must be enabled per
 * connection — that's the pragma call below.
 *
 * The module-level _db guard means all server code shares one connection for the
 * lifetime of the Node.js process.  In Next.js dev mode, hot-reload can create
 * a new module instance, re-opening the file — that's harmless because WAL
 * handles concurrent opens from the same process safely.
 */
import Database from 'better-sqlite3'
import path from 'path'
import { runMigrations } from './migrations'
import { seedAdmin } from './seed'

// Production sets DB_PATH=/data/unified.db via the unified-db Docker volume
const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'unified.db')

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH)
    // WAL allows concurrent reads while a write is in progress — important for
    // page renders that hit the DB while a background job is writing.
    _db.pragma('journal_mode = WAL')
    // SQLite disables FK checks by default for backwards-compat; opt in explicitly
    _db.pragma('foreign_keys = ON')
    // Performance pragmas (audit B-3). Safe under WAL on this single-process, single-file DB.
    //   synchronous=NORMAL : biggest write-latency win — fsync only at checkpoints, not every
    //                        commit; durable under WAL (a crash can lose only the last txn, never
    //                        corrupt the DB).
    //   busy_timeout=5000  : wait up to 5s for the writer instead of throwing SQLITE_BUSY when a
    //                        page render reads while a background job (scanner/party/automation) writes.
    //   cache_size=-16000  : ~16 MB page cache (negative value = KiB).
    //   mmap_size=256MB    : memory-mapped I/O to cut read syscalls.
    _db.pragma('synchronous = NORMAL')
    _db.pragma('busy_timeout = 5000')
    _db.pragma('cache_size = -16000')
    _db.pragma('mmap_size = 268435456')
    runMigrations(_db)
    seedAdmin(_db)
    // Prune sessions at startup so the table doesn't grow unbounded between restarts
    cleanExpiredSessions(_db)
  }
  return _db
}

export function cleanExpiredSessions(db: Database.Database): void {
  try {
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now())
  } catch { /* never throws */ }
}
