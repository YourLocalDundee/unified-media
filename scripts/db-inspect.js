#!/usr/bin/env node
// Run: node scripts/db-inspect.js
// from /home/minijoe/dev/unified-frontend/app directory

const Database = require('better-sqlite3')
const path = require('path')

const DB_PATH = process.env.DB_PATH || './unified.db'
console.log('Database path:', path.resolve(DB_PATH))

const db = new Database(DB_PATH)

try {
  console.log('\n=== USERS ===')
  const users = db.prepare('SELECT id, username, email, role, is_active, force_pw_change, created_at FROM users').all()
  console.table(users)

  console.log('\n=== SESSIONS (active) ===')
  const sessions = db.prepare(
    'SELECT s.id, s.user_id, u.username, s.ip_address, s.created_at, s.expires_at FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.expires_at > ? ORDER BY s.created_at DESC LIMIT 10'
  ).all(Date.now())
  console.table(sessions)

  console.log('\n=== INVITE CODES ===')
  const codes = db.prepare('SELECT * FROM invite_codes').all()
  console.table(codes)
} catch (err) {
  console.error('Error inspecting database:', err.message)
} finally {
  db.close()
}
