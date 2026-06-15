# Audit 09 — Admin: Users, Invites, Activity, Audit, RBAC

Scope: `src/app/admin/{page,users,users/[id],invites,activity,audit}` and
`src/app/api/admin/{users,users/[id]/*,invites,invites/[code],activity,activity/export,audit,audit/export,stats}`.
Read-only review across three lenses: logic flow / RBAC, button & interaction wiring, and optimization.

## Summary

RBAC server-side enforcement is the bright spot: **every** in-scope API route calls `requireAdmin()`
as its first statement (verified line-by-line), and `requireAdmin()` (`src/lib/dal.ts:132`) correctly
chains `requireAuth()` then checks `role === 'admin'`. The session JOIN also enforces `is_active = 1`
so suspended admins lose access. UI hiding is backed by real server checks.

The serious problems are elsewhere. **No admin mutation route verifies request Origin** (`verifyOrigin`
exists and is used on `/api/auth/register` but is absent from every admin route) — a logged-in admin
can be CSRF'd into suspending/deleting/promoting users via a simple cross-site `fetch`/form, because
the session cookie is `SameSite=lax` and these are top-level-navigable POST/PATCH/DELETE. **Last-admin
lockout is possible**: an admin can demote or suspend *another* admin with no "is this the last admin"
guard, and can suspend every other admin then themselves-via-the-other path, bricking the install.
**Invite `use_count` is never incremented anywhere** — `max_uses` is pure decoration; a single code is
infinitely reusable. **The audit CSV export is vulnerable to CSV/formula injection** and **both export
endpoints buffer the entire table in memory** (no streaming) despite the file comment claiming "streams."
Several UI buttons fire-and-forget with no `res.ok` check, so a 400/403/429/500 silently looks like success.

Also: reset-password returns the plaintext temp password and the UI shows it in a `window.alert()` (and
it is generated with a weak/biased character routine), suspend does not revoke active sessions, and
rate-limiting is applied only to `users/[id]` PATCH/DELETE — every other mutation (suspend, activate,
reset-password, invite create/revoke) is unthrottled.

## Counts

| Severity | Count |
|---|---|
| CRITICAL | 2 |
| HIGH | 5 |
| MEDIUM | 7 |
| LOW | 5 |
| **Total** | **19** |

---

## CRITICAL

### A9-01 — No CSRF/Origin check on any admin mutation route
- **Severity:** CRITICAL
- **File:** `src/app/api/admin/users/[id]/route.ts:13,38`; `users/[id]/suspend/route.ts:10`; `users/[id]/activate/route.ts:9`; `users/[id]/reset-password/route.ts:22`; `invites/route.ts:29`; `invites/[code]/route.ts:8`. Compare `src/lib/csrf.ts` + `src/app/api/auth/register/route.ts:90`.
- **What's wrong:** `verifyOrigin()` is implemented and used on the public register route, but **none** of the admin state-mutating routes call it. Auth is by the `unified-session` cookie, which is `SameSite=lax` (`src/lib/dal.ts:104`). `lax` still sends the cookie on top-level cross-site POST navigations and (for some flows) is the only barrier; there is no CSRF token and no Origin/Referer check. A malicious page an admin visits can issue `fetch('https://unified.minijoe.dev/api/admin/users/<id>', {method:'DELETE', credentials:'include'})` or auto-submit a form to suspend/promote/delete.
- **Why it matters:** Full account-takeover / destructive admin actions triggered by an admin merely browsing a hostile page. This is the highest-impact gap because it bypasses all the otherwise-correct RBAC.
- **Suggested fix:** Add `if (!verifyOrigin(req)) return 403` to the top of every admin mutation handler (after `requireAdmin`), exactly as `register/route.ts` does. For DELETE/PATCH the `req` is already in scope; the no-arg POST handlers (`suspend`, `activate`, `reset-password`) must accept and inspect `req`. Consider a shared wrapper so no route can forget.

### A9-02 — Last-admin lockout: admins can demote/suspend other admins with no floor
- **Severity:** CRITICAL (availability / self-DoS, account-recovery)
- **File:** `src/app/api/admin/users/[id]/route.ts:55-64` (PATCH role); `users/[id]/suspend/route.ts:14`.
- **What's wrong:** Self-protection guards only block acting on **your own** id: PATCH refuses `id === session.userId && role !== 'admin'` (no self-demote) and suspend refuses `id === session.userId`. There is **no check on the number of remaining admins**. Admin A can demote Admin B to `user`, or suspend Admin B. With two admins, each can knock the other down; with one admin who has a second admin account, all admin access can be removed. Nothing prevents reducing the system to **zero active admins**, after which `/admin/*` is unreachable by anyone and there is no in-app recovery (re-seeding only fires on an *empty* users table — `src/lib/db/seed.ts`).
- **Why it matters:** Permanent loss of administrative control over the deployment; only DB surgery recovers it. Also an insider-risk path (one admin silently strips another).
- **Suggested fix:** Before any demote (`role: admin→user`), delete, or suspend that targets an admin, run `SELECT COUNT(*) FROM users WHERE role='admin' AND is_active=1` and reject if the operation would drop it below 1. Apply on PATCH (demote), DELETE already blocks admins, and suspend (currently allows suspending another admin).

---

## HIGH

### A9-03 — Invite `use_count` never incremented; `max_uses`/single-use is not enforced
- **Severity:** HIGH
- **File:** `src/app/api/admin/invites/route.ts:34-36` (insert with `use_count=0`); `src/app/invite/[code]/page.tsx:25-27`; registration never touches invites (`src/app/api/auth/register/route.ts` has no invite logic). Grep confirms `use_count` is only ever read/inserted, never `UPDATE`d (`grep -rn use_count src` → zero increments).
- **What's wrong:** The invite landing page validates `max_uses = 0 OR use_count < max_uses`, but `use_count` is initialized to 0 and **no code path ever increments it** and **no code path marks `used_by`/`used_at`**. Registration is open-enrollment and ignores the code entirely. So a `max_uses = 1` invite is redeemable an unlimited number of times and never shows as "used."
- **Why it matters:** Any invite intended as single-use or capped is effectively unlimited; the admin UI's "used / active" accounting (`admin/invites/page.tsx:73-74`) is always wrong. If the deployment ever re-enables invite-gated signup expecting these limits, it silently fails open.
- **Suggested fix:** On successful registration via an invite, atomically `UPDATE invite_codes SET use_count = use_count + 1, used_by = ?, used_at = ? WHERE code = ? AND (max_uses = 0 OR use_count < max_uses)` and treat `changes === 0` as "code exhausted." If invites are intentionally decorative now, remove the misleading `max_uses`/`use_count` UI and validation so it doesn't imply a guarantee.

### A9-04 — Audit CSV export is vulnerable to CSV / formula injection
- **Severity:** HIGH
- **File:** `src/app/api/admin/audit/export/route.ts:12-19,65-73` (`csvField`). Contrast the safer activity export `src/app/api/admin/activity/export/route.ts:29-32`.
- **What's wrong:** `csvField()` quotes cells containing `,`, `"`, `\n` but does **not** neutralize a leading `=`, `+`, `-`, `@`, tab, or CR. The exported `details` and `username`/`ip` fields are attacker-influenceable: audit `details` is built from request input in several places, and a username is user-chosen (the username regex `^[a-zA-Z0-9_]{3,20}$` blocks formula chars, but `details` JSON and IP/`X-Forwarded-For` are not so constrained). When the admin opens `audit-log.csv` in Excel/Sheets, a cell like `=HYPERLINK(...)` / `=cmd|'/c ...'!A1` executes.
- **Why it matters:** Code/formula execution in the admin's spreadsheet from data originating with untrusted users — classic CSV injection escalating into the admin's workstation.
- **Suggested fix:** In `csvField`, if the string starts with `= + - @ \t \r`, prefix with a single quote (`'`) or a leading tab, *and* keep the existing quote-escaping. (The activity export's `JSON.stringify` per-cell happens to defang most of this but still allows a leading `=` after the stripped quote; harden both.)

### A9-05 — Both CSV exports buffer the entire table in memory (no streaming, no bound)
- **Severity:** HIGH (DoS / OOM)
- **File:** `src/app/api/admin/audit/export/route.ts:47-75`; `src/app/api/admin/activity/export/route.ts:19-35`.
- **What's wrong:** Each export does `.all()` to pull **every** row of `audit_log` / `watch_events` into a JS array, then `.map(...).join('\n')` to build one giant string held entirely in memory before responding. The file header comment claims "Streams the full ... table" but it does the opposite. There is no `LIMIT`, no date floor required, no `ReadableStream`, no chunking.
- **Why it matters:** On a long-lived install these tables grow without bound (audit_log gets a row per admin action + every `logEvent`; watch_events per playback). A single export can spike memory to multiples of the table size (rows + strings + the joined buffer) and block the event loop during the synchronous better-sqlite3 `.all()` + `map`/`join`, risking OOM on the container.
- **Suggested fix:** Stream with a `ReadableStream` driven by a better-sqlite3 `.iterate()` cursor, writing the header then one CSV line per row; set `Transfer-Encoding: chunked`. At minimum cap rows / require a bounded `from`/`to` window and paginate.

### A9-06 — reset-password returns plaintext temp password; UI exposes it via `alert()`
- **Severity:** HIGH
- **File:** `src/app/api/admin/users/[id]/reset-password/route.ts:25-32` (returns `{ tempPassword }`); `src/app/admin/users/[id]/page.tsx:57-62` (`alert(...)`).
- **What's wrong:** The endpoint returns the cleartext temporary password in the JSON response, and the client surfaces it with `window.alert()`. The plaintext therefore lands in: the response body (proxies/BunkerWeb access logs / any logging middleware), browser memory, and a blocking modal that is trivially shoulder-surfed and screenshotted. There is no out-of-band delivery and no expiry on the temp credential (only `force_pw_change=1`). The generator (`genTempPw`, lines 11-19) draws from an **uppercase+digits-only** alphabet then splices a fixed literal `"x!"` at a fixed position — so every temp password matches the pattern `[A-Z0-9]{8}x![A-Z0-9]{2}...`, which is low-entropy and predictable in structure.
- **Why it matters:** Admin-reset credentials are a prime target; returning/displaying them in band widens exposure, and the predictable structure + small effective alphabet weakens them against anyone who briefly observes a fragment. `force_pw_change` mitigates but the window between reset and first login is exploitable, and the temp password never expires on its own.
- **Suggested fix:** Prefer not returning the password at all — deliver out-of-band (email reset link) or at least make the temp credential single-use with a short TTL stored as a one-time token. If a temp password must be shown, render it in a dismissible in-DOM component (not `alert`), copy-to-clipboard, and generate it from a full mixed-case+symbol CSPRNG alphabet without a fixed literal splice. Ensure it is never logged.

### A9-07 — Suspend does not revoke the target's active sessions
- **Severity:** HIGH
- **File:** `src/app/api/admin/users/[id]/suspend/route.ts:15` (only sets `is_active = 0`).
- **What's wrong:** Suspending flips `is_active = 0` but leaves the user's `sessions` rows intact. *Mitigant:* `getSession()` JOINs `u.is_active = 1` (`src/lib/dal.ts:73`), so a suspended user is blocked on their **next** request that flows through `getSession`. **However**, the suspend route never deletes sessions, the route comment explicitly says sessions are not invalidated, and any code path or cached server component that does not re-run `getSession` per action (or any long-lived non-cookie auth, e.g. an in-flight streaming response) is not immediately cut. Delete *does* clear sessions (`route.ts:31`) but suspend does not.
- **Why it matters:** "Suspend" implies immediate lockout; an admin reacting to an active abuse incident expects the user's current sessions killed now, not "eventually, on their next gated fetch." The asymmetry (delete clears sessions, suspend doesn't) is surprising.
- **Suggested fix:** In the suspend handler, also `DELETE FROM sessions WHERE user_id = ?` (matching the delete route), so suspension is immediate and total.

---

## MEDIUM

### A9-08 — Rate limiting covers only users/[id] PATCH/DELETE; all other mutations unthrottled
- **Severity:** MEDIUM
- **File:** present only in `src/app/api/admin/users/[id]/route.ts:17,42`; absent from `suspend`, `activate`, `reset-password`, `invites` POST, `invites/[code]` DELETE.
- **What's wrong:** Only PATCH/DELETE on the user resource call `checkRateLimit`. Suspend, activate, reset-password, invite-create and invite-revoke have no limiter. The limiter is also keyed purely by IP (`admin-users:${ip}`) and is **in-process only** (`src/lib/rate-limit.ts:1-3` — resets on restart, not shared across instances).
- **Why it matters:** An admin account that is compromised or a CSRF chain (see A9-01) can hammer reset-password (credential churn), mass-suspend, or bulk-generate invites with no throttle. Inconsistent coverage also signals the policy was applied ad hoc.
- **Suggested fix:** Apply a shared rate-limit (keyed by acting `userId`, not just IP) to all admin mutations, or wrap them in one middleware. Note the in-memory limiter's limitations for multi-instance deployments.

### A9-09 — User id never validated/bounded on any [id] route (IDOR surface, error shape)
- **Severity:** MEDIUM
- **File:** `src/app/api/admin/users/[id]/{route,suspend,activate,reset-password,monitoring}/route.ts` — all take `id` from the path and pass it straight to SQL.
- **What's wrong:** `id` is used verbatim in parameterized queries (so no SQLi), but it is never validated against the expected 8-char base62 user-id shape, never checked for existence on suspend/activate/reset-password before the UPDATE. An admin can target any id; that's by design for admin tooling, but suspend/activate/reset-password issue blind `UPDATE ... WHERE id = ?` that silently no-op on a nonexistent/garbage id and still log a success event + return `{ok:true}`. Only DELETE/PATCH/monitoring do a prior existence SELECT.
- **Why it matters:** Not an IDOR in the privilege sense (caller is already admin), but the silent-success-on-missing-id means the audit log records actions that never happened, and typo'd/garbage ids look successful. It also leaves reset-password willing to "reset" a non-user.
- **Suggested fix:** Add an existence check (and optionally an id-format check) to suspend/activate/reset-password mirroring DELETE/PATCH, returning 404 when the row is absent and only logging on an actual change (`result.changes > 0`).

### A9-10 — UI action buttons ignore `res.ok`: failures look like success
- **Severity:** MEDIUM
- **File:** `src/app/admin/users/[id]/page.tsx:63-74` (suspend/activate/promote/demote/force-pw-change) and `:80-89` (delete).
- **What's wrong:** `doAction` awaits the `fetch` but never checks `res.ok` for suspend/activate/promote/demote/force-pw-change — it unconditionally re-fetches `/monitoring` and clears the spinner. A 400 (self-demote/self-suspend guard, A9-02 floor if added), 403 (CSRF fix), 429 (rate limit), or 500 produces **no error message**; the UI just re-renders the unchanged state, which reads as a silent no-op. `deleteUser` checks `res.ok` before navigating but shows nothing on failure. reset-password checks `res.ok` but the failure branch is empty (no user feedback).
- **Why it matters:** Admins get no signal when a guarded/blocked action fails; they may believe a user was suspended/deleted when they weren't. Destructive-action correctness depends on the operator knowing the outcome.
- **Suggested fix:** Check `res.ok` in every branch; on failure read `{error}` and surface it (toast/inline). Distinguish per-button loading rather than one global `actionLoading`.

### A9-11 — Destructive delete uses `confirm()`; suspend/promote/demote have NO confirmation
- **Severity:** MEDIUM
- **File:** `src/app/admin/users/[id]/page.tsx:80-81` (delete uses `window.confirm`); suspend/promote/demote buttons (`:128-150`) fire immediately on click.
- **What's wrong:** Only Delete prompts for confirmation. **Promote to Admin** (a privilege-escalation grant), **Demote**, and **Suspend** execute on a single click with no confirm step. Promote-to-Admin in particular hands full admin rights with one mis-click.
- **Why it matters:** Granting admin or suspending a user are consequential, easily mis-clicked actions (the buttons sit in a tight flex row). Privilege grants especially warrant an "are you sure."
- **Suggested fix:** Gate Promote-to-Admin (and ideally Suspend/Demote) behind a confirm dialog. Replace `window.confirm`/`alert` with an in-app modal for consistent UX and to avoid being suppressed by "prevent this page from creating more dialogs."

### A9-12 — Audit log is not tamper-evident and is silently best-effort
- **Severity:** MEDIUM
- **File:** `src/lib/dal.ts:159-188` (`logEvent` swallows all errors); `src/lib/db/migrations.ts:54-64` (plain table, no hash chain); admin reads in `audit/route.ts`, `monitoring/route.ts`.
- **What's wrong:** `audit_log` is an ordinary table with an autoincrement id and no integrity chaining; nothing prevents an actor with DB access (or a future code path) from `UPDATE`/`DELETE` on it — it is not append-only at the storage layer. `logEvent` is wrapped in `try { ... } catch { /* never throws */ }`, so if an audit insert fails (disk full, lock), the action still succeeds with **no record and no alert**. The export/read paths trust the rows verbatim.
- **Why it matters:** For an admin audit trail the integrity guarantee matters: silently-missing entries and freely-mutable history undermine accountability and incident forensics.
- **Suggested fix:** Treat audit as security-relevant: at minimum add a tamper-evident hash chain (`prev_hash`) or write-once constraint/trigger, and surface (or separately alert on) audit-write failures rather than swallowing them entirely. Restrict who/what can mutate the table.

### A9-13 — Admin user-list query is `SELECT u.*` and leaks password_hash to the client
- **Severity:** MEDIUM
- **File:** `src/app/api/admin/users/route.ts:36-39` (`SELECT u.*, (...) as watch_count`).
- **What's wrong:** The list endpoint selects `u.*`, which includes `password_hash`, `invite_used`, etc., and returns the rows straight to the browser as JSON. (The per-user monitoring route correctly enumerates safe columns; the list route does not.) Any admin's browser/devtools — and anything that intercepts that response — now sees every listed user's bcrypt hash.
- **Why it matters:** Bcrypt hashes should never leave the server. Exposed hashes enable offline cracking and broaden blast radius if the admin session/response is captured. It's also a needless data-exposure that contradicts the careful column allowlisting elsewhere.
- **Suggested fix:** Replace `u.*` with an explicit column list excluding `password_hash` (and anything else sensitive), mirroring `users/[id]/monitoring/route.ts`.

### A9-14 — watch_count subquery makes the user list an N+1 (per-row correlated COUNT)
- **Severity:** MEDIUM (perf)
- **File:** `src/app/api/admin/users/route.ts:36-39`.
- **What's wrong:** `(SELECT COUNT(*) FROM watch_events WHERE user_id = u.id) as watch_count` is a correlated subquery evaluated once per returned user row. With a large `watch_events` table and no composite index tuned for the count, each row triggers a separate scan/seek. Page size is 25 so it's bounded per request, but it is the textbook N+1 read pattern and scales with watch history size.
- **Why it matters:** On a busy install this turns a cheap 25-row page into 25 COUNT scans of a potentially large table on every list load / filter / page change.
- **Suggested fix:** Replace with a single `LEFT JOIN (SELECT user_id, COUNT(*) c FROM watch_events GROUP BY user_id)` aggregate, or maintain a denormalized counter. `idx_watch_events_user_started` helps but a grouped join is still cheaper than 25 correlated subqueries.

---

## LOW

### A9-15 — Audit/activity export `?from`/`?to` accept unvalidated dates → silent empty/whole-table
- **Severity:** LOW
- **File:** `src/app/api/admin/audit/export/route.ts:44-53`.
- **What's wrong:** `new Date(fromParam).getTime()` returns `NaN` for a malformed date; `created_at >= NaN` / `<= NaN` is always false in SQLite comparison semantics here, so a typo'd range silently yields an **empty** CSV with no error. No validation/clamping.
- **Why it matters:** Admin believes they exported a range and got nothing, with no indication why.
- **Suggested fix:** Validate parsed dates; return 400 on `NaN`, and document the inclusive/exclusive boundaries.

### A9-16 — Pagination uses OFFSET; deep pages and total COUNT degrade on large tables
- **Severity:** LOW (perf)
- **File:** `src/app/api/admin/audit/route.ts:18-21`; `activity/route.ts:18-22`; `users/route.ts:35-39`.
- **What's wrong:** All three list endpoints use `LIMIT ? OFFSET ?` plus a full `SELECT COUNT(*)`. OFFSET pagination re-walks all skipped rows, so deep pages get linearly slower, and the unfiltered `COUNT(*)` is a full scan every request.
- **Why it matters:** Fine at current scale; on large audit/watch tables both the deep-page OFFSET and the per-request COUNT become noticeable.
- **Suggested fix:** Keyset/seek pagination (`WHERE created_at < ? ORDER BY created_at DESC LIMIT ?`) for the big append-only tables; cache or approximate the total.

### A9-17 — Activity/audit list pages have no upper page guard and refetch redundantly
- **Severity:** LOW
- **File:** `src/app/admin/activity/page.tsx`, `src/app/admin/audit/page.tsx` (list/pager clients) — and `users/[id]/page.tsx:73` refetches the entire monitoring payload after every single action.
- **What's wrong:** After any mutation the user-detail page re-pulls the full `/monitoring` payload (sessions+watches+audit+logins+stats, each capped but still a multi-query round-trip) just to reflect, e.g., a role flip. The list pages page via `?page=` with only a lower clamp server-side.
- **Why it matters:** Redundant data transfer on every admin action; minor but avoidable.
- **Suggested fix:** After a mutation, update local state from the action's own response (or refetch only the user header), not the entire monitoring bundle.

### A9-18 — `stats.totalUsers` excludes admins, which is undocumented in the UI contract
- **Severity:** LOW
- **File:** `src/app/api/admin/stats/route.ts:21` (`WHERE role = 'user'`).
- **What's wrong:** `totalUsers` counts only `role='user'`, silently omitting admins. A dashboard labeled "Total Users" will under-report. Defensible, but it's a correctness/clarity foot-gun if any widget treats it as the real account total.
- **Why it matters:** Misleading headline metric; off-by-the-number-of-admins.
- **Suggested fix:** Either rename to "Standard Users" in the UI or return both counts.

### A9-19 — Invite POST body unvalidated: negative/huge `maxUses`, past `expiresAt` accepted
- **Severity:** LOW
- **File:** `src/app/api/admin/invites/route.ts:31-36`.
- **What's wrong:** `maxUses` and `expiresAt` are taken from the JSON body and inserted with no validation. A negative `maxUses` (e.g. `-1`) stored as-is interacts oddly with the `use_count < max_uses` check (and `max_uses = 0` already means unlimited), and an `expiresAt` in the past creates a dead-on-arrival code. No `await req.json()` try/catch either (malformed body throws → unhandled 500).
- **Why it matters:** Minor data-integrity / confusing invite states; the missing try/catch is an unhandled-error nit. (Moot for limits until A9-03 makes `use_count` real.)
- **Suggested fix:** Validate `maxUses >= 0` (integer) and `expiresAt` in the future or null; wrap `req.json()` in try/catch returning 400.

---

## RBAC enforcement matrix (verified)

| Route | `requireAdmin` | Origin/CSRF | Rate-limit | Notes |
|---|---|---|---|---|
| `users/route.ts` GET | ✅ :13 | n/a (GET) | — | leaks `u.*` (A9-13), N+1 (A9-14) |
| `users/[id]/route.ts` DELETE | ✅ :14 | ❌ | ✅ :17 | blocks self+admin delete |
| `users/[id]/route.ts` PATCH | ✅ :39 | ❌ | ✅ :42 | blocks self-demote only (A9-02) |
| `users/[id]/suspend` POST | ✅ :11 | ❌ | ❌ | self-guard only; no session revoke (A9-07) |
| `users/[id]/activate` POST | ✅ :10 | ❌ | ❌ | — |
| `users/[id]/reset-password` POST | ✅ :23 | ❌ | ❌ | leaks temp pw (A9-06) |
| `users/[id]/monitoring` GET | ✅ :13 | n/a | — | safe column list ✓ |
| `invites/route.ts` GET/POST | ✅ :24,30 | ❌ | ❌ | use_count never inc (A9-03) |
| `invites/[code]` DELETE | ✅ :9 | ❌ | ❌ | — |
| `activity/route.ts` GET | ✅ :13 | n/a | — | OFFSET paging |
| `activity/export` GET | ✅ :18 | n/a | — | full buffer (A9-05) |
| `audit/route.ts` GET | ✅ :12 | n/a | — | OFFSET paging |
| `audit/export` GET | ✅ :32 | n/a | — | CSV injection (A9-04) + full buffer (A9-05) |
| `stats/route.ts` GET | ✅ :14 | n/a | — | excludes admins (A9-18) |

Every route enforces admin server-side. The gaps are CSRF, self-protection floors, and the
data-handling issues above — not missing auth.
