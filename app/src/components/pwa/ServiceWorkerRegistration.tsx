'use client'

// Mounts once in the root layout to register the app-shell service worker
// (public/sw.js). Renders nothing — this is a side-effect-only component.
//
// No state: registration is fire-and-forget and never feeds back into render,
// so there's nothing to store in useState (keeps this clear of the
// react-hooks/set-state-in-effect rule at error — see CLAUDE.md §7).
import { useEffect } from 'react'

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    // Service workers already refuse to register outside a secure context,
    // but check explicitly so the intent is clear and this never surprises a
    // future reader who moves the app behind a plain-http dev proxy.
    const isSecureContext =
      window.location.protocol === 'https:' || window.location.hostname === 'localhost'
    if (!isSecureContext) return

    navigator.serviceWorker.register('/sw.js').catch(() => {
      // The PWA shell is a progressive enhancement — a failed registration
      // (unsupported browser, blocked by an extension, etc.) must never
      // break the app.
    })
  }, [])

  return null
}
