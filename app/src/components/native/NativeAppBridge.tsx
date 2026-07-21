'use client'

// Mounts once in the root layout. No-ops entirely in a normal browser tab —
// only takes effect inside the Capacitor phone/TV shell (see
// /home/minijoe/dev/unified-frontend/native), which loads this same site via
// capacitor.config.ts's server.url rather than a bundled build. That means
// this component's own JS (not anything in native/) is what actually runs
// inside the WebView, so any native-shell behavior has to be wired here.
//
// Android hardware back button: Capacitor's WebView already falls back to
// browser history.back() by default, but relying on that silently breaks for
// an SPA router the moment a route change doesn't produce a real history
// entry (e.g. a redirect via router.replace()). Handling it explicitly is the
// standard recommendation for apps using client-side routing — go back in
// history if there's somewhere to go, otherwise exit rather than getting
// stuck or navigating to an unrelated prior entry.
//
// No state: this is a side-effect-only component (keeps it clear of the
// react-hooks/set-state-in-effect rule at error — see CLAUDE.md §7).
import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'

export default function NativeAppBridge() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    const listenerPromise = CapacitorApp.addListener('backButton', () => {
      if (window.history.length > 1) {
        window.history.back()
      } else {
        CapacitorApp.exitApp()
      }
    })

    return () => {
      listenerPromise.then((listener) => listener.remove())
    }
  }, [])

  return null
}
