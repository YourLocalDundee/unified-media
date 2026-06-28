# Audit 01 — Auth, Onboarding & Session Security

Scope: `src/app/login|register|forgot|reset-password|change-password|invite`, all of `src/app/api/auth/**` (incl. `profile/**`), and cross-cutting `src/context/AuthContext.tsx`, `src/lib/{csrf,password,safe-redirect,rate-limit,geo,dal}.ts`, plus `src/proxy.ts`, `src/lib/db/{index,migrations,seed}.ts`. Email *sending* skipped per instructions; token generation/storage audited.

## Summary

The session core (DAL) is well built: 32-char CSPRNG IDs, `httpOnly`/`sameSite=lax`, rolling + rotation + absolute TTL, JOIN-on-`is_active`, cookie-mutation guards for the Next.js Server-Component throw, and the IDOR-safe session routes are genuinely correct. Reset/verify tokens are random, hashed-at-rest (reset), single-use, and expiring. However there is one CRITICAL design hole: `force_pw_change` is enforced **only** in the login route's response, while `createSession()` runs and the real cookie is set **before** that check — so a forced-reset user who ignores the client redirect already holds a fully valid session and bypasses the password change entirely. The party WS path checks `force_pw_change`; the main DAL does not, confirming the omission. CSRF relies solely on `verifyOrigin`, and (a) its `origin.startsWith(o)` match is bypassable (`https://unified.minijoe.dev.evil.com`), and (b) five profile mutation routes (`display-name`, `email`, `demographics`, `sessions/[id]`, `sessions/revoke-others`) skip `verifyOrigin` entirely, leaning on `SameSite=lax` alone. Login leaks user existence two ways (a distinct 403 for suspended accounts, and a timing difference because unknown usernames skip bcrypt). All rate limits key on a client-spoofable `X-Forwarded-For` and live in per-process memory (reset on deploy, not shared). The `secure` cookie flag is gated on `NODE_ENV==='production'`, fine in Docker.

### Counts by severity

| Severity | Count |
|---|---|
| CRITICAL | 1 |
| HIGH | 4 |
| MEDIUM | 7 |
| LOW | 6 |
| **Total** | **18** |

---

## CRITICAL

### A1-001 — `force_pw_change` is not enforced at the session gate; cookie is issued before the check
**Severity:** CRITICAL
**Files:** `src/app/api/auth/login/route.ts:94-116`, `src/lib/dal.ts:58-122` (`getSession`/`requireAuth`), cf. `src/lib/party/session.ts:56`

**What's wrong:** In the login handler the session is created and the cookie is set unconditionally:
```
97   const sessionId = await createSession(user.id, ip, ...)
...
102  cookieStore.set(SESSION_COOKIE, sessionId, { httpOnly:true, ... })
...
110  if (user.force_pw_change) {
113    return NextResponse.json({ requiresPasswordChange: true })   // cookie ALREADY set above
114  }
```
The only thing that "forces" the password change is the client choosing to honor `requiresPasswordChange` by navigating to `/change-password` (`login/page.tsx:69`). `getSession()` in `dal.ts` never reads `force_pw_change`, so the issued cookie authenticates every protected route and API. An attacker (or any user) given an admin-reset temp password can: log in, ignore the JSON flag, and use the valid `unified-session` cookie to access the whole app — including `/api/auth/profile/*`, browse, downloads, etc. — without ever changing the password. The party WS auth query explicitly excludes `force_pw_change` accounts (`party/session.ts:56`), which proves this gate was intended and is missing from the main DAL.

**Why it matters:** Defeats the entire forced-password-reset control. Admin-seeded temp passwords (printed to stderr) and admin "Reset Password" actions (`api/admin/users/[id]/reset-password`) are all bypassable. The temp credential remains a working login for the full 30-day session TTL.

**Suggested fix:** Either (a) do **not** set the cookie / create the session when `force_pw_change` is set — instead issue a short-lived, single-purpose "must change password" token that only `/api/auth/change-password` accepts; or (b) add `force_pw_change` to the `getSession` JOIN and have `requireAuth` redirect to `/change-password` (and route handlers 403) whenever it is set, exactly as `party/session.ts` already does. Option (b) is the smaller change and mirrors existing code.

---

## HIGH

### A1-002 — `verifyOrigin` allow-list uses `startsWith`, bypassable with a suffix domain
**Severity:** HIGH
**File:** `src/lib/csrf.ts:12`

**What's wrong:** `return ALLOWED_ORIGINS.some(o => origin === o || origin.startsWith(o))`. With `NEXT_PUBLIC_APP_URL=https://unified.minijoe.dev`, an attacker-controlled origin `https://unified.minijoe.dev.evil.com` passes `origin.startsWith('https://unified.minijoe.dev')`. So a malicious page on that host satisfies the only CSRF check the app has. The `startsWith` branch appears intended to allow ports, but it admits arbitrary suffixes.

**Why it matters:** `verifyOrigin` is the sole CSRF defense on login, logout, register, reset, change-password, etc. A bypass re-opens CSRF on all of them (e.g. forced login / logout, password change with a known current password, account creation).

**Suggested fix:** Drop the `startsWith` branch and compare exact origins (`origin === o`). If port flexibility is needed, parse the URL and compare `{protocol, hostname, port}` components, never raw prefix.

### A1-003 — Five profile mutation routes skip `verifyOrigin` (CSRF on email/display-name/demographics/session revoke)
**Severity:** HIGH
**Files:** `src/app/api/auth/profile/email/route.ts:17`, `profile/display-name/route.ts:14`, `profile/demographics/route.ts:17`, `profile/sessions/[id]/route.ts:16`, `profile/sessions/revoke-others/route.ts:17`

**What's wrong:** `grep` confirms `verifyOrigin` is called in login/logout/register/verify-email/resend/forgot/reset/profile-change-password — but **not** in these five state-changing routes. They rely entirely on `SameSite=lax`. `SameSite=lax` does send the cookie on top-level cross-site `POST`? No — but it does on cross-site **navigations**, and lax is a known-incomplete CSRF defense (it does not cover all method/embedding cases, and method-override or future same-site subdomain takeovers defeat it). Notably `PATCH /profile/email` changes the account's email with no re-auth and no Origin check — a CSRF here lets an attacker repoint the victim's email (and combined with a future reset flow, take over the account).

**Why it matters:** Inconsistent CSRF coverage; the highest-value mutation (email change, which is account-recovery-relevant) is one of the unprotected ones. Account takeover potential.

**Suggested fix:** Add `if (!verifyOrigin(req)) return 403` to all five (after fixing A1-002). Consider requiring current-password re-auth for email change specifically.

### A1-004 — Login leaks account existence: distinct 403 for suspended users + timing oracle for unknown usernames
**Severity:** HIGH
**File:** `src/app/api/auth/login/route.ts:64-92`

**What's wrong:** Two enumeration vectors despite the docstring's "never reveals whether username exists":
1. **Status-code leak:** unknown user → `401 "Invalid username or password"` (line 66); existing-but-suspended user → `403 "Account suspended"` (line 70). An attacker submitting any password learns which usernames exist (they get 403, not 401) for every suspended account, and 403-vs-401 distinguishes "real account" from "no account" whenever the account is inactive.
2. **Timing leak:** for a non-existent user the handler returns at line 66 **without** calling `verifyPassword` (bcrypt cost 12, ~100-300ms). For an existing user bcrypt always runs. The response-time delta is a reliable username oracle. The 2s artificial delay only applies *after* `recentFailures >= 2` and only on the valid-user path, so it does not mask the first-probe timing difference.

**Why it matters:** Enables targeted credential stuffing / phishing against confirmed accounts; undermines the stated anti-enumeration goal.

**Suggested fix:** Return an identical `401` body for unknown user, wrong password, **and** suspended account (handle the suspended case after a successful password verify if you want a distinct message only to legitimate owners). Always run a bcrypt comparison against a dummy hash when the user is not found so timing is constant (compare against a fixed bcrypt hash). Move the suspended check to after password verification.

### A1-005 — All auth rate limits key on spoofable `X-Forwarded-For` (leftmost value) and are per-process in-memory
**Severity:** HIGH
**Files:** `src/app/api/auth/login/route.ts:34-38`, `forgot-password/route.ts:24-26`, `register/route.ts:57-59`, `verify-email/route.ts:37-39`, `resend-verification/route.ts:24-26`, `check-username/route.ts:20-22`, reset-password:21-23; `src/lib/rate-limit.ts:1-3`

**What's wrong:** `getClientIp` takes `req.headers.get('x-forwarded-for')?.split(',')[0]` — the **leftmost**, i.e. the value the *client* injected if it sets the header. The comment claims the outermost trusted proxy adds it, but nothing strips a client-supplied `X-Forwarded-For`; if any request reaches the app with a forged header (and the BunkerWeb→Caddy chain appends rather than replaces), an attacker rotates `X-Forwarded-For: <random>` per request to get a fresh bucket every time, nullifying every login/register/forgot/verify limit. Separately, the store is a plain in-process `Map` (`rate-limit.ts`) — it resets on every deploy/restart and is not shared, and the WAF doc states `EMAIL_VERIFICATION` and other WAF features are disabled for this domain, so app-layer limiting is the real control.

**Why it matters:** Brute-force, credential-stuffing, reset-token spraying, and registration/email-bomb limits are all evadable; the brute-force protection the CHANGELOG advertises ("10/15min/IP") is not robust.

**Suggested fix:** Derive the client IP from the *rightmost* untrusted hop given a known trusted-proxy count, or from a proxy-set trusted header (e.g. `CF-Connecting-IP`-style) that the edge guarantees to overwrite. Document the trusted hop count. For correctness across instances/restarts, back the limiter with the existing SQLite DB (you already record `login_attempts`) or Redis. At minimum, also rate-limit reset/verify by account, not just IP.

---

## MEDIUM

### A1-006 — Session rotation update is not atomic with the cookie set; concurrent requests can desync the cookie from the row
**Severity:** MEDIUM
**File:** `src/lib/dal.ts:97-118`

**What's wrong:** On the 24h rotation path, `cookieStore.set(newId)` then `UPDATE sessions SET id=newId WHERE id=oldId`. If two requests for the same session race past the `now - created_at > ROTATION_INTERVAL_MS` check (e.g. RSC prefetch + navigation fired together), both generate different `newId`s; the first UPDATE renames the row, the second UPDATE matches zero rows (old id gone) but its `Set-Cookie` may still win in the browser, leaving a cookie whose id no longer exists → user silently logged out on next request. There is no transaction or `WHERE id=? AND id NOT already rotated` guard.

**Why it matters:** Intermittent forced logouts for active users, hard to reproduce; classic rotation race. Next.js prefetch makes parallel same-session requests common.

**Suggested fix:** Make the rotation atomic and idempotent: run the `UPDATE ... WHERE id = oldId` first inside a transaction, check `changes === 1`, and only set the cookie if the rename actually happened; otherwise treat as "already rotated" and reissue the existing valid id. Alternatively rotate only in a dedicated route, not in every `getSession`.

### A1-007 — `change-password` (force-reset route) has no rate limit and no `verifyOrigin`
**Severity:** MEDIUM
**File:** `src/app/api/auth/change-password/route.ts:21-49`

**What's wrong:** Unlike `profile/change-password` (which has both `verifyOrigin` and a 5/15min limiter), the force-reset variant has neither. It verifies `currentPassword` via bcrypt with no attempt throttle, so the admin-issued temporary password can be brute-forced through this endpoint (the user already holds a session from A1-001, so it's reachable). No Origin check also means CSRF if A1-002's broader bypass is used.

**Why it matters:** Unthrottled online guessing of the temp password; weakest link given temp passwords may be short-lived but are bcrypt-checked one guess at a time with no backoff.

**Suggested fix:** Add `verifyOrigin` and a per-user rate limit mirroring `profile/change-password`.

### A1-008 — Registration auto-login bypasses any email verification intent and is unauthenticated account creation
**Severity:** MEDIUM
**File:** `src/app/api/auth/register/route.ts:144-175`

**What's wrong:** When `EMAIL_VERIFICATION_REQUIRED !== 'true'` (the default), `POST /register` creates the user **and** sets a session cookie immediately with no proof the email belongs to the registrant. Email is stored and treated as trusted (and is account-recovery-relevant via forgot-password). Combined with A1-005 (spoofable IP limit), this is effectively open, unthrottled account creation with attacker-chosen email addresses.

**Why it matters:** Spam/abuse accounts; an attacker can register with someone else's email, polluting the namespace and pre-empting that email's future legitimate signup (the email UNIQUE constraint then blocks the real owner).

**Suggested fix:** This may be an accepted LAN trade-off, but at minimum keep the email **unverified** (a flag) until confirmed, and do not let an unverified email be used as a password-reset target. Consider a global signup toggle in `app_settings` (the table exists).

### A1-009 — Verify-email and resend-verification do not bind the `pendingId` to the requester; any holder can drive another's verification
**Severity:** MEDIUM
**Files:** `src/app/api/auth/verify-email/route.ts:64-88`, `resend-verification/route.ts:44-59`

**What's wrong:** `pendingId` is a 32-char random token returned to the Step-1 client, but it is the *only* authZ on Step 2 — there is no session, IP, or email re-binding. `resend-verification` accepts any `pendingId` and triggers an email send (out of scope to audit the send, but it is an unauthenticated email-trigger primitive throttled only by the spoofable IP limit). `verify-email` lets anyone with the `pendingId` consume the 5 code attempts. Because the code is 6 digits (~1e6 space) and attempts are capped at 5 per pending row, guessing is impractical — but resend resets `attempts=0` and can be replayed, and the IP limit is evadable (A1-005), so the effective attempt budget is larger than intended.

**Why it matters:** Unauthenticated email-send trigger and verification-attempt amplification; minor account-takeover-of-pending-row risk.

**Suggested fix:** Tie `pendingId` actions to a cookie set at Step 1, or include the email in the verify payload and require it to match. Rate-limit resend per `pendingId`, not only per IP.

### A1-010 — `requireAuth()` calls `redirect('/login')` inside JSON API route handlers (e.g. `/api/auth/history`, all profile routes)
**Severity:** MEDIUM
**Files:** `src/lib/dal.ts:126-130`; consumers `src/app/api/auth/history/route.ts:19`, `profile/*` routes, `change-password/route.ts:22`

**What's wrong:** `requireAuth` uses `next/navigation`'s `redirect()`, which throws `NEXT_REDIRECT` and yields a `307` to `/login` for unauthenticated callers. In a fetch/XHR JSON client this surfaces as an opaque redirect-followed-to-HTML, not a `401 {error}`. The client code in these flows does `res.json()` and will throw on the HTML body. It is not a security hole (access is denied) but it is broken error handling and inconsistent with `/api/auth/me` which correctly returns `401`.

**Why it matters:** Unauthenticated or session-expired API calls produce confusing client failures ("unexpected error") instead of a clean 401 the UI can act on (e.g. redirect to login).

**Suggested fix:** For route handlers, use a non-redirecting guard that returns `NextResponse.json({error:'Unauthorized'},{status:401})` (as `/api/auth/me` already does manually). Reserve `requireAuth`'s `redirect` for Server Components only.

### A1-011 — `verify-email` re-uniqueness check is case-sensitive on email; pending row stores raw-cased username
**Severity:** MEDIUM
**Files:** `src/app/api/auth/verify-email/route.ts:96`, `register/route.ts:152,187`

**What's wrong:** Register lowercases email before insert (`email.toLowerCase()`), and `verify-email:96` checks `WHERE LOWER(email) = ?` against `pending.email` (already lowercase) — consistent. But `username` is inserted as the raw user-typed casing (`register` line 152/187 use `username` unmodified) while uniqueness is enforced via `LOWER(username)=LOWER(?)` lookups and a DB `username TEXT UNIQUE` (case-sensitive at the column level). So `Alice` and `alice` are *blocked* by the app's `LOWER()` checks but the stored value preserves the first registrant's casing — fine — yet the DB `UNIQUE` is case-sensitive, meaning if two pending rows for `Alice`/`alice` both pass Step 1 (the app `LOWER` check only blocks against committed `users`, not other `pending_registrations`), both can reach verify-email and the second insert is only stopped by the app `LOWER` check, not the DB constraint. The window is narrow but the DB is not the backstop the code assumes.

**Why it matters:** Edge-case duplicate-identity risk; the "race backstop" UNIQUE-violation handling in `register` (lines 157-159) won't fire for case-variant usernames because the column UNIQUE is case-sensitive.

**Suggested fix:** Add a `UNIQUE INDEX ON users(LOWER(username))` and `LOWER(email)` (SQLite supports expression indexes), or store usernames lowercased. Then the DB truly backstops the app checks.

### A1-012 — Password-reset row primary key is the first 16 hex chars of the raw token (token-derived, partially predictable id)
**Severity:** MEDIUM
**File:** `src/app/api/auth/forgot-password/route.ts:64-68`

**What's wrong:** `id = rawToken.slice(0,16)` while `token_hash = sha256(rawToken)`. The PK is 16 hex chars *of the secret token* stored in plaintext in the `id` column. A DB read (the very thing the hash-at-rest design defends against) now reveals the first 64 bits of the raw token directly. The remaining 64 bits still must be guessed, but storing half the secret in cleartext substantially weakens the "DB dump cannot reconstruct links" guarantee the docstring claims.

**Why it matters:** Partially defeats the reset-token-at-rest protection; reduces brute-force space for an attacker with DB read to 2^64 instead of 2^128.

**Suggested fix:** Use an independent random id (`makeId(16)` / `randomBytes`) for the PK, unrelated to the token. Never persist any portion of the raw token.

---

## LOW

### A1-013 — `getSafeRedirect` is duplicated (client) and divergent from `safe-redirect.ts` (server)
**Severity:** LOW
**Files:** `src/app/login/page.tsx:25-31` vs `src/lib/safe-redirect.ts:1-13`

**What's wrong:** The login page reimplements the guard inline. The client version blocks any `from.includes(':')`, while the server version only blocks a colon appearing before the first slash. Functionally both reject the dangerous cases, but maintaining two copies invites drift; the inlined version also rejects legitimate paths containing an encoded colon late in the string. Both correctly handle `//`, `/login`, `/register`. Not exploitable today.

**Why it matters:** Drift risk on a security-relevant function.

**Suggested fix:** Extract a tiny client-safe `safe-redirect` (no `server-only`) and import it in both places.

### A1-014 — Logout has no CSRF token and `AuthContext.logout` swallows failures (login CSRF via forced logout class)
**Severity:** LOW
**Files:** `src/app/api/auth/logout/route.ts:18-27`, `src/context/AuthContext.tsx:70-77`

**What's wrong:** Logout is `verifyOrigin`-guarded (good), but `AuthContext.logout` does `await fetch('/api/auth/logout',{method:'POST'})` with no `.ok` check and unconditionally clears state + redirects, so a 403 (origin reject) still "logs out" the UI while the server session persists. Minor; the server session simply lingers until TTL.

**Why it matters:** UI/server state divergence; lingering server session after a perceived logout.

**Suggested fix:** Check `res.ok`; surface a soft error or retry. The cookie is `httpOnly` so the client cannot clear it itself — rely on the server delete succeeding.

### A1-015 — `makeId` modulo-bias comment understates the bias; minor entropy reduction
**Severity:** LOW
**File:** `src/lib/dal.ts:39-46` (and the duplicate `makeId` in `register`/`verify-email`)

**What's wrong:** `chars[byte % 62]` over a 256-value byte is biased: values 0-7 map to two byte-values more often than 8-61 (256 = 4*62 + 8), so the first 8 chars of the alphabet are ~slightly over-represented. For a 32-char id this trims effective entropy marginally (still ~190 bits, far beyond brute-forceable), so practically irrelevant, but the "negligible" claim is imprecise and the pattern is copy-pasted in three files.

**Why it matters:** Defense-in-depth / correctness hygiene; not exploitable at 32 chars.

**Suggested fix:** Use rejection sampling or `byte & 63` over a 64-char alphabet, and centralize one `makeId`.

### A1-016 — Reset/verify code generation (`b % 10`) is biased and codes are not constant-time compared
**Severity:** LOW
**Files:** `src/app/api/auth/register/route.ts:39-43`, `resend-verification/route.ts:18-22`, `verify-email/route.ts:83`

**What's wrong:** `b % 10` over a byte biases digits 0-5 (256 = 25*10 + 6). And `code.trim() !== pending.code` is a non-constant-time string compare. With only 5 attempts and a 6-digit space the practical guessing risk is low, and the timing channel on a `!==` of equal-length numeric strings is tiny, but both deviate from best practice for a verification secret.

**Why it matters:** Minor; bias + non-timing-safe compare on a low-stakes short-lived code.

**Suggested fix:** Reject bytes >= 250 before `% 10`; compare with `crypto.timingSafeEqual` on equal-length buffers.

### A1-017 — Audit/geo lookup runs inline on the login failure path (external HTTP to ip-api.com on every failure)
**Severity:** LOW
**Files:** `src/lib/dal.ts:159-188` (`logEvent` → `getCountryFromIP`), called at `login/route.ts:65,90`

**What's wrong:** `logEvent('login_failure', …, {ip})` awaits `getCountryFromIP`, which does an outbound `fetch('http://ip-api.com/...')` (3s timeout) synchronously within the request for non-local IPs. On a brute-force burst each failed login makes (or queues) an external call; ip-api free tier is 45 req/min, so beyond that geo silently returns Unknown but the latency/connection cost remains, and it couples auth latency to a third party. Also `getCountryFromIP` runs for the spoofable client IP.

**Why it matters:** Auth-path latency and a (rate-limited) external dependency on the hot failure path; mild DoS amplification.

**Suggested fix:** Make `logEvent` truly fire-and-forget (don't `await` it on the request path), or resolve geo lazily in the admin UI rather than at write time.

### A1-018 — `pending_registrations` has no `UNIQUE(email)`/`UNIQUE(username)`; cleanup is opportunistic only
**Severity:** LOW
**Files:** `src/lib/db/migrations.ts:111-128`, `register/route.ts:180`

**What's wrong:** The table relies on a `DELETE ... WHERE LOWER(email)=? OR expires_at < ?` before each insert for de-dup and cleanup; there is no uniqueness constraint and no background reaper. Concurrent Step-1 submissions for the same email create multiple live pending rows (only one is later usable). Table can also accumulate expired rows if no one registers for a while (cleanup only runs on the next register call). Low impact (rows are tiny, codes expire), but the "race backstop" comments in `register` assume a UNIQUE that doesn't exist on this table.

**Why it matters:** Minor table bloat and duplicate pending rows; comments overstate the guarantees.

**Suggested fix:** Add `UNIQUE` on `LOWER(email)` for `pending_registrations`, or accept it and correct the comments; add a periodic cleanup in the existing scheduler.

---

## Notes / verified-good (not findings)

- **IDOR on `profile/sessions/[id]` and `revoke-others`:** correctly scoped by `user_id` in the WHERE clause (`sessions/[id]/route.ts:30,35`; `revoke-others:22`); current session cannot be self-revoked. No IDOR. 
- **Reset token:** random (`randomBytes(32)`), hashed at rest (sha256), single-use (`used` check at `reset-password:57`, set before write at :72), 1h expiry re-checked server-side, and deletes all user sessions on success (:76). Solid (aside from A1-012's PK).
- **Password hashing:** bcryptjs cost 12 (`password.ts:43`), server-side `validatePassword` enforced on register/reset/change (all paths), `bcrypt.compare` is constant-time. zxcvbn is client-only UX (score>=2 gate) and explicitly not relied on server-side — acceptable, though the server policy is rule-based, not entropy-based.
- **Cookie flags:** `httpOnly:true`, `sameSite:'lax'`, `path:'/'`, `secure` in production — consistent across login/register/verify. Good.
- **Cookie-mutation-in-Server-Component guards:** all three mutation sites in `dal.ts` (:79, :87, :100-117) wrapped in try/catch as the Next.js 16 gotcha requires. Verified.
- **`me` route:** correctly returns 401 JSON (not a redirect), `force-dynamic`, minimal fields. Good.
- **Open redirect:** server `getSafeRedirectUrl` and the client copy both reject `//`, absolute, and auth-loop targets. The invite flow passes `code` only (no redirect param). No open redirect found.
