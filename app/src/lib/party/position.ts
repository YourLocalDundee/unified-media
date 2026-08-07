/**
 * Party Play — pure position/timeline math.
 *
 * No store or server imports: these helpers run identically on the server
 * pipeline and (conceptually mirrored) on the client. Position is in 100ns
 * ticks; wall-clock deltas are milliseconds converted with TICKS_PER_MS.
 */
import { TICKS_PER_MS, TICKS_PER_SECOND } from './constants'

interface ExtrapolationState {
  positionTicks: number
  paused: boolean
  playbackRate: number
  lastTickWallClock: number
}

/**
 * The true current position at `now`. When playing,
 * positionTicks + (now - lastTickWallClock) * playbackRate, converting the
 * ms delta to ticks. When paused, positionTicks. Never negative.
 */
export function extrapolatePosition(state: ExtrapolationState, now: number): number {
  if (state.paused) return Math.max(0, state.positionTicks)
  const deltaMs = now - state.lastTickWallClock
  const advanced = state.positionTicks + deltaMs * TICKS_PER_MS * state.playbackRate
  return Math.max(0, advanced)
}

/** Median of reported positions (avg of middle two for even length). 0 if empty. */
export function medianReportedPositionTicks(reports: number[]): number {
  if (reports.length === 0) return 0
  const sorted = [...reports].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  if (sorted.length % 2 === 1) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

export function ticksToSeconds(ticks: number): number {
  return ticks / TICKS_PER_SECOND
}

export function secondsToTicks(sec: number): number {
  return sec * TICKS_PER_SECOND
}
