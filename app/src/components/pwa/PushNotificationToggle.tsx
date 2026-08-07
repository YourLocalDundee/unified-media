/**
 * Push notification subscribe/unsubscribe control for /settings/profile.
 *
 * Uses the already-registered app-shell service worker (ServiceWorkerRegistration)
 * via navigator.serviceWorker.ready, subscribes through its pushManager with the
 * server's public VAPID key, and POSTs the subscription to /api/push/subscribe.
 * Unsubscribing reverses both sides. Renders nothing actionable when the browser
 * lacks push support or the server has no VAPID keys configured.
 *
 * react-hooks rules (CLAUDE.md §7): the initial read of push/permission state is
 * deferred a tick in the effect (setTimeout 0), matching SessionsSection, so the
 * async state updates don't run in the effect's synchronous commit path. The
 * urlBase64ToUint8Array helper is a pure module-scope function.
 */
'use client'

import { useState, useEffect, useCallback } from 'react'

type Status = 'loading' | 'unsupported' | 'unconfigured' | 'ready'

// Convert a base64url VAPID key to the Uint8Array the Push API expects. Backed by
// an explicit ArrayBuffer so the type is Uint8Array<ArrayBuffer> (a BufferSource
// applicationServerKey accepts), not the SharedArrayBuffer-widened default.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

export default function PushNotificationToggle() {
  const [status, setStatus] = useState<Status>('loading')
  const [subscribed, setSubscribed] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [vapidKey, setVapidKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const init = useCallback(async () => {
    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      setStatus('unsupported')
      return
    }
    try {
      const res = await fetch('/api/push/vapid-public-key')
      const data = (await res.json()) as { key: string | null }
      if (!data.key) {
        setStatus('unconfigured')
        return
      }
      setVapidKey(data.key)
      setPermission(Notification.permission)
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      setSubscribed(sub !== null)
      setStatus('ready')
    } catch {
      setStatus('unsupported')
    }
  }, [])

  // Deferred a tick so init()'s state updates run outside the effect's synchronous
  // commit path (react-hooks/set-state-in-effect). Same pattern as SessionsSection.
  useEffect(() => {
    const id = setTimeout(() => void init(), 0)
    return () => clearTimeout(id)
  }, [init])

  async function enable() {
    if (!vapidKey) return
    setBusy(true)
    setError('')
    try {
      const perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm !== 'granted') {
        setError('Notification permission was not granted.')
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      })
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })
      if (!res.ok) throw new Error('save failed')
      setSubscribed(true)
    } catch {
      setError('Could not enable notifications.')
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    setError('')
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        })
        await sub.unsubscribe()
      }
      setSubscribed(false)
    } catch {
      setError('Could not disable notifications.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Push Notifications</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Get a browser notification when a title you requested becomes available to watch.
        </p>
      </div>

      {status === 'loading' && <p className="text-sm text-muted-foreground">Loading…</p>}

      {status === 'unsupported' && (
        <p className="text-sm text-muted-foreground">
          This browser does not support push notifications.
        </p>
      )}

      {status === 'unconfigured' && (
        <p className="text-sm text-muted-foreground">
          Push notifications are not configured on this server.
        </p>
      )}

      {status === 'ready' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {subscribed ? 'Notifications are on for this device' : 'Notifications are off'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Browser permission: {permission}
              </p>
            </div>
            {subscribed ? (
              <button
                onClick={() => void disable()}
                disabled={busy}
                className="flex-shrink-0 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors disabled:opacity-50"
              >
                {busy ? 'Working…' : 'Turn off'}
              </button>
            ) : (
              <button
                onClick={() => void enable()}
                disabled={busy || permission === 'denied'}
                className="flex-shrink-0 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {busy ? 'Working…' : 'Turn on'}
              </button>
            )}
          </div>

          {permission === 'denied' && !subscribed && (
            <p className="text-xs text-muted-foreground">
              Notifications are blocked in your browser settings. Re-enable them there to turn this on.
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}
    </section>
  )
}
