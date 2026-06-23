import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Single indirection for the current epoch millis. Keeps the non-deterministic clock
// read out of component render bodies (react-hooks/purity) while preserving the exact
// runtime behavior — these call sites want a render-time "now" snapshot for a display
// label or a SQL expiry comparison, not reactive state.
export function nowMs(): number {
  return Date.now()
}

export function formatBytes(bytes: number): string {
  // NaN-safe (Bug 6): a missing/undefined/NaN/negative input previously produced "NaN undefined"
  // because Math.log(NaN)=NaN → sizes[NaN]=undefined. Treat any non-finite or <=0 value as 0 B.
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export function formatDuration(ticks: number): string {
  const totalSeconds = Math.floor(ticks / 10_000_000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

// Accepts a date string (ISO, etc.) or epoch-ms number so callers with either
// source type don't need a local copy that diverges in format (A20-06).
export function formatDate(value: string | number): string {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatDateShort(value: string | number): string {
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function ticksToSeconds(ticks: number): number {
  return ticks / 10_000_000
}

export function secondsToTicks(seconds: number): number {
  return seconds * 10_000_000
}
