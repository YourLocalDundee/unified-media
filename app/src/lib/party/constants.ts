/**
 * Party Play — timing, tolerance, and policy constants.
 *
 * These are the single source of truth for every "tolerance" referenced across the
 * party-play implementation (server pipeline, drift correction, resilience, client
 * hook). They are stated as exact values, never ranges. See PARTY_PLAY_SPEC.txt.
 *
 * Position is always in 100-nanosecond ticks (seconds * 10_000_000), matching
 * media_watch_state.position_ticks and the player's reportProgress path. To convert
 * a wall-clock millisecond delta to ticks, multiply by TICKS_PER_MS (10_000).
 */

// --- tick math ---
export const TICKS_PER_SECOND = 10_000_000
export const TICKS_PER_MS = 10_000

// --- heartbeat / keepalive ---
export const HEARTBEAT_INTERVAL_MS = 5000 // client -> server heartbeat carrying current position
export const WS_PING_INTERVAL_MS = 20000 // server -> client ws protocol ping
export const WS_PONG_MISS_LIMIT = 2 // terminate socket after this many consecutive missed pongs
export const KEEPALIVE_STATE_BROADCAST_MS = 10000 // periodic full-state resync even absent commands

// --- transition lead times (effectiveAt) ---
export const PLAY_LEAD_MS = 1000 // effectiveAt lead for a play transition (pre-buffer headroom)
export const CONTROL_LEAD_MS = 300 // effectiveAt lead for a pause or seek transition

// --- command arbitration ---
export const COMMAND_DEBOUNCE_MS = 300 // drop a competing duplicate same-action that would not change state
export const CLOCK_OFFSET_EMA_ALPHA = 0.4 // newOffset = 0.6*old + 0.4*sample

// --- drift bands (in seconds of content time) ---
export const SEEK_DEADBAND_S = 0.25 // ignore a position correction below this when adopting server state
export const RATE_NUDGE_LOW_S = 0.25 // drift at/above this and below the hard threshold -> rate-nudge
export const DRIFT_HARD_RESEEK_S = 1.5 // drift at/above this -> targeted hard reseek
export const RATE_NUDGE_CLAMP = 0.1 // video.playbackRate stays within [0.90, 1.10] during a nudge
export const POST_JOIN_SETTLE_MS = 8000 // after join/reconnect, only rate-nudge (no hard reseek) for this long
export const MEDIAN_OUTLIER_RESEEK_S = 1.5 // a client this far off the median room timeline gets a reseek

// --- readiness gate ---
export const READINESS_GATE_MAX_WAIT_MS = 20000 // release a held play when all ready OR after this

// --- lifecycle / resilience ---
export const DISCONNECT_GRACE_MS = 30000 // a dropped member sits in 'grace' this long before eviction
export const EMPTY_PARTY_IDLE_END_MS = 60000 // a party with zero connected members ends after this idle window
export const CHECKPOINT_THROTTLE_MS = 12000 // throttle for position/paused checkpoints to SQLite

// --- chat ---
export const CHAT_RING_BUFFER_SIZE = 50 // most-recent chat messages held in memory per party for joiners

// --- rate limits (via existing checkRateLimit) ---
export const CREATE_RATE_LIMIT = 10 // creates per hour per user
export const JOIN_RATE_LIMIT = 30 // joins per hour per user
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // one hour

// --- networking ---
export const PARTY_WS_PORT = 3002 // dedicated WebSocket server port (internal only)
export const PARTY_WS_PATH = '/api/party/ws'

// --- reactions ---
// The fixed v1 reaction set (eight). Keep small and fixed; no custom set in v1.
export const ALLOWED_REACTIONS = ['😂', '❤️', '😮', '😢', '👍', '🔥', '🎉', '👏'] as const
export type ReactionEmoji = (typeof ALLOWED_REACTIONS)[number]

export function isAllowedReaction(emoji: string): emoji is ReactionEmoji {
  return (ALLOWED_REACTIONS as readonly string[]).includes(emoji)
}
