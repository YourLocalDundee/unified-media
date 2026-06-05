/**
 * Admin account seeder — runs once on first getDb() call when the users table
 * is empty (i.e. a fresh DB with no existing accounts).
 *
 * Priority order for the initial password:
 *   1. ADMIN_PASSWORD env var if it passes the password policy
 *   2. Auto-generated random password (printed to stderr, force_pw_change=1)
 *
 * The force_pw_change flag causes the login flow to redirect the admin to
 * /change-password immediately after their first successful login.
 *
 * This file intentionally uses bcryptjs (sync) rather than the async hashPassword
 * wrapper in password.ts — seeding happens in the synchronous DB init path.
 */
import type Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { validatePassword } from '../password'

function makeId(size: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  const array = new Uint8Array(size)
  crypto.getRandomValues(array)
  for (const byte of array) result += chars[byte % chars.length]
  return result
}

export function seedAdmin(db: Database.Database): void {
  // Guard: only seed on a completely empty users table — never overwrites existing data
  const count = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c
  if (count > 0) return

  const username = process.env.ADMIN_USERNAME || 'admin'
  const envPassword = process.env.ADMIN_PASSWORD

  let password: string
  let forceChange = 0

  const envValid = envPassword && validatePassword(envPassword, username).valid

  if (!envValid) {
    // Generate a guaranteed-valid password
    password = randomBytes(12).toString('hex') + '!Aa1'
    forceChange = 1
    if (!envPassword) {
      console.error('[seed] WARNING: ADMIN_PASSWORD not set in environment')
    } else {
      const result = validatePassword(envPassword, username)
      console.error('[seed] WARNING: ADMIN_PASSWORD fails policy:', result.errors.join(', '))
    }
    console.error('[seed] ============================================')
    console.error('[seed] GENERATED ADMIN PASSWORD — SAVE THIS NOW:')
    console.error('[seed]', password)
    console.error('[seed] ============================================')
    console.error('[seed] You will be required to change it on first login.')
    console.error('[seed] Set ADMIN_PASSWORD in .env.local and rebuild to use your own password.')
  } else {
    password = envPassword
  }

  const hash = bcrypt.hashSync(password, 12)
  const now = Date.now()
  const id = makeId(8)

  db.prepare(
    `INSERT INTO users (id, username, role, password_hash, created_at, updated_at, is_active, force_pw_change)
     VALUES (?, ?, 'admin', ?, ?, ?, 1, ?)`
  ).run(id, username, hash, now, now, forceChange)

  console.log(`[seed] Admin account created. Username: ${username}`)
}
