#!/usr/bin/env node
// Run: node scripts/reset-admin.js <new-password>
// from /home/minijoe/dev/unified-frontend/app directory

const Database = require('better-sqlite3')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')

const DB_PATH = process.env.DB_PATH || './unified.db'
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin'
const NEW_PASSWORD = process.argv[2]

if (!NEW_PASSWORD) {
  console.error('Usage: node ../scripts/reset-admin.js <new-password>')
  console.error('Password requirements: 8-64 chars, uppercase, lowercase, special char (!@#$ etc.)')
  console.error('Cannot contain: password, unified, your username')
  process.exit(1)
}

const errors = []
if (NEW_PASSWORD.length < 8) errors.push('Too short (min 8)')
if (NEW_PASSWORD.length > 64) errors.push('Too long (max 64)')
if (!/[A-Z]/.test(NEW_PASSWORD)) errors.push('Need uppercase letter')
if (!/[a-z]/.test(NEW_PASSWORD)) errors.push('Need lowercase letter')
if (!/[!@#$%^&*()\-_=+\[\]{}|;:,.<>?]/.test(NEW_PASSWORD)) errors.push('Need special character')
if (/(.)\1{2,}/.test(NEW_PASSWORD)) errors.push('No 3+ identical chars in a row')
if (/password/i.test(NEW_PASSWORD)) errors.push('Cannot contain "password"')
if (/unified/i.test(NEW_PASSWORD)) errors.push('Cannot contain "unified"')
if (new RegExp(ADMIN_USERNAME, 'i').test(NEW_PASSWORD)) errors.push(`Cannot contain username "${ADMIN_USERNAME}"`)

if (errors.length > 0) {
  console.error('Password validation failed:')
  errors.forEach(e => console.error(' -', e))
  process.exit(1)
}

const db = new Database(DB_PATH)
const hash = bcrypt.hashSync(NEW_PASSWORD, 12)
const now = Date.now()

const user = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(ADMIN_USERNAME)

if (!user) {
  const id = crypto.randomBytes(4).toString('hex')
  db.prepare(`INSERT INTO users (id, username, password_hash, role, created_at, updated_at, is_active) VALUES (?, ?, ?, 'admin', ?, ?, 1)`).run(id, ADMIN_USERNAME, hash, now, now)
  console.log('Created admin user:', ADMIN_USERNAME)
} else {
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ?, force_pw_change = 0 WHERE id = ?').run(hash, now, user.id)
  const deleted = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id)
  console.log('Updated password for:', ADMIN_USERNAME)
  console.log('Cleared', deleted.changes, 'existing sessions')
}

db.close()
console.log('\nDone.')
console.log('Username:', ADMIN_USERNAME)
console.log('Password:', NEW_PASSWORD)
console.log('Login at: https://unified.minijoe.dev/login')
