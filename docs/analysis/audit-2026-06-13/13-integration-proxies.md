# Audit 13 — Integration Proxies (Radarr / Sonarr / Bazarr / Jellyfin metadata / Seerr webhook)

Read-only audit of the server-side proxy layer that fronts the external *arr stack and Jellyfin
using server-held API keys. Scope: `src/app/api/{radarr,sonarr,bazarr}/[...path]`,
`src/app/api/seerr/webhook`, the Jellyfin metadata routes (`image/[itemId]`,
`series/[id]/next-episode`, `series/[id]/seasons`, `seasons/[seasonId]/episodes`), and the matching
`src/lib/{radarr,sonarr,bazarr,jellyfin}` client/api modules. Jellyfin stream/playback/subtitles/
sessions and SMTP/notifications were out of scope and skipped.

## Summary

The good news first: the three catch-all `[...path]` proxies (Radarr, Sonarr, Bazarr) **are**
auth-gated via `requireAuth()`, and host-level SSRF through the `[...path]` segments is **not**
reachable — the authority component of the upstream URL is fixed before the attacker-controlled
segments are appended, so `@evil.com`, `//evil.com`, and `../` all resolve back to the configured
internal host. API keys are injected from server env and are never read from the client. No key is
echoed in success bodies. The Seerr webhook does proper HMAC-SHA256 verification with a constant-time
compare when a secret is set.

The bad news: **four Jellyfin metadata routes ship with no `requireAuth()` at all** while their own
sibling route (`continue-watching`) has it — an open, key-injecting relay into Jellyfin reachable by
anyone who can reach the app (the `proxy.ts` middleware is explicitly a UX redirect only, not a gate,
and only fires on a *missing* cookie). One of those routes also interpolates a path param straight
into a Jellyfin query string. Secondary issues: the `[...path]` proxies authorize any logged-in user
(open registration is on by default) for full read/write control of Radarr/Sonarr/Bazarr including
delete; every upstream fetch has **no timeout** so one hung backend hangs the route indefinitely;
upstream error bodies (which can contain the internal URL) are forwarded to the client verbatim; and
`../` path-confusion lets an authed user escape the `/api/v3` base to other endpoints on the same
internal host.

### Counts by severity

| Severity | Count |
|---|---|
| CRITICAL | 1 |
| HIGH     | 2 |
| MEDIUM   | 5 |
| LOW      | 4 |
| **Total** | **12** |

---

## CRITICAL

### A13-01 — Jellyfin metadata routes are unauthenticated key-injecting proxies (open relay)
- **Severity:** CRITICAL
- **File:**
  - `src/app/api/jellyfin/image/[itemId]/route.ts:9` (no auth; whole handler)
  - `src/app/api/jellyfin/series/[id]/next-episode/route.ts:17`
  - `src/app/api/jellyfin/series/[id]/seasons/route.ts:8`
  - `src/app/api/jellyfin/seasons/[seasonId]/episodes/route.ts:9`
- **What's wrong:** None of these four route handlers call `requireAuth()` (or any auth). They
  inject the server-held `JELLYFIN_API_KEY` (`image` route lines 36–40; the other three via
  `jellyfinFetch`/`getSeasons`/`getEpisodes` which embed the MediaBrowser `Token=` header in
  `client.ts:13-15`) and return Jellyfin data to whoever calls them. The app's only gate in front of
  unauthenticated requests is `src/proxy.ts`, which by its own header comment (lines 1–14) is a
  "UX-layer redirect guard only … NOT a security boundary" and merely 302s requests that arrive
  **without** the `unified-session` cookie (`proxy.ts:53,62`). It performs no DB session validation
  and does not block the route from executing if a cookie (any value) is present. The DAL pattern
  used everywhere else (`requireAuth()` in the handler) is simply missing here. The contrast is
  proven by the sibling route `src/app/api/jellyfin/continue-watching/route.ts:40`, which *does*
  call `requireAuth()` — so this is an omission, not an intentional public design.
- **Why it matters:** Anyone who can reach `unified.minijoe.dev` (it is internet-exposed behind
  Caddy/BunkerWeb) can enumerate the Jellyfin library — series, season lists, episode lists with
  overviews, item images — and pivot the server's admin Jellyfin token as an SSRF/enumeration
  oracle, with zero credentials. `seasons/[seasonId]/episodes` returns full episode metadata for any
  guessable/known item ID. The image route will proxy `Images/<type>` for any `itemId`. This is the
  textbook "unauthenticated proxy reaching internal services with admin keys" the audit flags as
  CRITICAL.
- **Suggested fix:** Add `await requireAuth()` as the first line of each handler (matching
  `continue-watching/route.ts`). If image URLs must be embeddable in `<img src>` without a session
  (they should not need to be — the browser sends the cookie automatically on same-origin requests),
  gate them behind a short-lived signed token rather than leaving them open.

---

## HIGH

### A13-02 — *arr proxies authorize any logged-in user for full read/write incl. delete
- **Severity:** HIGH
- **File:** `src/app/api/radarr/[...path]/route.ts:13`, `sonarr/[...path]/route.ts:13`,
  `bazarr/[...path]/route.ts:14` (each calls `requireAuth()`, not `requireAdmin()`)
- **What's wrong:** The catch-all proxies gate on `requireAuth()` (any active session) and then
  forward **all** methods — `GET/POST/PUT/DELETE` are all exported and routed through the same
  `proxy()` (`radarr/route.ts:41-44`, etc.). There is no per-method or admin restriction. Open
  enrollment is the default (`CLAUDE.md` §2: "Open enrollment, email verification optional … default
  false"), so any self-registered, non-admin user gets the server's Radarr/Sonarr/Bazarr admin API
  key applied to arbitrary requests: `DELETE /api/v3/movie/{id}?deleteFiles=true`,
  `POST /api/v3/command` (trigger mass searches), `DELETE /api/v3/queue/{id}`, change quality
  profiles, etc. The lib layer (`lib/radarr/api.ts:33` `deleteMovie`, `:47` `commandSearch`;
  `lib/sonarr/api.ts:34,53`) confirms these destructive operations are first-class.
- **Why it matters:** Privilege escalation from "any user" to "full *arr administrator." A normal
  account can delete the entire movie/series library (with files), saturate indexers with search
  spam, or reconfigure the download stack. These are admin-tier capabilities exposed to the lowest
  privilege level.
- **Suggested fix:** Gate the *arr proxies on `requireAdmin()`, or split read (`GET`, any user) from
  write (`POST/PUT/DELETE`, admin only). If end users legitimately need some writes, allowlist the
  specific safe endpoints rather than proxying the entire API surface.

### A13-03 — No request timeout on any upstream fetch — a hung backend hangs the route
- **Severity:** HIGH
- **File:** `radarr/[...path]/route.ts:27`, `sonarr/[...path]/route.ts:29`,
  `bazarr/[...path]/route.ts:28`, `jellyfin/image/[itemId]/route.ts:43`,
  `lib/jellyfin/client.ts:54`, `lib/radarr/client.ts:22`, `lib/sonarr/client.ts:22`,
  `lib/bazarr/client.ts:22`
- **What's wrong:** Every `fetch()` to an upstream service is issued with no `AbortSignal` /
  `signal: AbortSignal.timeout(...)` and no connection deadline. If Radarr/Sonarr/Bazarr/Jellyfin is
  up but slow, hung, or the TCP connect blackholes (the hosts are fixed internal IPs that may be
  down), the proxy `await`s indefinitely. The browser-facing route never returns; the Next.js server
  worker is tied up for the duration.
- **Why it matters:** A single unresponsive backend can exhaust server request concurrency
  (resource-exhaustion / self-DoS), and the user gets an indefinite spinner rather than a clean 504.
  The audit explicitly calls out "timeouts so a down service does not hang the route."
- **Suggested fix:** Pass `signal: AbortSignal.timeout(10_000)` (tune per route) to every upstream
  `fetch`, and map the resulting `AbortError`/`TimeoutError` to a `504` with a generic message.

---

## MEDIUM

### A13-04 — Upstream error bodies forwarded verbatim to the client (internal-detail leak)
- **Severity:** MEDIUM
- **File:** `radarr/[...path]/route.ts:34-35`, `sonarr/[...path]/route.ts:36-37`,
  `bazarr/[...path]/route.ts:35-36`; lib mirror: `lib/radarr/client.ts:28-31`,
  `lib/sonarr/client.ts:28-31`, `lib/bazarr/client.ts:28-31`, `lib/jellyfin/client.ts:56-60`
- **What's wrong:** On a non-2xx upstream response the proxy reads the upstream body and returns it
  to the browser as-is with the upstream status (`const data = … res.text(); return
  NextResponse.json(data, { status: res.status })`). *arr/Jellyfin error payloads frequently embed
  the internal base URL, stack traces, file paths, SQL, or config details. The lib clients also
  embed the body into the thrown `Error` message (e.g. `Radarr … → ${status}: ${body}`), which can
  surface in other responses/logs.
- **Why it matters:** Information disclosure — leaks internal hostnames/ports (`192.168.0.50:7878`,
  etc.), filesystem layout, and software versions to any client, aiding lateral movement. Does not
  leak the API key itself (keys are header-only), but exposes everything around it.
- **Suggested fix:** On upstream error, return a sanitized generic body (`{ error: 'Upstream
  service error' }`) with the mapped status; log the full upstream body server-side only.

### A13-05 — `next-episode` interpolates the `id` path param into a Jellyfin query string (query injection) + unauthenticated
- **Severity:** MEDIUM
- **File:** `src/app/api/jellyfin/series/[id]/next-episode/route.ts:24-26`
- **What's wrong:** `id` (a raw path segment) is concatenated directly into the Jellyfin query
  string: `` `/Shows/NextUp?SeriesId=${id}&UserId=${userId}&Limit=1&Fields=UserData` ``. It is not
  passed through `URLSearchParams`, so a value such as `abc&IsPlayed=true&EnableTotalRecordCount=
  false` (or a `#` to truncate trailing params) is injected verbatim into the upstream query and
  alters Jellyfin's query semantics. Combined with A13-01 (this route has no auth), the injection is
  reachable pre-authentication. (Verified: `new URL()` preserves the injected `&`/`#` in the query
  component; the host stays fixed.)
- **Why it matters:** An attacker can manipulate the upstream Jellyfin request beyond the intended
  parameter (parameter pollution), e.g. flip filters or disable counts, on an endpoint that is
  already unauthenticated. Impact is bounded (no host change, GET-only NextUp), hence MEDIUM, but it
  is a genuine injection.
- **Suggested fix:** Build the query with `URLSearchParams` (`qs.set('SeriesId', id)`), which
  percent-encodes `&`/`#`. Add `requireAuth()` per A13-01.

### A13-06 — `../` path-confusion lets an authed user escape the `/api/v3` base on the same host
- **Severity:** MEDIUM
- **File:** `radarr/[...path]/route.ts:15,27`, `sonarr/[...path]/route.ts:15,29`,
  `bazarr/[...path]/route.ts:16,28`
- **What's wrong:** `endpoint = '/api/v3/' + path.join('/')` then `fetch(`${RADARR_URL}${endpoint}
  ${search}`)`. When `path` contains decoded `..` segments, the WHATWG URL parser inside `fetch`
  normalizes them: `http://192.168.0.50:7878/api/v3/../../../admin` resolves to
  `http://192.168.0.50:7878/admin` (verified). The host is unchanged (no SSRF), but the request is
  no longer confined to the `/api/v3` REST surface — it can hit other paths on the same Radarr/
  Sonarr/Bazarr instance (e.g. the web UI, `/feed`, login pages) carrying the API key header.
- **Why it matters:** Weakens the "this proxy only exposes the v3 REST API" assumption; an authed
  user can reach non-API endpoints of the internal service. Lower impact than host SSRF (host is
  pinned) and already requires a session, hence MEDIUM.
- **Suggested fix:** Reject or sanitize `..` segments (`if (path.some(s => s === '..' || s.includes('..'))) return 400`), or normalize and assert the final pathname still starts with `/api/v3/`.

### A13-07 — Seerr webhook can be triggered by anyone when `SEERR_WEBHOOK_SECRET` is unset
- **Severity:** MEDIUM
- **File:** `src/app/api/seerr/webhook/route.ts:82-91`
- **What's wrong:** Signature verification is conditional: `if (secret) { …verify… } else { …WARNING
  log, skip… }`. When `SEERR_WEBHOOK_SECRET` is not set, the route accepts **any** POST and acts on
  it — creating monitored items, resolving titles from TMDB, and firing an immediate `grabItem()`
  (`route.ts:137-149`) for `MEDIA_APPROVED`/`REQUEST_APPROVED`, and running an UPDATE against
  `media_requests` for `MEDIA_AVAILABLE` (`route.ts:166-175`). The secret is documented as
  "optional but recommended." This route is also not in `proxy.ts` `PUBLIC_PATHS`, but `proxy.ts`
  only redirects cookieless *navigations*; a server-to-server POST with no cookie gets a 302 to
  `/login` (HTML) rather than being blocked — and crucially the audit's concern is that with the
  secret unset there is no source validation at all.
- **Why it matters:** Without the secret, an attacker who can reach the endpoint can forge approval/
  availability events: queue arbitrary `tmdbId` grabs (pulling content into the library via the
  automation pipeline) and flip request statuses to `available`. Spoofed events drive real side
  effects.
- **Suggested fix:** Make the secret mandatory — if `SEERR_WEBHOOK_SECRET` is unset, reject with
  `503`/`401` instead of processing. At minimum, fail closed in production
  (`NODE_ENV === 'production'`).

### A13-08 — `verifySignature` not fully constant-time; raw signature fed to `Buffer.from` without hex validation
- **Severity:** MEDIUM
- **File:** `src/app/api/seerr/webhook/route.ts:57-65`
- **What's wrong:** `Buffer.from(signature)` is called with the default `utf8` encoding on the raw
  header value, then compared to `Buffer.from(expected)` (the hex digest, also utf8) via
  `timingSafeEqual`. Two issues: (1) the early `return false` on a length mismatch (the `catch`
  branch when `timingSafeEqual` throws on unequal lengths) is itself a timing side-channel — a wrong
  length short-circuits before the constant-time compare, so an attacker learns when the length is
  right. (2) The signature is never validated as hex, so a non-hex header is compared byte-for-byte
  against the hex string rather than decoded; the comparison still works for the correct value but
  the design is brittle. The HMAC is correct (raw body before JSON parse — good), so this is
  hardening, not a break.
- **Why it matters:** A length-based timing oracle marginally aids forgery attempts against the MAC;
  best practice is a single constant-time path regardless of input length. Impact is low given a
  256-bit secret, hence MEDIUM-leaning-LOW.
- **Suggested fix:** Decode both sides from hex to fixed-length buffers (`Buffer.from(sig, 'hex')`)
  and compare those; or compare the *hex strings* only after asserting equal length up front in a
  way that does not branch on content. Reject obviously malformed (non-hex / wrong-length) signatures
  uniformly.

---

## LOW

### A13-09 — Image proxy: `Cache-Control: immutable` on a mutable, ID-addressed resource
- **Severity:** LOW
- **File:** `src/app/api/jellyfin/image/[itemId]/route.ts:58` (and `next: { revalidate: 3600 }` at
  `:48`)
- **What's wrong:** Responses are returned with `Cache-Control: public, max-age=3600, immutable`.
  The URL is keyed by `itemId` + `type` + `width`, none of which change when the underlying artwork
  is replaced in Jellyfin. `immutable` tells browsers never to revalidate within the TTL, so swapped
  posters can be stale for up to an hour and the `public` directive permits shared/CDN caches to
  store Jellyfin artwork. Minor correctness/freshness issue; also note artwork is cached publicly
  even though the route should be auth-gated (A13-01).
- **Why it matters:** Stale images after a metadata refresh; `public` caching of library artwork in
  shared caches is mildly undesirable for a gated app.
- **Suggested fix:** Drop `immutable` (keep `max-age`), or include the Jellyfin image tag/hash in
  the cache key so a changed image gets a new URL. Consider `private` once the route is auth-gated.

### A13-10 — Proxies buffer entire upstream response into memory (no streaming) for *arr
- **Severity:** LOW
- **File:** `radarr/[...path]/route.ts:34-35`, `sonarr/[...path]/route.ts:36-37`,
  `bazarr/[...path]/route.ts:35-36`
- **What's wrong:** The proxy fully reads the upstream body (`res.json()` / `res.text()`) and
  re-serializes it via `NextResponse.json(...)`. For large *arr payloads (e.g. full `/movie` or
  `/series` lists, queue dumps) this double-buffers (parse + re-stringify) in server memory rather
  than streaming `res.body` through. The image route does stream (`new Response(res.body, …)`), so
  the pattern is known — just not applied to the *arr proxies.
- **Why it matters:** Higher memory/CPU per request and added latency on large list endpoints; not a
  correctness bug.
- **Suggested fix:** For pass-through proxies, stream `res.body` with the upstream `Content-Type`
  and status instead of parse-then-restringify (as the image route already does), unless a transform
  is needed.

### A13-11 — No connection reuse / keep-alive agent; default fetch behavior per request
- **Severity:** LOW
- **File:** all upstream `fetch` callers — `lib/{radarr,sonarr,bazarr,jellyfin}/client.ts`, the four
  `[...path]` proxies, `jellyfin/image` route
- **What's wrong:** Every call uses the global `fetch` with no shared keep-alive agent/dispatcher.
  Under Node's undici defaults connections are pooled per-origin, but there is no explicit tuning
  (pool size, keep-alive timeout) for these chatty internal hosts, and `cache: 'no-store'` on every
  *arr GET (`lib/radarr/client.ts:25`, etc.) means no response reuse either. [unverified] exact
  pooling behavior depends on the undici version bundled with Next 16.
- **Why it matters:** Minor throughput/latency overhead on bursty dashboards that fan out many *arr
  calls; not a correctness issue.
- **Suggested fix:** Optionally configure a shared `undici.Agent`/dispatcher with keep-alive for the
  internal hosts if profiling shows connection churn.

### A13-12 — Redundant `arrayBuffer()` body read guard relies on method check only; content-type echoed unvalidated
- **Severity:** LOW
- **File:** `radarr/[...path]/route.ts:18-25`, `sonarr/[...path]/route.ts:18-27`,
  `bazarr/[...path]/route.ts:19-26`
- **What's wrong:** The proxy copies the client's `Content-Type` header straight onto the upstream
  request (`if (contentType) headers['Content-Type'] = contentType`) and forwards the raw
  `arrayBuffer()` body for any non-GET/HEAD method. There is no allowlist of forwarded headers, so
  only `Content-Type` is forwarded (good — `Authorization`/cookies are NOT forwarded, so no client
  header smuggling of auth), but a client-chosen `Content-Type` (e.g. a mismatched type) is trusted
  verbatim. Low risk because the API key is the only thing the upstream authorizes on, but worth
  noting the body/headers are forwarded with no validation.
- **Why it matters:** Defense-in-depth only; could let a client send an unexpected content-type to
  the upstream. No demonstrated exploit given auth-gating and header non-forwarding.
- **Suggested fix:** Optionally validate/allowlist `Content-Type` to expected values
  (`application/json`, form types) before forwarding.

---

## Notes / things that are correct (no finding)

- **No host-level SSRF via `[...path]`.** Verified that `@evil.com`, `//evil.com`, and absolute-URL-
  looking segments are appended *after* the fixed `http://<host>/api/v3/` prefix, so the URL
  authority cannot be overridden through path segments. Path-traversal via `..` stays on-host
  (A13-06 covers the base-path escape).
- **API keys are server-only and never returned.** Keys come from `process.env` in each `client.ts`
  / route and are injected as request headers (or, for image/stream, query params on the
  server→Jellyfin leg only). No success-path response includes a key. (Error bodies — A13-04 — leak
  internal URLs but not the keys.)
- **Seerr webhook HMAC is computed over the raw body before JSON parse** (`route.ts:75,96`), which is
  the correct order; the grab side-effect is fired without blocking the response
  (`route.ts:145-149`); and the `MEDIA_AVAILABLE` UPDATE is parameterized (`route.ts:167-175`) — no
  SQL injection.
- **Jellyfin path-segment params** (`seasonId`, series `id` in the seasons route) are passed through
  `new URL()` / `URLSearchParams` and stay percent-encoded, so `..%2f` does not traverse (the query-
  string interpolation in `next-episode` is the exception — A13-05).
