/**
 * Client-side settings hooks backed by localStorage.
 * All preferences are stored as JSON under two keys:
 *   - `unified-playback-prefs`  — video/audio/subtitle playback options
 *   - `unified-display-prefs`   — home page carousels, library layout, sidebar
 *
 * Both hooks follow the same pattern: server-side rendering uses the in-memory
 * defaults (localStorage is unavailable in RSC/SSR), then a useEffect hydrates
 * from localStorage on the client. This avoids hydration mismatches.
 */
'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { useIsClient } from './useIsClient'

// ---------------------------------------------------------------------------
// Playback settings
// ---------------------------------------------------------------------------

export interface PlaybackPrefs {
  // 0 = "Auto" — let the server choose the highest quality it can direct-play
  quality: 0 | 120000000 | 20000000 | 8000000 | 4000000 | 1500000
  audioLang: string
  subtitleLang: string
  subtitleSize: 'small' | 'normal' | 'large'
  subtitleBg: 'none' | 'semi' | 'opaque'
  subtitleColor: 'white' | 'yellow'
  autoPlayNext: boolean
  autoPlayDelay: 5 | 10 | 15 | 0
  skipIntro: boolean
  resumeMode: 'ask' | 'resume' | 'restart'
  hwAccel: 'auto' | 'software'
}

const PLAYBACK_DEFAULTS: PlaybackPrefs = {
  quality: 0,
  audioLang: 'en',
  subtitleLang: '',
  subtitleSize: 'normal',
  subtitleBg: 'semi',
  subtitleColor: 'white',
  autoPlayNext: true,
  autoPlayDelay: 10,
  skipIntro: false,
  resumeMode: 'resume',
  hwAccel: 'auto',
}

// ---------------------------------------------------------------------------
// Display settings
// ---------------------------------------------------------------------------

export interface DisplayPrefs {
  showContinueWatching: boolean
  showRecentlyAdded: boolean
  carouselLimit: 5 | 8 | 10 | 0
  defaultView: 'grid' | 'list'
  posterSize: 'small' | 'medium' | 'large'
  showTypeBadge: boolean
  showYear: boolean
  sidebarCollapsed: boolean
  sidebarLabels: boolean
}

const DISPLAY_DEFAULTS: DisplayPrefs = {
  showContinueWatching: true,
  showRecentlyAdded: true,
  carouselLimit: 10,
  defaultView: 'grid',
  posterSize: 'medium',
  showTypeBadge: true,
  showYear: true,
  sidebarCollapsed: false,
  sidebarLabels: true,
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * A tiny localStorage-backed external store for one JSON key. Reading goes through
 * `useSyncExternalStore` so the SSR/client snapshot difference is reconciled by React
 * without a hydration mismatch and without a synchronous setState-in-effect (which the
 * old `useState(defaults)` + hydrate-in-`useEffect` pattern tripped). `getSnapshot`
 * returns a cached reference that only changes when the persisted value actually
 * changes, so React does not loop. Writes update the cache and notify all subscribers,
 * so every hook instance (and other tabs, via the `storage` event) stays in sync.
 */
function createLSStore<T>(key: string, defaults: T) {
  const listeners = new Set<() => void>()
  let cache: T = defaults
  let cacheRaw: string | null = null
  let initialized = false

  function read(): T {
    if (typeof window === 'undefined') return defaults
    let raw: string | null = null
    try { raw = localStorage.getItem(key) } catch { raw = null }
    if (!initialized || raw !== cacheRaw) {
      cacheRaw = raw
      try {
        // Spread defaults first so preference fields added in future versions still
        // get their default values when the stored JSON predates them.
        cache = raw ? ({ ...defaults, ...JSON.parse(raw) } as T) : defaults
      } catch {
        cache = defaults
      }
      initialized = true
    }
    return cache
  }

  function subscribe(cb: () => void): () => void {
    listeners.add(cb)
    const onStorage = (e: StorageEvent) => { if (e.key === key) cb() }
    window.addEventListener('storage', onStorage)
    return () => {
      listeners.delete(cb)
      window.removeEventListener('storage', onStorage)
    }
  }

  function write(patch: Partial<T>): void {
    if (typeof window === 'undefined') return
    const next = { ...read(), ...patch }
    const raw = JSON.stringify(next)
    try { localStorage.setItem(key, raw) } catch { /* ignore quota errors */ }
    cache = next
    cacheRaw = raw
    initialized = true
    listeners.forEach((l) => l())
  }

  return { read, subscribe, write, serverSnapshot: () => defaults }
}

const playbackStore = createLSStore('unified-playback-prefs', PLAYBACK_DEFAULTS)
const displayStore = createLSStore('unified-display-prefs', DISPLAY_DEFAULTS)

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function usePlaybackPrefs() {
  // The persisted prefs read through useSyncExternalStore: SSR/hydration sees the
  // defaults (getServerSnapshot), then the client snapshot reflects localStorage with
  // no hydration mismatch and no setState-in-effect.
  const prefs = useSyncExternalStore(playbackStore.subscribe, playbackStore.read, playbackStore.serverSnapshot)
  // `ready` flips true once mounted on the client. Consumers that apply a one-time
  // default (e.g. the player's language selection) wait for this so they act on the
  // user's stored value rather than the pre-hydration defaults.
  const ready = useIsClient()

  const update = useCallback((patch: Partial<PlaybackPrefs>) => {
    playbackStore.write(patch)
  }, [])

  return { prefs, update, ready }
}

export function useDisplayPrefs() {
  const prefs = useSyncExternalStore(displayStore.subscribe, displayStore.read, displayStore.serverSnapshot)

  const update = useCallback((patch: Partial<DisplayPrefs>) => {
    displayStore.write(patch)
  }, [])

  return { prefs, update }
}
