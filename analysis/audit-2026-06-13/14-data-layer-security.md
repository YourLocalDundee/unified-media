# Audit 14 — Data Layer, DB, and Cross-Cutting Security

**Scope:** `src/lib/dal.ts`, `src/lib/db/{index,migrations,seed}.ts`, `src/lib/utils.ts`, `src/lib/rate-limit.ts`, `src/lib/safe-redirect.ts`, `src/lib/csrf.ts`, `src/lib/settings/index.ts`, plus a repo-wide security sweep across `src/`.
**Date:** 2026-06-13 · **Mode:** READ-ONLY · **App:** unified-frontend v0.9.5 (Next.js 16, better-sqlite3, TypeScript)

---

## Summary

The SQLite data layer itself is competently built. **No SQL injection was found anywhere** in `lib/**` or `api/**`: every dynamic-SQL site (`quality-profiles/[id]`, `admin/users/[id]`, `indexer/config.ts`, `automation/monitor.ts`, `media-server/library.ts`, `requests/monitor.ts`) interpolates only allowlisted or internal column/ORDER-BY names and binds all values with `?`/named placeholders. Migrations are idempotent (`IF NOT EXISTS` + try/catch ALTERs); the one destructive recreation (`media_requests` CHECK widening) is `BEGIN/COMMIT`-wrapped with ROLLBACK on error and a schema-text guard. `seed.ts` is gated to an empty `users` table and never ships hardcoded credentials. No `eval`/`new Function`, no shell command injection (`probe.ts`/`transcode.ts` use `execFile`/`spawn` with argv arrays), no `password_hash` ever returned to a client, and no `NEXT_PUBLIC_` secret leakage.

The serious problems are **authorization gaps on mutating API routes**, not the DB primitives:

- **CRITICAL ×2** — `/api/qbit/[...path]` and `/api/jellyfin/sessions/{playing,progress,stopped}` have **no `requireAuth()` at all** and are not in the proxy's public list. Because `proxy.ts` only checks cookie *presence* (not validity, by design — CVE-2025-29927), any request bearing an arbitrary `unified-session` cookie bypasses the redirect and reaches the unguarded handler. The qBit proxy then runs destructive operations (`/torrents/delete`, `/torrents/add`, `/app/setPreferences`) using the server-held SID — a confused-deputy with no caller auth.
- **HIGH ×3** — `verifyOrigin` (CSRF) is called on only **12 of 51** mutating routes (the 8 `auth/*` + 4 `party/*`); the other 39 omit it. `verifyOrigin` itself uses a **bypassable `startsWith` prefix** match. `monitored_items` has **no UNIQUE constraint** → duplicate rows (confirmed).
- **MEDIUM** — seed re-fires whenever `users` is empty; seerr webhook is unauthenticated when its secret env var is unset; request-create runs 4–6 sequential writes with no transaction; hot paths do synchronous full-table scans + JS `.find`; `logEvent` awaits an outbound geo-IP HTTP call on the login path.

### Counts by severity

| Severity | Count |
|---|---|
| CRITICAL | 2 |
| HIGH | 3 |
| MEDIUM | 7 |
| LOW | 6 |
| **Total** | **18** |

---

## CRITICAL

### A14-C1 — qBittorrent proxy `/api/qbit/[...path]` has no auth guard (confused-deputy)
**Severity:** CRITICAL
**File:** `src/app/api/qbit/[...path]/route.ts:19,32` (GET + POST); proxy gap `src/proxy.ts:19-37,52-67`
**What's wrong:** Neither `GET` nor `POST` calls `requireAuth()`/`requireAdmin()` (confirmed — the file imports only `qbitFetch`/session helpers). The route forwards arbitrary sub-paths to qBittorrent's Web API using the server-held `SID` cookie, including destructive endpoints (`/torrents/delete?deleteFiles=true`, `/torrents/add`, `/app/setPreferences`). `/api/qbit` is **not** in `proxy.ts` `PUBLIC_PATHS`, so the proxy would redirect a cookieless request — but `proxy.ts` only checks `request.cookies.has('unified-session')` (presence, never validity, by stated design). Any request carrying a junk `unified-session=anything` cookie passes the proxy and reaches the handler, which performs the qBit operation with full server credentials and **never validates the session**.
**Why it matters:** An attacker who can set/forge any value for the `unified-session` cookie (trivial — it is not validated at the edge) gets unauthenticated control of the torrent client: delete all torrents and their files, add arbitrary magnets, rewrite qBittorrent preferences. The app's own threat model (CLAUDE.md) explicitly says the proxy is "NOT a security boundary" — so the missing in-handler auth is the whole defense, and it is absent.
**Suggested fix:** Add `await requireAuth()` (admin is defensible given the destructive surface) at the top of both handlers. Do not rely on `proxy.ts`.

### A14-C2 — Jellyfin session routes `/api/jellyfin/sessions/*` have no auth guard
**Severity:** CRITICAL
**File:** `src/app/api/jellyfin/sessions/progress/route.ts:9`, `.../playing/route.ts:10`, `.../stopped/route.ts:9`
**What's wrong:** All three POST handlers read `await req.json()` and forward the raw client body straight to the internal Jellyfin server via `jellyfinFetch('/Sessions/Playing/...')` with **no `requireAuth()`** (confirmed by grep — none import the DAL). Same proxy situation as A14-C1: not in `PUBLIC_PATHS`, so only the presence-only cookie check stands in front of them.
**Why it matters:** Same junk-cookie bypass yields unauthenticated, attacker-shaped writes to the internal Jellyfin instance (using the server's `JELLYFIN_API_KEY` in `jellyfinFetch`), letting an outsider forge/poison playback-session state on the backing media server. The body is unvalidated, so whatever Jellyfin's `/Sessions/*` accepts is reachable.
**Suggested fix:** Add `await requireAuth()` to all three, and validate the forwarded body shape (itemId/sessionId) rather than passing it through verbatim.

---

## HIGH

### A14-H1 — CSRF: `verifyOrigin()` missing on 39 of 51 mutating routes
**Severity:** HIGH
**File:** helper `src/lib/csrf.ts:7`; missing across `src/app/api/admin/**`, `requests/**`, `automation/**`, `indexer/**`, `subtitle/**`, `quality-profiles/**`, `media/{playback,progress,scan}`, `auth/{change-password,profile/{demographics,display-name,email,sessions/[id],sessions/revoke-others}}`, `qbit/[...path]`, `jellyfin/sessions/*`, `seerr/webhook`
**What's wrong:** Grepping every `POST/PUT/PATCH/DELETE` handler for a `verifyOrigin(` *call*: exactly 12 files call it (the 8 `auth/*` and 4 `party/*` routes). The other **39 mutating routes never call it**. The session cookie is `SameSite=lax`, which does NOT block top-level cross-site form POSTs/navigations, so a malicious page can drive authenticated state changes.
**Why it matters:** Classic CSRF. Luring a logged-in admin to an attacker page allows `POST /api/admin/users/[id]` (role flip), `DELETE /api/admin/users/[id]`, `POST /api/requests/[id]/approve|decline`, `PATCH /api/auth/profile/email` (account-takeover prep), quality-profile mutation, etc. The defense is already written — it is simply not wired in.
**Suggested fix:** Call `if (!verifyOrigin(req)) return 403` at the top of every mutating handler, or enforce it centrally for all non-GET `/api/**` in `src/proxy.ts` so a new route cannot forget it.

> **Definitive route table** (`vO` = `verifyOrigin(` call count; auth = has `requireAuth|requireAdmin`):

| vO | auth | route |
|----|------|-------|
| 0 | admin | admin/invites/route.ts · admin/invites/[code]/route.ts · admin/settings/route.ts (PUT) · admin/users/[id]/route.ts · admin/users/[id]/{activate,reset-password,suspend}/route.ts |
| 0 | auth | auth/change-password · auth/profile/{demographics,display-name,email,sessions/[id],sessions/revoke-others} |
| 0 | admin | automation/items/route.ts · automation/items/[id]/route.ts · automation/items/[id]/grab/route.ts · automation/sync/route.ts · indexer/route.ts · indexer/[id]/route.ts · indexer/[id]/{activate,test}/route.ts · quality-profiles/route.ts · quality-profiles/[id]/route.ts · subtitle/{download,scan}/route.ts · subtitle/[id]/route.ts |
| 0 | auth | requests/route.ts · requests/[id]/route.ts · requests/[id]/{approve,decline,grab}/route.ts · media/{playback,progress,scan}/route.ts |
| 0 | **none** | qbit/[...path]/route.ts · jellyfin/sessions/{playing,progress,stopped}/route.ts · seerr/webhook/route.ts |
| 1 | mixed | auth/{login,logout,register,forgot-password,reset-password,verify-email,resend-verification,profile/change-password} · party/route.ts · party/join/route.ts · party/[partyId]/route.ts · party/[partyId]/leave/route.ts |

### A14-H2 — `verifyOrigin()` uses a bypassable prefix match (and trusts missing Origin)
**Severity:** HIGH
**File:** `src/lib/csrf.ts:11-12`
**What's wrong:** `ALLOWED_ORIGINS.some(o => origin === o || origin.startsWith(o))`. The `startsWith` arm means an attacker origin such as `https://unified.minijoe.dev.evil.com` or `http://localhost:3001.evil.com` **passes** (it begins with an allowed string — an Origin has no path delimiter, so the host runs straight into the attacker domain). Also, a missing `Origin` header returns `true` (allow).
**Why it matters:** Even the 12 routes that DO call `verifyOrigin` are partially defeatable, so fixing A14-H1 by calling this helper would still leave a hole. `startsWith` on an Origin is a well-known CSRF bypass.
**Suggested fix:** Compare full origins for exact equality only (`origin === o`); delete the `startsWith`. Optionally cross-check against `Host`/`X-Forwarded-Host`.

### A14-H3 — `monitored_items` has no UNIQUE constraint → duplicate rows accumulate
**Severity:** HIGH
**File:** schema `src/lib/db/migrations.ts:160-176`; insert `src/lib/automation/monitor.ts:88-117`
**What's wrong:** `monitored_items` defines only non-unique indices (`idx_monitored_status`, `idx_monitored_tmdb`). `createItem()` does a bare `INSERT` with no `ON CONFLICT` and no pre-check. Multiple call sites insert the same `(tmdb_id, type)`: `tryAutoApprove()` (auto-approve.ts:59), the interactive-grab path (`requests/route.ts:167`), and the seerr webhook (`seerr/webhook/route.ts:137`). The "already exists" guards in those callers only swallow errors whose message contains that string — but a plain INSERT into a table with **no** unique index never throws it, so each path silently creates another duplicate `wanted` row. Confirms the sibling-audit finding. (For contrast, `media_requests` *does* have a correct `UNIQUE(user_id, tmdb_id, media_type)` at migrations.ts:316.)
**Why it matters:** Duplicate monitored rows make the grab loop search/grab the same title repeatedly, inflate the want list, and make status transitions ambiguous (no canonical row). The seerr webhook's own `findItemForRequest` idempotency check (webhook:124) papers over it only on that one path.
**Suggested fix:** Add `CREATE UNIQUE INDEX IF NOT EXISTS idx_monitored_unique ON monitored_items(tmdb_id, type)` (decide NULL-tmdb handling) and switch `createItem` to `INSERT ... ON CONFLICT(tmdb_id,type) DO UPDATE`.

---

## MEDIUM

### A14-M1 — `seedAdmin` re-seeds whenever the users table is empty (lockout-recovery footgun)
**Severity:** MEDIUM
**File:** `src/lib/db/seed.ts:30-32`
**What's wrong:** The only guard is `SELECT COUNT(*) FROM users == 0`. If all users are ever deleted (operator action, restore, failed migration), the next `getDb()` silently recreates an `admin` from `ADMIN_USERNAME`/`ADMIN_PASSWORD` env (or a generated password). Confirms the sibling finding. There is no "seeded" sentinel — seeding is purely state-derived.
**Why it matters:** An env `ADMIN_PASSWORD` left in `.env.local` becomes a permanent re-entry credential: anyone who can empty the table (or who retains the original password) regains admin. It is an implicit backdoor-recovery path.
**Suggested fix:** Gate seeding on an explicit one-time marker (e.g. `app_settings('seeded','1')` written in the same transaction), not table emptiness.

### A14-M2 — Seerr webhook processes unauthenticated when `SEERR_WEBHOOK_SECRET` is unset
**Severity:** MEDIUM
**File:** `src/app/api/seerr/webhook/route.ts:82-91`
**What's wrong:** Signature verification (HMAC-SHA256, timing-safe — good when enabled) is **skipped entirely** if `SEERR_WEBHOOK_SECRET` is absent; the handler logs a warning and proceeds to `createItem` + `grabItem` and to UPDATE `media_requests` status. The route has no `requireAuth` (it is server-to-server) and is not in `PUBLIC_PATHS`, so a cookieless caller is redirected by the proxy, but a junk-cookie caller (A14-C1 pattern) reaches it.
**Why it matters:** With the secret unset (the documented default leaves it optional), an attacker who clears the proxy can POST forged `MEDIA_APPROVED` events to trigger grabs (download arbitrary tmdbId content) or flip request statuses to `available`.
**Suggested fix:** Treat a missing secret as fail-closed (reject), or require the secret in production; document it as mandatory.

### A14-M3 — Request creation runs 4–6 sequential writes with no transaction
**Severity:** MEDIUM
**File:** `src/app/api/requests/route.ts:125-216`
**What's wrong:** One POST does: `createRequest` (INSERT) → UPDATE method/language → (interactive) UPDATE preferred_release → external `addTorrent` → `createItem` (INSERT monitored) → `recordGrab` (INSERT) → `updateItem` (UPDATE) → UPDATE status='approved'. None is wrapped in `db.transaction()`. A throw/crash midway leaves a half-built request (row with `request_method` unset, or a torrent added while the request is still `pending`, or a monitored item with no grab_history), and the 48h-slot accounting (`getActiveAutoApprovedCount`) can drift.
**Why it matters:** better-sqlite3 makes atomic multi-write trivial. Partial failures corrupt request/monitor state.
**Suggested fix:** Wrap the pure-DB writes in `db.transaction(...)`; keep the external `addTorrent` network call outside it and only commit the `approved` status after the add succeeds.

### A14-M4 — Synchronous full-table scans + JS `.find` in hot request paths
**Severity:** MEDIUM
**File:** `src/app/api/requests/route.ts:189-193`; `src/lib/requests/auto-approve.ts:88-93`; helper `src/lib/automation/monitor.ts:58-63`
**What's wrong:** Inside the POST handler (and the auto-approve IIFE) the code calls `getAllItems()` — `SELECT * FROM monitored_items ORDER BY created_at DESC` returning the whole table — then linearly `.find()`s the just-created item by `(tmdb_id, type)`. better-sqlite3 is synchronous, so this scan+sort blocks the single Node thread for the request; it is also an N+1-by-scan when an indexed `WHERE tmdb_id=? AND type=?` (the `idx_monitored_tmdb` index already exists) would do.
**Why it matters:** Serializes the event loop on a growing table under concurrent requests.
**Suggested fix:** Add `getItemByTmdb(tmdbId, type)` using the existing index; replace both `getAllItems().find(...)` sites.

### A14-M5 — `logEvent` awaits an outbound geo-IP HTTP call on the login hot path
**Severity:** MEDIUM
**File:** `src/lib/dal.ts:159-188` → `getCountryFromIP` (`src/lib/geo.ts`)
**What's wrong:** `logEvent()` is `await`ed in the login flow (login route:90,99) and, when an IP is present, makes a network call to ip-api.com before the synchronous DB insert. It is try/catch-wrapped (never throws), but a slow/hanging third party adds external latency to every audited request.
**Why it matters:** A stalled ip-api.com response stalls login responses; audit logging should never gate user-facing latency on a third-party fetch.
**Suggested fix:** Don't `await` audit logging on the hot path (fire-and-forget), or insert the row immediately and enrich country/city async with a short fetch timeout/abort.

### A14-M6 — `sessions.user_id` has no FK; cleanup is manual
**Severity:** MEDIUM
**File:** `src/lib/db/migrations.ts:45-53`; manual cleanup `src/app/api/admin/users/[id]/route.ts:31`
**What's wrong:** FK enforcement is ON (`db/index.ts:32`) and newer tables (`watch_parties`, `watch_party_members`) declare real FKs, but `sessions` (and `audit_log`, `watch_events`, `media_requests`, `login_attempts`) have no `FOREIGN KEY (user_id) REFERENCES users(id)`. User deletion relies on manual `DELETE FROM sessions/watch_events` before the user row; any future delete path that forgets this orphans rows. A deleted user's still-valid session is also not auto-revoked at the DB layer (though `getSession`'s `is_active`/JOIN guard mitigates suspension).
**Why it matters:** Orphaned sessions/audit rows on incomplete deletes; correctness fragility.
**Suggested fix:** Add `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE` on fresh DBs (same fresh-only pattern used for the party tables, to avoid recreating live tables).

### A14-M7 — `rate-limit.ts` is per-process in-memory; resets on restart, not shared
**Severity:** MEDIUM
**File:** `src/lib/rate-limit.ts:1-21`
**What's wrong:** A module-level `Map`. Counters reset on every deploy/restart and are per-instance. The login/registration brute-force limits (10/15min) therefore evaporate on restart, and the full-`store` sweep runs O(n) on every call.
**Why it matters:** An attacker resets their budget by waiting for/triggering a restart; horizontal scaling (which the party feature explicitly contemplates) makes limits per-pod.
**Suggested fix:** Acceptable for the current single-instance LAN deployment — document the limitation. If brute-force resistance matters, back it with the existing `login_attempts` table or a shared store.

---

## LOW

### A14-L1 — Indexer GET returns stored `api_key` + `pending_credentials` to the client
**Severity:** LOW
**File:** `src/app/api/indexer/route.ts:7-10` (`SELECT *` via `getAllIndexers`, `indexer/config.ts:7-11`)
**What's wrong:** `GET /api/indexer` is `requireAdmin`-gated (good) but returns full `Indexer` rows including the `api_key` and `pending_credentials` columns to the admin's browser JS. The Torznab/indexer API keys are secrets that don't need to reach the client to render the admin list.
**Why it matters:** Admin-only, so impact is limited, but it needlessly exposes indexer credentials to client-side code / browser devtools / any XSS on the admin page.
**Suggested fix:** Project a column subset (omit `api_key`, `pending_credentials`) for the list response; only send them where actually edited.

### A14-L2 — `invite_codes` single-use consumption is a non-atomic read-then-write
**Severity:** LOW
**File:** schema `src/lib/db/migrations.ts:34-44`; consumption in `auth/register` / `invite/[code]`
**What's wrong:** `use_count` vs `max_uses` is checked then incremented without an atomic guarded UPDATE, so two concurrent registrations on a `max_uses=1` code could both pass.
**Why it matters:** Low — invites are no longer enforced at registration (CLAUDE.md) — but a single-use invite could be consumed twice under a race.
**Suggested fix:** `UPDATE invite_codes SET use_count = use_count + 1 WHERE code = ? AND (max_uses = 0 OR use_count < max_uses)` and check `changes === 1`.

### A14-L3 — `searchItems` builds a LIKE pattern without escaping `%`/`_`
**Severity:** LOW
**File:** `src/lib/media-server/library.ts:49-54`
**What's wrong:** `const like = '%' + query + '%'` then `... LIKE ?`. The value is parameterized (no SQLi), but `%`/`_` act as wildcards and there is no `ESCAPE`, so a query of `%` matches everything.
**Why it matters:** Not injection; lets a user run an unbounded wildcard scan (mild). Bounded by `LIMIT`.
**Suggested fix:** Escape `%`, `_`, `\` and add `ESCAPE '\'`, or strip wildcard chars.

### A14-L4 — `getSafeRedirectUrl` doesn't normalize backslashes / encoded forms
**Severity:** LOW
**File:** `src/lib/safe-redirect.ts:1-13`
**What's wrong:** Blocks `//` and `scheme:` before first `/` and requires a leading `/`, but does not handle `\` (some browsers treat `/\evil.com` as protocol-relative) or percent-encoded `%2f%2f`. The `indexOf(':',1)` check returns -1 when there is no second slash, so `/foo:bar` is allowed (stays same-origin, so impact nil).
**Why it matters:** Edge open-redirect hardening; the leading-`/` rule already blocks absolute external URLs, so practical risk is low.
**Suggested fix:** Reject inputs containing `\`, or construct `new URL(from, base)` and verify `.origin === base.origin`.

### A14-L5 — `makeId` modulo bias + duplicated implementation
**Severity:** LOW
**File:** `src/lib/dal.ts:39-46`; copy in `src/lib/db/seed.ts:20-27`
**What's wrong:** `chars[byte % 62]` introduces slight modulo bias (bytes 0–7 marginally favored). For 32-char session IDs entropy is still ~190 bits (cosmetic), but the function is copy-pasted into seed.ts (8-char user IDs).
**Why it matters:** Negligible security impact at 32 chars; the duplicate risks divergence.
**Suggested fix:** Rejection-sample or use `crypto.randomUUID()`/hex; export one `makeId` and import it in seed.ts.

### A14-L6 — Migrations have no schema_version ledger; one guard is schema-text matching
**Severity:** LOW
**File:** `src/lib/db/migrations.ts:16-570` (esp. the recreation guard at :356-360)
**What's wrong:** All migrations live in one function relying on `IF NOT EXISTS` / try-catch-ALTER and code-position ordering ("all ALTERs after all CREATEs"). There is no `schema_migrations` ledger (no record of what ran, no down-migrations). The `media_requests` recreation uses `!tblInfo.sql.includes("'expired'")` — parsing `sqlite_master.sql` text — as its idempotency guard, which is fragile if the DDL text is ever reformatted. (The recreation transaction itself is correctly ROLLBACK-guarded — good.)
**Why it matters:** Works and is re-run-safe today, but offers no audit trail and the text-based guard could misfire on a reformatted schema.
**Suggested fix:** Add a `schema_migrations(version INTEGER PRIMARY KEY, applied_at)` ledger and gate each step on its version; replace the `sql.includes("'expired'")` guard with a version check.

---

## Notes / verified-clean

- **No SQL injection** anywhere. Every `${...}` inside a SQL string is one of: a constant ORDER BY from a fixed `SORT_CLAUSE` map (`library.ts:21-28`), an allowlisted column name (`indexer/config.ts:56-67`, `admin/users/[id]/route.ts:59-74`, `quality-profiles/[id]/route.ts:43-52`, `automation/monitor.ts:120-130`), a constant SELECT prefix (`requests/monitor.ts` `JOIN_USERS`), or a migration column list built from a server-side allowlist (`migrations.ts:368-385`). All values bind with `?`/named params.
- **No `eval`/`new Function`.** The only `dangerouslySetInnerHTML` is a static no-flash theme bootstrap script in `layout.tsx:34` (no user input).
- **No shell command injection.** `probe.ts:24` uses `execFile(FFPROBE_BIN, [argv])`; `transcode.ts:278,405` uses `spawn(FFMPEG_BIN, args)` — argv arrays, no shell string. File paths originate from the DB/scanner (disk scan), not request bodies, so even argv values aren't attacker-controlled.
- **No `password_hash` returned to a client.** All `password_hash` reads are server-side `verifyPassword`/UPDATE; the `SELECT *` from `users` in `auth/login/route.ts:62` is consumed server-side and only `{username, role}` (or `{requiresPasswordChange}`) is returned.
- **No `NEXT_PUBLIC_` secret leakage** beyond `NEXT_PUBLIC_APP_URL`. No `console.log` of passwords/tokens/keys (the two matches are a "secret not set" warning and an import-path log line).
- **Seed password handling** is sound: env password is policy-validated; otherwise a random 24-hex+suffix password is generated, printed to stderr, and `force_pw_change=1` is set. bcrypt cost 12.
- Admin read routes (`admin/monitoring`, `admin/users`, `admin/audit`) are all `requireAdmin`-guarded; the CSRF/auth gaps above are about *mutating* routes and the two unguarded proxies.
