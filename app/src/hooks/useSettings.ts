'use client'

import { useState, useEffect, useCallback } from 'react'

// ---------------------------------------------------------------------------
// Playback settings
// ---------------------------------------------------------------------------

export interface PlaybackPrefs {
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
  showNextUp: boolean
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
  showNextUp: true,
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
  if (typeof window === 'undefined') return defaults
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return defaults
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
  const [prefs, setPrefs] = useState<PlaybackPrefs>(PLAYBACK_DEFAULTS)

  useEffect(() => {
    setPrefs(readLS('unified-playback-prefs', PLAYBACK_DEFAULTS))
  }, [])

  const update = useCallback((patch: Partial<PlaybackPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch }
      writeLS('unified-playback-prefs', next)
      return next
    })
  }, [])

  return { prefs, update }
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
