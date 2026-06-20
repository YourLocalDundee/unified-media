/**
 * /settings/advanced — escape hatches for debugging and preference resets.
 * All state here is client-only (localStorage). There is no server-side
 * component because nothing here touches the DB or authenticated APIs.
 *
 * The Jellyfin URL override lets a user point the browser at a different
 * Jellyfin base URL for video streaming without changing the server-side
 * JELLYFIN_URL env var (useful when streaming via a direct LAN path vs. the
 * reverse-proxy path).
 */
'use client'

import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'

export default function AdvancedSettingsPage() {
  const [jellyfinUrl, setJellyfinUrl] = useState(() => {
    // Lazy initializer to safely read localStorage — runs only on the client
    if (typeof window !== 'undefined') {
      return localStorage.getItem('unified-jellyfin-url-override') ?? ''
    }
    return ''
  })

  function saveJellyfinUrl() {
    if (jellyfinUrl.trim()) {
      localStorage.setItem('unified-jellyfin-url-override', jellyfinUrl.trim())
    } else {
      localStorage.removeItem('unified-jellyfin-url-override')
    }
  }

  function clearAllPreferences() {
    if (window.confirm('Clear all saved preferences? This cannot be undone.')) {
      const keysToRemove = [
        'unified-playback-prefs',
        'unified-display-prefs',
        'unified-jellyfin-url-override',
        'unified-theme',
      ]
      keysToRemove.forEach((k) => localStorage.removeItem(k))
      window.location.reload()
    }
  }

  return (
    <div className="space-y-6">
      {/* Warning */}
      <div className="flex items-start gap-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-4">
        <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-yellow-200">
          Advanced settings are intended for debugging. Incorrect values may break functionality.
        </p>
      </div>

      {/* Download client */}
      <section className="rounded-lg border border-border bg-card p-6 space-y-3">
        <h2 className="text-lg font-semibold">Download Client</h2>
        <div className="flex items-center justify-between py-2">
          <span className="text-sm font-medium">Active Client</span>
          <span className="text-sm text-muted-foreground">UMT</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Changing the download client requires a container restart and is configured via environment
          variables.
        </p>
      </section>

      {/* Jellyfin URL override */}
      <section className="rounded-lg border border-border bg-card p-6 space-y-3 opacity-60">
        <h2 className="text-lg font-semibold">Jellyfin URL Override <span className="ml-2 text-xs font-normal text-muted-foreground">(not yet wired to the player)</span></h2>
        <p className="text-xs text-muted-foreground">
          Intended to let you point browser-side stream requests at a different Jellyfin URL without
          changing the server-side <code className="font-mono">JELLYFIN_URL</code> env var. Stored
          in localStorage but not yet read by the player or stream routes.
        </p>
        <div className="flex gap-2">
          <input
            type="url"
            value={jellyfinUrl}
            onChange={(e) => setJellyfinUrl(e.target.value)}
            placeholder="http://192.168.0.50:8096"
            disabled
            className="flex-1 rounded-md border border-border bg-muted px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary cursor-not-allowed"
          />
          <button
            onClick={saveJellyfinUrl}
            disabled
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save
          </button>
        </div>
      </section>

      {/* Danger zone */}
      <section className="rounded-lg border border-destructive/40 bg-card p-6 space-y-3">
        <h2 className="text-lg font-semibold text-destructive">Danger Zone</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Clear All Preferences</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Resets all playback, display, and theme settings to defaults.
            </p>
          </div>
          <button
            onClick={clearAllPreferences}
            className="rounded-md border border-destructive px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors"
          >
            Clear
          </button>
        </div>
      </section>
    </div>
  )
}
