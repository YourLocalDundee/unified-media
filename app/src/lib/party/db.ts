/**
 * Party Play — durable query layer.
 *
 * Typed wrappers over watch_parties / watch_party_members used by the REST
 * lifecycle routes. These touch SQLite only (membership + existence); live
 * position/heartbeat state lives in the in-memory PartyStateStore.
 */
import { getDb } from '@/lib/db/index'
import type { WatchPartyRow } from './types'

// Friendly join code: 6 chars from the invite-code alphabet (uppercase + digits).
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
function makeJoinCode(): string {
  const array = new Uint8Array(6)
  crypto.getRandomValues(array)
  let code = ''
  for (const b of array) code += UPPER[b % UPPER.length]
  return code
}

/** A party member resolved with the user's display name for the panel UI. */
export interface MemberView {
  userId: string
  displayName: string
  isHost: boolean
}

export interface CreatePartyRowInput {
  id: string
  joinCode: string
  hostUserId: string
  mediaId: string
}

/** Insert a new active party plus the host's member row in one transaction. */
export function createPartyRow(input: CreatePartyRowInput): void {
  const db = getDb()
  const now = Date.now()
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO watch_parties
         (id, join_code, host_user_id, media_id, status, created_at, updated_at, ended_at, last_position_ticks, last_paused)
       VALUES (?, ?, ?, ?, 'active', ?, ?, NULL, 0, 1)`
    ).run(input.id, input.joinCode, input.hostUserId, input.mediaId, now, now)
    db.prepare(
      `INSERT INTO watch_party_members (party_id, user_id, joined_at, left_at, is_host)
       VALUES (?, ?, ?, NULL, 1)`
    ).run(input.id, input.hostUserId, now)
  })
  tx()
}

export function getActivePartyById(partyId: string): WatchPartyRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM watch_parties WHERE id = ? AND status = 'active'`)
    .get(partyId) as WatchPartyRow | undefined
}

export function getActivePartyByCode(joinCode: string): WatchPartyRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM watch_parties WHERE join_code = ? AND status = 'active'`)
    .get(joinCode) as WatchPartyRow | undefined
}

/** Generate a join code unique against existing parties (regenerate on collision). */
export function generateUniqueJoinCode(): string {
  const db = getDb()
  const exists = db.prepare('SELECT 1 FROM watch_parties WHERE join_code = ?')
  const MAX_ATTEMPTS = 20
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const code = makeJoinCode()
    if (!exists.get(code)) return code
  }
  throw new Error(`Failed to generate a unique join code after ${MAX_ATTEMPTS} attempts`)
}

/**
 * Insert the caller's member row, or reactivate it (clear left_at) if they
 * previously left. Idempotent via UNIQUE(party_id, user_id).
 */
export function upsertMember(partyId: string, userId: string): void {
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO watch_party_members (party_id, user_id, joined_at, left_at, is_host)
       VALUES (?, ?, ?, NULL, 0)
       ON CONFLICT(party_id, user_id)
       DO UPDATE SET left_at = NULL, joined_at = excluded.joined_at`
    )
    .run(partyId, userId, now)
}

/** Active members (left_at IS NULL), display name resolved from users. */
export function getMembers(partyId: string): MemberView[] {
  const rows = getDb()
    .prepare(
      `SELECT m.user_id AS userId,
              COALESCE(u.display_name, u.username) AS displayName,
              m.is_host AS isHost
       FROM watch_party_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.party_id = ? AND m.left_at IS NULL
       ORDER BY m.joined_at ASC`
    )
    .all(partyId) as { userId: string; displayName: string; isHost: number }[]
  return rows.map((r) => ({ userId: r.userId, displayName: r.displayName, isHost: r.isHost === 1 }))
}

/** Check whether a user is a current (active) member of a party. */
export function isActiveMember(partyId: string, userId: string): boolean {
  const row = getDb()
    .prepare('SELECT 1 FROM watch_party_members WHERE party_id = ? AND user_id = ? AND left_at IS NULL')
    .get(partyId, userId)
  return row != null
}

/** Mark a member as left (set left_at). No-op if already left or never joined. */
export function markMemberLeft(partyId: string, userId: string): void {
  getDb()
    .prepare('UPDATE watch_party_members SET left_at = ? WHERE party_id = ? AND user_id = ? AND left_at IS NULL')
    .run(Date.now(), partyId, userId)
}

/** Count of currently-active members in a party. */
export function countActiveMembers(partyId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM watch_party_members WHERE party_id = ? AND left_at IS NULL')
    .get(partyId) as { n: number }
  return row.n
}

/** End a party: status ended, stamp ended_at. */
export function endPartyRow(partyId: string): void {
  const now = Date.now()
  getDb()
    .prepare(`UPDATE watch_parties SET status = 'ended', ended_at = ?, updated_at = ? WHERE id = ? AND status = 'active'`)
    .run(now, now, partyId)
}

/**
 * Mark a member left and, if no active members remain, end the party — atomically.
 * The leave + remaining-count read + conditional end all run on the same connection
 * inside one transaction, so the last-member-out decision can't race a concurrent join.
 * Returns whether the party was ended as a result.
 */
export function leaveAndMaybeEnd(partyId: string, userId: string): { ended: boolean } {
  const db = getDb()
  const tx = db.transaction(() => {
    const now = Date.now()
    db.prepare(
      'UPDATE watch_party_members SET left_at = ? WHERE party_id = ? AND user_id = ? AND left_at IS NULL'
    ).run(now, partyId, userId)
    const { n } = db
      .prepare('SELECT COUNT(*) AS n FROM watch_party_members WHERE party_id = ? AND left_at IS NULL')
      .get(partyId) as { n: number }
    if (n === 0) {
      db.prepare(
        `UPDATE watch_parties SET status = 'ended', ended_at = ?, updated_at = ? WHERE id = ? AND status = 'active'`
      ).run(now, now, partyId)
      return { ended: true }
    }
    return { ended: false }
  })
  return tx()
}

/**
 * Checkpoint the authoritative position/paused state for restart recovery only.
 * Throttled to CHECKPOINT_THROTTLE_MS by the caller; never written per-tick.
 */
export function checkpointParty(partyId: string, positionTicks: number, paused: boolean): void {
  const now = Date.now()
  getDb()
    .prepare(
      `UPDATE watch_parties SET last_position_ticks = ?, last_paused = ?, updated_at = ? WHERE id = ? AND status = 'active'`
    )
    .run(Math.round(positionTicks), paused ? 1 : 0, now, partyId)
}

/** Active parties with their last checkpoint, for startup rehydration. */
export function loadActiveParties(): {
  id: string
  media_id: string
  last_position_ticks: number
  last_paused: number
}[] {
  return getDb()
    .prepare(
      `SELECT id, media_id, last_position_ticks, last_paused FROM watch_parties WHERE status = 'active'`
    )
    .all() as { id: string; media_id: string; last_position_ticks: number; last_paused: number }[]
}
