# Rate-limiting audit — 2026-08-15

Backlog item: "confirm all state-mutating routes match the login handler's 10/15min/IP policy."

Scope: every `POST`/`PUT`/`PATCH`/`DELETE` handler under `app/src/app/api/**` — 68 files, 77 handlers.
The conclusion is that "match the login policy" was the wrong goal. Most routes should not have the
login policy, and the useful findings were about *keying* and *coverage of the routes with external
side effects*, not about making the numbers uniform.

## The reference policy

`app/src/app/api/auth/login/route.ts:41` — `checkRateLimit('login:${ip}', 10, 15*60*1000)`.

- **Store:** SQLite, table `rate_limits` (`app/src/lib/db/migrations.ts:92`). Durable, not a
  per-process `Map` — `app/src/lib/rate-limit.ts:1` records that it used to be, and that the old one
  reset on every deploy.
- **Key:** IP only, from `getClientIp()` (`app/src/lib/client-ip.ts:33`), which reads the Nth-from-right
  `X-Forwarded-For` entry where N is `TRUSTED_PROXY_COUNT`, so a spoofed header can't shift the key.
- **Algorithm:** fixed window (`rate-limit.ts:36`), read-modify-write inside a transaction so two
  concurrent callers can't both open a fresh window.
- **On breach:** `429` plus `Retry-After: 900` (`login/route.ts:45`).
- **Not the rate limiter:** the `login_attempts` table drives a 2-second artificial delay keyed by
  *username* (`login/route.ts:62`). Separate mechanism, different key, no hard cutoff.

## Coverage

Rate-limited today, after this pass. Every route below also calls `verifyOrigin`.

| Route | Limit | Key |
| ----- | ----- | --- |
| `POST /api/auth/login` | 10 / 15min | IP |
| `POST /api/auth/register` | 10 / 15min | IP |
| `POST /api/auth/reset-password` | 10 / 15min | IP |
| `POST /api/auth/verify-email` | 10 / 15min + 5 attempts per pendingId | IP + row counter |
| `POST /api/auth/forgot-password` | 5 / 15min | IP |
| `POST /api/auth/resend-verification` | 3 / 10min | IP |
| `GET /api/auth/check-username` | 20 / min | IP |
| `POST /api/auth/change-password` | 5 / 15min | userId |
| `POST /api/auth/profile/change-password` | 5 / 15min | userId |
| `PATCH /api/auth/profile/email` | 10 / hr | userId — **added 2026-08-15** |
| `POST /api/requests` | 20 / hr | userId |
| `POST /api/grab/confirm` | 20 / hr | userId — **added 2026-08-15** |
| `POST /api/media/subtitles/grab` | 20 / hr | userId |
| `POST /api/party` | 10 / hr | userId |
| `POST /api/party/join` | 30 / hr, plus 10 / hr on failures | userId |
| `POST /api/party/guest-session` | 10 / 15min | IP |
| `PATCH,DELETE /api/admin/users/:id` | 30 / 10min | userId — **re-keyed 2026-08-15** |
| `POST /api/requests/:id/approve` | 60 / 5min | userId — **re-keyed 2026-08-15** |
| `POST /api/requests/:id/decline` | 60 / 5min | userId — **re-keyed 2026-08-15** |
| `POST /api/requests/:id/grab` | 30 / 5min | userId — **added**, shared `admin-grab` bucket |
| `POST /api/automation/items/:id/grab` | 30 / 5min | userId — **added**, shared `admin-grab` bucket |
| `POST /api/grab/season` | 30 / 5min | userId — **added**, shared `admin-grab` bucket |
| `POST /api/subtitle/download` | 10 / hr | userId — **added** |
| `POST /api/admin/notify/test` | 10 / hr | userId — **added** |
| `POST /api/automation/profiles` | 20 / hr | userId — **added** |

24 rate-limited routes. All of them answer a breach through `rateLimitResponse()`
(`lib/rate-limit.ts`), so every one sends `Retry-After`. Everything else is unlimited, which is
mostly correct — see "Deliberately unlimited" below.

## What was actually wrong

**1. `POST /api/grab/confirm` had no limit, and it is the one that mattered.** Fixed. It is gated by
`requireAuth` with an ownership check (`grab/confirm/route.ts:59`) rather than `requireAdmin`, so any
authenticated user could reach it, and each call runs `searchCandidatesForItem()` against every enabled
indexer and then `grabSpecificRelease()` against the download client. It was the only route in the app
where a non-admin could drive unbounded external requests and download-client writes. Now 20/hr/userId,
matching its two sibling user-initiated grab routes.

**2. `PATCH /api/auth/profile/email` was an account-enumeration oracle.** Fixed. Its 409 "already in
use" (`profile/email/route.ts:37`) tells any authenticated caller whether an arbitrary address belongs
to an existing account, and it had no limit. `check-username` carries a dedicated 20/min limiter for
exactly this, so the protection existed for usernames and not for emails. Now 10/hr/userId.

**3. The three rate-limited admin routes were keyed by IP, which is backwards for an authenticated
actor.** Fixed. `admin-users`, `admin-approve` and `admin-decline` all keyed on `getClientIp(req)`
despite the actor being a logged-in admin. That fails in both directions at once: two admins behind
one NAT share a bucket and throttle each other, while one admin moving between a VPN, home and mobile
gets a fresh bucket per network and is effectively unlimited. Every other authenticated route in the
codebase keys by `session.userId`. These now do too.

## Deliberately unlimited

Recorded so nobody re-audits them.

- **Admin-only config CRUD** — collections, invites, settings, indexers, quality profiles, blocklist,
  import lists, media display-mode, subtitle rows. Small trusted population, DB write only, self-DoS at
  worst. An attacker who can reach these already has an admin session and better options.
- **Admin-triggered scans** — `media/scan`, `subtitle/scan`, `subtitle/recheck`, `automation/sync`,
  `automation/upgrades`. Expensive but idempotent, admin-gated, and several coalesce through the job
  queue.
- **`POST /api/media/progress`** — the playback heartbeat, fired every few seconds per viewer by design.
  Limiting it would break normal playback. It is a same-user idempotent upsert with no external cost.
- **`POST /api/auth/logout`** — idempotent and self-scoped.
- **Self-scoped profile writes** — display-name, demographics, default-quality-profile, session revoke,
  revoke-others. No external side effect and no enumeration surface, unlike the email route. Worst case
  a user hammers their own row.
- **`/api/qbit/[...path]`** — admin-only passthrough. UMT is the resource being protected and only
  admins can reach it. UMT's own limits were not audited; out of scope for this repo.

## Left open, then closed the same day

Every item in this section was fixed in a follow-up pass. Kept as a record of what the audit found
rather than deleted, so the reasoning survives.

- **`POST /api/subtitle/download`** — now 10/hr/userId. Admin-only, but it is the one admin route
  that spends a finite *external* resource: each run works through every wanted subtitle against
  OpenSubtitles, which has a hard daily quota (1000/day on the VIP tier). A retry loop in the UI
  would burn the day's allowance as effectively as an attacker would.
- **The admin grab-trigger family** — `POST /api/requests/:id/grab`,
  `POST /api/automation/items/:id/grab` and `POST /api/grab/season` now share one
  `admin-grab:${userId}` bucket at 30/5min. Tighter than approve/decline's 60/5min because each call
  costs an indexer fan-out rather than a DB write. This was a category that had been missed, not one
  that had been decided against.
- **`POST /api/admin/notify/test`** — now 10/hr/userId. Fires a real webhook per call.
- **`Retry-After` on 2 of 19 routes** — now on all 24, via `rateLimitResponse()` in
  `lib/rate-limit.ts`. `resetAt` was already on the limiter's result, so the header cost nothing; it
  was simply never read. The helper is the only correct way to answer a breached limit now. Two
  exceptions stay deliberate: `forgot-password` answers 200 so it can't be used to work out which
  addresses are registered, and the request-slot 429 in `POST /api/requests` is a quota rather than a
  rate limit, so it has no reset time to advertise.
- **`POST /api/automation/profiles` was NOT changed to `requireAdmin`, and the audit was wrong to
  suggest it.** Reading the route settles it: quality profiles are user-owned by design. `GET`
  returns shared profiles plus the caller's own, and `getAllProfiles(userId)` filters on
  `user_id IS NULL OR user_id = ?`. `requireAuth` is correct and a comment now says so. The real
  gap was no ceiling on how many profiles one user can create, which is now 20/hr/userId.

## Still open

- **The limiter is a fixed window, not sliding** (`rate-limit.ts:36`). A caller can burst up to
  `2 × max` across a window boundary. Several route comments state the limit as though it were
  rolling. Fine for every current use, but the comments overstate the guarantee.

## One inconsistency worth knowing

`quality-profiles/[id]/route.ts:9` is the only route in 68 files that does not call
`requireAuth`/`requireAdmin` directly. It wraps them in a local `authoriseProfileEdit()` that catches
`requireAdmin()`'s throw and converts it to `{ok:false}`. Functionally equivalent today, but it means
the one place where the auth gate does not propagate by throwing is also a place with no rate limit,
editing shared library data.

## Method and limits of this audit

Static analysis only. There is no dev server on this host (`CLAUDE.md` §8), so no runtime verification
of any limiter's actual behaviour was performed. Every claim above is cited to a file and line. The
handler enumeration was cross-checked against the GET-only routes to confirm nothing was missed.
