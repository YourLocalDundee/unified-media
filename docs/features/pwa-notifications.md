# Mobile PWA + Web Push Notifications (v0.11.7 / v0.11.9)

Two features that together make the app installable and able to notify a user outside the browser tab.

## Installable PWA shell (v0.11.7)

- `src/app/manifest.ts` — Next.js metadata-route convention, auto-served at `/manifest.webmanifest`
  with a `<link rel="manifest">` injected on every page. Dark-theme colors (`background_color`
  `#0f1729`, `theme_color` `#3c83f6`), `display: 'standalone'`, both `any` and `maskable` SVG + PNG
  icons (`/icons/icon.svg`, `icon-192.png`, `icon-512.png`).
- `ServiceWorkerRegistration.tsx` — a client component with **no state**, registers `public/sw.js`.
  Stateless deliberately, to stay outside the `set-state-in-effect` lint rule.
- Root layout adds `theme-color` viewport entries + `apple-web-app` meta/touch-icon for iOS install.

### Service worker cache boundary (`public/sw.js`) — load-bearing

This app has **no external auth gateway**; sessions are its own per-request-validated SQLite cookies,
and Cache Storage is **not** scoped per user. The service worker's caching rule is therefore absolute
and documented at the top of the file itself:

- **Cache (cache-first):** `/_next/static/*` (content-hashed, immutable), the manifest + icons,
  and `/offline`.
- **Never cache:** `/api/*` (always network-only) and every other HTML document — home, library,
  browse, downloads, etc. all render per-user data server-side. A cached copy could show one user
  another user's session UI, survive logout, or serve stale permissions.
- Everything not explicitly allowlisted falls through to a plain network fetch with zero cache
  interaction — the safety net for the rule above.
- Navigation requests use network-first with `/offline` as the only offline fallback — the app does
  not attempt to serve library/browse data offline, since that data is auth-gated.

`/offline` (`src/app/offline/page.tsx`) is a static, no-auth fallback shell, added to `proxy.ts`
`PUBLIC_PATHS` so it's reachable without a session.

## Web Push notifications (VAPID) (v0.11.9)

Fires a browser push to the user who requested a title when it becomes available, sent alongside the
existing Discord/ntfy channels through the single `notifyMediaAvailable` funnel
(`src/lib/notify/index.ts`) — same trigger (the availability cron / Seerr webhook transition), same
best-effort semantics (a push failure is logged and swallowed, never breaks the notification path).

| Piece | What it is |
| ----- | ---------- |
| `src/lib/push.ts` | VAPID config (`configureVapid()`, reads env fresh) + `sendPushToUser(userId, payload)`. Mirrors `email.ts`'s graceful-degradation shape: **no-ops with a console log when VAPID env is unset** — nothing throws, the app runs exactly as before. |
| `push_subscriptions` table | `endpoint` (UNIQUE), `p256dh`, `auth`, `user_id`. Re-subscribing from the same browser upserts rather than duplicating. |
| `POST /api/push/subscribe` / `unsubscribe` | Store/remove the current user's `PushSubscription` JSON. |
| `GET /api/push/vapid-public-key` | Public key the browser needs to call `PushManager.subscribe()`. |
| `PushNotificationToggle.tsx` | Subscribe/unsubscribe toggle on `/settings/profile`. |
| `public/sw.js` `push` / `notificationclick` | Previously stubs, now implemented: `push` shows the notification from the server's `{title, body, icon, data.url}` JSON payload; `notificationclick` focuses an existing tab on the target URL if one is open, else opens a new window. Isolated from the cache-boundary logic above. |

**Dead-endpoint pruning:** `sendPushToUser` sends to every stored subscription for a user; if the push
service reports a subscription gone (`404`/`410`), the row is deleted so it isn't retried forever.

**Deploy env** (optional — feature no-ops if unset, like SMTP): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_SUBJECT` (a `mailto:` or `https:` contact URI). Generate a pair with
`npx web-push generate-vapid-keys`.
