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

import { useState, useEffect, useCallback } from 'react'

// ---------------------------------------------------------------------------
// Playback settings
// ---------------------------------------------------------------------------

export interface PlaybackPrefs {
  // 0 = "Auto" — let Jellyfin choose the highest quality it can direct-play
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

function readLS<T>(key: string, defaults: T): T {
  // Guard for SSR — localStorage is browser-only
  if (typeof window === 'undefined') return defaults
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return defaults
    // Spread defaults first so any new preference fields added in future versions
    // still get their default values when the stored JSON predates them
    return { ...defaults, ...JSON.parse(raw) } as T
  } catch {
    return defaults
  }
}

function writeLS<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore quota errors
  }
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function usePlaybackPrefs() {
  // Initialize with defaults; the effect below will overwrite with persisted values
  // on the first client render, avoiding an SSR/client hydration mismatch.
  const [prefs, setPrefs] = useState<PlaybackPrefs>(PLAYBACK_DEFAULTS)
  // `ready` flips true once persisted prefs have hydrated from localStorage. Consumers that
  // apply a one-time default (e.g. the player's language selection) wait for this so they act
  // on the user's stored value rather than the pre-hydration defaults.
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setPrefs(readLS('unified-playback-prefs', PLAYBACK_DEFAULTS))
    setReady(true)
  }, [])

  const update = useCallback((patch: Partial<PlaybackPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch }
      writeLS('unified-playback-prefs', next)
      return next
    })
  }, [])

  return { prefs, update, ready }
}

export function useDisplayPrefs() {
  const [prefs, setPrefs] = useState<DisplayPrefs>(DISPLAY_DEFAULTS)

  useEffect(() => {
    setPrefs(readLS('unified-display-prefs', DISPLAY_DEFAULTS))
  }, [])

  const update = useCallback((patch: Partial<DisplayPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch }
      writeLS('unified-display-prefs', next)
      return next
    })
  }, [])

  return { prefs, update }
}
