# Audit 12 — Indexer Subsystem & Torznab Parsing (READ-ONLY)

Scope: native indexer aggregation (`src/lib/indexer/*`), per-adapter correctness (eztv, nyaa, yts),
Torznab XML parsing, indexer admin API (`/api/indexer/*`), Prowlarr proxy (`/api/prowlarr/[...path]`),
and the internal `/api/torznab/search` fan-out endpoint. Notifications/SMTP skipped per instructions.

## Summary

The aggregation core is genuinely solid in two ways the prompt asked about: `searchAllIndexers`
(`src/lib/indexer/index.ts:204`) uses `Promise.allSettled` with a concurrency-3 limiter and a
per-indexer 10 s `AbortController` timeout, so one slow/throwing indexer cannot kill the whole
search. Each adapter returns `[]` on any error rather than throwing. That failure isolation is correct.

The serious problems are elsewhere. **(CRITICAL) The GET indexer routes return `SELECT *` including
`api_key` in plaintext** to any admin client — confirmed in `getAllIndexers`/`getIndexerById` and the
admin edit modal pre-fills the real key into a non-password field. **(CRITICAL) `/api/torznab/search`
is fully unauthenticated** and fans out to every enabled public tracker, an open query-amplification
/ tracker-ban-risk relay reachable by anyone who can hit the app. **(HIGH) FlareSolverr is dead code**
— `flareSolve()` is never called from anywhere, so the `requires_flaresolverr` flag and the entire
Cloudflare-bypass story are non-functional; any indexer behind Cloudflare silently returns `[]`.
**(HIGH) The Prowlarr proxy is auth-gated only by `requireAuth` (any logged-in user), not admin**, and
double-encodes JSON. Plus several real per-adapter parsing correctness bugs (Torznab `cats` vs `cat`,
nyaa size regex too strict, `updateIndexerHealth` silently drops the response time it is handed,
Prowlarr discovery puts the API key in the stored URL and the DB).

No caching exists anywhere on the search path; every search re-hits every external API live.

## Counts

| Severity | Count |
|---|---|
| CRITICAL | 2 |
| HIGH | 4 |
| MEDIUM | 6 |
| LOW | 5 |
| **Total** | **17** |

---

## CRITICAL

### A12-01 — `api_key` returned in plaintext to the client on every indexer GET
**Severity:** CRITICAL
**File:** `src/lib/indexer/config.ts:7-23` (`getAllIndexers`, `getIndexerById`), surfaced by
`src/app/api/indexer/route.ts:7-11` (GET) and `src/app/api/indexer/[id]/route.ts:7-25` (GET),
consumed at `src/app/admin/indexers/page.tsx:223` and `:519-525`.

**What's wrong:** `getAllIndexers()` and `getIndexerById()` do `SELECT * FROM indexers`, which
includes the `api_key` column. `GET /api/indexer` returns the full rows verbatim
(`NextResponse.json(indexers)`), and the admin edit modal pre-loads the secret straight into a
plain `<input>` (`form.api_key = indexer.api_key`, rendered with `type="text"` at
`page.tsx:520`, not a password field). For Prowlarr-discovered indexers the `api_key` column holds
the **Prowlarr master API key** (see A12-08), so that master key is shipped to the browser too.

**Why it matters:** Indexer passkeys / private-tracker API keys are the credential that identifies the
account to the tracker. Returning them to the client (and rendering them in cleartext) means they
land in browser memory, the network tab, any HAR capture, and any client-side error reporting. A
passkey leak can get the underlying tracker account banned. The Prowlarr master key grants full
control of the Prowlarr instance.

**Suggested fix:** Strip `api_key` from all list/detail GET responses (return a boolean
`has_api_key` instead). Never echo the stored key back; in the edit modal show a masked placeholder
and only send `api_key` on PATCH when the field is non-empty (treat empty = "unchanged"). Add a
dedicated select column list rather than `SELECT *`.

### A12-02 — `/api/torznab/search` is unauthenticated and fans out to all indexers
**Severity:** CRITICAL
**File:** `src/app/api/torznab/search/route.ts:11-35`

**What's wrong:** The `GET` handler has **no `requireAuth()` / `requireAdmin()`** call. The header
comment claims "callers are server-side scheduled jobs, not browser clients," but it is a normal
Next.js route reachable at `/api/torznab/search?q=...`. It calls `searchAllIndexers(params)`
(`:32`), which queries every enabled public tracker (YTS, EZTV, Nyaa, plus any Torznab indexers).
There is no rate limit and no origin check.

**Why it matters:** Anyone who can reach the app (and `unified.minijoe.dev` is internet-exposed via
BunkerWeb/Caddy) can drive unlimited outbound queries to public trackers through the server's IP.
This is a query-amplification vector and a real tracker-ban risk: trackers throttle/ban source IPs
that hammer them, and here the source IP is the home server's. An attacker can also use it as a blind
SSRF-ish relay against the configured indexer hosts. The automation layer (`grabber.ts:241`) calls
`searchAllIndexers` **directly in-process**, so it does not need this HTTP route to be public — the
route appears to exist only for the UI's `torrent-search` flow, which already has its own authed
endpoint (`/api/torrent-search`, `requireAuth` at `route.ts:32`).

**Suggested fix:** Add `await requireAuth()` (or `requireAdmin()`) at the top of the handler, plus
rate limiting. If it truly is only for in-process jobs, delete the route and call `searchAllIndexers`
directly; an internal function does not need an HTTP surface. If a shared-secret server-to-server
call is needed, gate it on a header secret compared in constant time.

---

## HIGH

### A12-03 — FlareSolverr is dead code; Cloudflare-protected indexers silently fail
**Severity:** HIGH
**File:** `src/lib/indexer/flaresolverr.ts:14` (`flareSolve`), flag at `src/lib/indexer/types.ts:16`,
search path `src/lib/indexer/index.ts:155-193` & `:204-258`.

**What's wrong:** `flareSolve()` is exported but **never imported or called anywhere** in the
codebase (grep confirms only definitions/flag references, no call site). `searchIndexer()` always
uses a plain `fetch()` and never branches on `indexer.requires_flaresolverr`. So the entire
Cloudflare-bypass capability is inert: an indexer marked `requires_flaresolverr = 1` is queried with
a bare fetch, hits the Cloudflare JS challenge, returns a 403/503 HTML body, `parseXml` finds no
`<item>` elements and returns `[]`. The failure is silent (logged to stderr at most).

**Why it matters:** The feature advertised in `types.ts`/catalog (Cloudflare handling, the whole
reason FlareSolverr is in the stack) does nothing. Operators will add a Cloudflare-gated indexer,
see it "enabled," and get zero results with no actionable error. Also note `flareSolve` has no
timeout on its own `fetch` to FlareSolverr (only the `maxTimeout` *inside* the FlareSolverr command)
— if it were wired up, a hung FlareSolverr container would block with no AbortController.

**Suggested fix:** Either (a) wire it in: in `searchIndexer`, when `requires_flaresolverr`, fetch via
`flareSolve(url)` and parse `result.html`; add an `AbortController` around the FlareSolverr POST; or
(b) if out of scope for now, remove the flag/column and catalog references so the UI does not imply a
working capability. At minimum surface a distinct error when a Cloudflare challenge page is detected.

### A12-04 — Prowlarr proxy authorizes any logged-in user (not admin) and double-encodes JSON
**Severity:** HIGH
**File:** `src/app/api/prowlarr/[...path]/route.ts:13-46`

**What's wrong:** Two issues. (1) The proxy gates on `await requireAuth()` (`:14`) — **any
authenticated non-admin user** can call `POST/PUT/DELETE /api/prowlarr/<anything>` and the server
injects the Prowlarr master `X-Api-Key` (`:19`). That hands every regular user full write access to
Prowlarr (delete indexers, change configs, trigger searches) under the server's privileged key. (2)
The success path does `const data = ct.includes('application/json') ? await res.json() : await
res.text()` then `NextResponse.json(data, ...)` (`:35-36`). When Prowlarr already returns JSON this
re-serializes fine, but when it returns plain text (`res.text()`), wrapping a raw string in
`NextResponse.json` produces a **JSON-quoted string** body — the client receives `"...."` instead of
the original text, and any non-JSON/HTML error page from Prowlarr is corrupted. There is also no path
allowlist, so any `/api/v1/...` endpoint is reachable.

**Why it matters:** Privilege escalation: the proxy is the only thing standing between a normal
session and the Prowlarr admin API, and it lets everyone through. The double-encoding masks real
error bodies and breaks any caller that expects passthrough fidelity.

**Suggested fix:** Change `requireAuth()` to `requireAdmin()`. Add a path allowlist (or at least
block destructive verbs for non-admins). For body passthrough, stream `res.body` / return the raw
text with the upstream `Content-Type` rather than re-wrapping in `NextResponse.json`.

### A12-05 — Torznab category param sent as `cat` while callers populate `cats`; movie/TV filtering is silently dropped on multi-cat
**Severity:** HIGH
**File:** `src/lib/indexer/index.ts:164` vs `src/lib/indexer/types.ts:52-57`; callers
`src/app/api/torrent-search/route.ts:39-40`, `src/app/api/torznab/search/route.ts:27`.

**What's wrong:** `searchIndexer` maps `params.cats` → URL param `cat`
(`url.searchParams.set('cat', params.cats)`, `:164`). That part is correct for Torznab (the spec
param is `cat`). The real problem is the **adapters ignore categories entirely**: the
`yts`/`eztv`/`nyaa` branches in `searchAllIndexers` (`:214-224`) call `searchYts(params.q)` /
`searchEztv(params.imdbid)` / `searchNyaa(params.q)` and **never receive `params.cats`**. So when the
UI requests `type=movie` (`cats='2000'`, `torrent-search/route.ts:39`), Nyaa (anime) and EZTV (TV)
are still queried for a movie and their results — stamped with hardcoded categories `['5070']` /
`['5000']` — are merged in. The category intent is dropped for every non-Torznab adapter.

**Why it matters:** A movie search returns anime/TV torrents and vice-versa; the "Movies / TV" type
filter in the UI is effectively cosmetic for the three public adapters that are the default catalog.
Result quality and the scope-filtering downstream (`grabber.filterByScope`) get polluted.

**Suggested fix:** Pass the category intent into the adapter dispatch and skip adapters that cannot
serve the requested category (e.g. don't query Nyaa when `cats` is `2000`/movies-only; don't query
YTS for `5000`/TV). Alternatively post-filter merged results by `categories` against the requested
`cats` before returning.

### A12-06 — `updateIndexerHealth` silently discards the response time it is given
**Severity:** HIGH (data-integrity / observability)
**File:** `src/lib/indexer/config.ts:80-90`, called from `src/app/api/indexer/[id]/test/route.ts:26`.

**What's wrong:** `updateIndexerHealth(id, status, responseTimeMs)` accepts `responseTimeMs` as a
parameter but the SQL only writes `last_health_check` (=`Date.now()`) and `health_status`
(`UPDATE indexers SET last_health_check = ?, health_status = ? WHERE id = ?`). The `responseTimeMs`
argument is never used, and there is no `response_time_ms` column in the schema
(`migrations.ts:136-146`). The test route computes a real latency and passes it in, but it is dropped.

**Why it matters:** The persisted health record can never show latency, so the health badge on
reload only ever shows OK/Error with no timing — the responsiveness signal the test endpoint went to
the trouble of measuring is thrown away. It also misleads: a maintainer reading the call site
believes the timing is stored.

**Suggested fix:** Either drop the unused parameter (and the implication), or add a
`last_response_time_ms` column and persist it: `SET last_health_check = ?, health_status = ?,
last_response_time_ms = ?`.

---

## MEDIUM

### A12-07 — Adapters ignore the stored `base_url` / `torznab_url` and hardcode public hostnames
**Severity:** MEDIUM
**File:** `src/lib/indexer/adapters/eztv.ts:5`, `nyaa.ts:6`, `yts.ts:5`.

**What's wrong:** Each adapter hardcodes the upstream host (`https://eztv.re/api/get-torrents`,
`https://nyaa.si/?page=rss`, `https://yts.mx/api/v2/list_movies.json`) and never reads the indexer
row's `base_url`. The DB stores `base_url` (`eztv.re`, `nyaa.si`, `yts.mx`) but it is decorative.

**Why it matters:** These public trackers rotate domains frequently (EZTV especially). When `eztv.re`
goes down or moves, the operator cannot point the adapter at a working mirror via the admin UI — the
only fix is a code change and redeploy. The catalog `base_url` field implies configurability that
does not exist.

**Suggested fix:** Have each adapter accept the `Indexer` (or its `base_url`) and build the request
URL from it, falling back to the hardcoded default only when unset.

### A12-08 — Prowlarr discovery embeds the master API key into the stored URL and the `api_key` column
**Severity:** MEDIUM (secret handling)
**File:** `src/lib/indexer/discovery.ts:86-97`.

**What's wrong:** For each discovered Prowlarr indexer it stores
`torznab_url = `${prowlarrUrl}/${idx.id}/api?apikey=${prowlarrKey}`` and `api_key = prowlarrKey`. The
master Prowlarr key is now persisted twice (in the URL query string and the key column) for every
discovered row. Combined with A12-01, that key is then shipped to the browser on GET. Separately the
constructed Torznab URL is almost certainly wrong: Prowlarr's per-indexer Torznab path is
`/{id}/api` under `/api/v1/indexer` only via the newznab download endpoint — `${prowlarrUrl}/${id}/api`
omits the `/api/v1/indexer` (or `/download`) segment Prowlarr expects, so these rows likely 404 on
search.

**Why it matters:** Secret duplication widens exposure (A12-01), and the malformed URL means
"discovered" indexers silently return `[]`.

**Suggested fix:** Store the key only in the `api_key` column (not in the URL); build the request URL
at query time. Verify the actual Prowlarr Torznab endpoint shape against a live instance before
seeding rows. Mask the key everywhere it leaves the server.

### A12-09 — Nyaa size regex is too strict and drops size for valid feeds
**Severity:** MEDIUM
**File:** `src/lib/indexer/adapters/nyaa.ts:49`.

**What's wrong:** Size is parsed with `^([\d.]+)\s*(GiB|MiB|KiB|B)$` anchored on both ends. Nyaa's
`nyaa:size` values include `TiB` for large packs and occasionally `KB`/`GB` variants; any value that
is not exactly one of the four listed units (or has surrounding whitespace/extra text) fails the
match and `size` stays `0`. The anchored `B` alternative also greedily fails `KiB`/`MiB` only because
they are listed first, but `TiB` has no branch at all.

**Why it matters:** Large anime batches (the exact thing Nyaa is used for) report `0` bytes, which
breaks size-based sorting/filtering and any disk-space pre-check downstream.

**Suggested fix:** Add `TiB` (and optionally decimal `KB/MB/GB/TB`) to the unit map, and make the
regex tolerant of trailing content. Consider a shared size-parser used by all adapters.

### A12-10 — No timeout on YTS / EZTV / Nyaa adapter fetches
**Severity:** MEDIUM
**File:** `src/lib/indexer/adapters/yts.ts:43`, `eztv.ts:31`, `nyaa.ts:29`.

**What's wrong:** Only the Torznab path (`searchIndexer`) wraps `fetch` in a 10 s `AbortController`
(`index.ts:171-175`). The three JSON/RSS adapters call bare `fetch(url)` with no signal. The
concurrency-3 limiter in `searchAllIndexers` means a single hung adapter holds its slot indefinitely
and the overall search can stall far past any user-visible budget.

**Why it matters:** A slow/black-holed public tracker (common) makes the whole aggregated search hang
with no upper bound. The per-indexer timeout that protects Torznab indexers does not protect the
default public catalog.

**Suggested fix:** Give each adapter the same `AbortController` + `setTimeout(…, 10_000)` pattern, or
have `searchAllIndexers` wrap every dispatched call (Torznab and adapter alike) in a shared
`withTimeout()` so the guarantee is uniform.

### A12-11 — No caching or rate limiting on the search fan-out; every query hits every external API live
**Severity:** MEDIUM (optimization)
**File:** `src/lib/indexer/index.ts:204-258`; routes `torrent-search/route.ts`,
`torznab/search/route.ts`.

**What's wrong:** There is no `unstable_cache`/memoization, no short-TTL result cache, and no
per-host rate limiter anywhere on the path (grep for `unstable_cache|revalidate|cache(` over the
indexer dirs returns nothing). Identical back-to-back searches (UI re-renders, retries, multiple
monitored items resolving the same title) each fan out fresh to every indexer.

**Why it matters:** Redundant external load increases latency and tracker-ban exposure (compounds
A12-02). A 30–60 s result cache keyed on the normalized query would cut most duplicate traffic with
no correctness cost for torrent search.

**Suggested fix:** Add a small TTL cache (in-memory Map with timestamp, or `unstable_cache`) keyed by
`{q,cats,imdbid,season,ep}`; add a token-bucket per external host to cap outbound QPS.

### A12-12 — `parseXml` only recognizes `magneturl`/`infohash`; misses `magnetUrl`-cased attrs and `<enclosure>` magnets
**Severity:** MEDIUM
**File:** `src/lib/indexer/index.ts:75-125`.

**What's wrong:** Torznab attr names are matched case-sensitively against lowercased literals
(`attrMap.get('magneturl')`, `attrMap.get('infohash')`, `'seeders'`, `'leechers'`). Real-world
Torznab/Newznab feeds (Jackett, some Prowlarr definitions) emit mixed case (`magnetUrl`, `infoHash`)
and frequently deliver the magnet via `<enclosure url="magnet:?..."/>` or the `<link>` rather than a
`torznab:attr`. None of those are handled: the attr lookup misses, and the magnet/infohash fall back
only to the `guid` 40-hex regex. Items can end up with empty `magnetUrl` and `infoHash` even though
the feed carried them.

**Why it matters:** Results from common Jackett/Prowlarr indexers may have no usable download target
or infohash, so they get dropped from dedup (A12 dedup keys on infohash) or are undownloadable. The
parser silently under-reports.

**Suggested fix:** Lowercase the attr `name` when building `attrMap` (and lookup with lowercase keys);
also read `<enclosure>` `url` for `magnet:`/`.torrent`, and treat a `magnet:` in `<link>` as the
magnet. Extract infohash from any of those before the guid fallback.

---

## LOW

### A12-13 — `searchAllIndexers` concurrency is a global constant of 3, not per-host, and not configurable
**Severity:** LOW
**File:** `src/lib/indexer/index.ts:210`.

**What's wrong:** `createLimit(3)` caps total in-flight indexer queries at 3 regardless of how many
indexers are enabled. With many indexers this serializes the search into batches; with few it is
fine. It is hardcoded with no env/setting.

**Why it matters:** On a large indexer set, total search latency scales in ceil(n/3) × slowest-batch
rather than max(single). Minor for the default 3-indexer catalog, more noticeable as indexers grow.

**Suggested fix:** Make concurrency configurable (env or app_settings) and consider limiting
per-host rather than globally.

### A12-14 — `testIndexer` only probes Torznab `t=caps`; for YTS/EZTV/Nyaa it tests a URL that does not exist
**Severity:** LOW
**File:** `src/lib/indexer/index.ts:268-303`, used by `test/route.ts:25` and `activate/route.ts:30`.

**What's wrong:** `testIndexer` always builds `new URL(indexer.torznab_url)` and hits `t=caps`. For
the seeded public adapters `torznab_url` is empty string (`catalog.ts:11,23,29`), so `new
URL('')` throws → caught → reported as a generic error, OR (since they are enabled without a
torznab_url) the Test button on a YTS/EZTV/Nyaa row reports failure for a perfectly working indexer.
The test does not route through the adapter's real endpoint.

**Why it matters:** Operators get a red "Error" badge when testing the three default public indexers
even though search works, eroding trust in the health UI.

**Suggested fix:** Branch `testIndexer` on `search_type` like `searchAllIndexers` does — for
`yts/eztv/nyaa` do a lightweight real probe (e.g. a tiny query) instead of a Torznab caps call.

### A12-15 — `activate` writes credentials but never updates persisted health; status stays stale
**Severity:** LOW
**File:** `src/app/api/indexer/[id]/activate/route.ts:38-39`.

**What's wrong:** On successful activation it calls `activateIndexer(...)` (sets url/key/enabled=1)
and returns `health`, but never calls `updateIndexerHealth`. So the row's `health_status` /
`last_health_check` are not written even though a successful test just ran. The badge shows `—` until
the next manual Test.

**Why it matters:** Minor UX inconsistency — a freshly activated, verified indexer looks untested.

**Suggested fix:** Call `updateIndexerHealth(id, health.status, health.responseTimeMs)` after
`activateIndexer`.

### A12-16 — `createIndexer` cannot set `search_type`; all UI-added indexers default to `torznab`
**Severity:** LOW
**File:** `src/lib/indexer/config.ts:25-39`, `src/app/api/indexer/route.ts:25-29`.

**What's wrong:** The POST create path only accepts `{name, torznab_url, api_key}` and the INSERT
omits `search_type`, so it defaults to `'torznab'` (schema default). There is no way to create a
`yts/eztv/nyaa`-typed indexer via the API/UI; only the first-run seed can.

**Why it matters:** If the seed is skipped (DB already had rows) or a public adapter is deleted, it
cannot be recreated through the UI. Low impact given the seed, but a real gap.

**Suggested fix:** Accept an optional `search_type` (allowlisted) on create and pass it through.

### A12-17 — EZTV adapter dereferences `torrent.hash.toLowerCase()` without null-guarding the field
**Severity:** LOW
**File:** `src/lib/indexer/adapters/eztv.ts:38`.

**What's wrong:** `infoHash: torrent.hash.toLowerCase()` assumes `hash` is always a non-null string.
EZTV occasionally returns entries with a missing/empty `hash`. If `hash` is `undefined`/`null`,
`.toLowerCase()` throws — but it's inside the `.map`, so the throw propagates out of the whole `map`
and is caught by the outer `try/catch` (`:49`), discarding **all** results from that response, not
just the bad row.

**Why it matters:** One malformed EZTV entry silently zeroes the entire EZTV result set for that
query. Low frequency but high blast radius per occurrence.

**Suggested fix:** Guard: `infoHash: (torrent.hash ?? '').toLowerCase()`, and skip entries with no
hash/magnet rather than letting a single bad row abort the map.

---

## Things checked and found correct (not findings)

- **Failure isolation:** `searchAllIndexers` uses `Promise.allSettled` (`index.ts:212`) and only
  pushes `fulfilled` values; every adapter and `searchIndexer` swallows errors into `[]`. One bad
  indexer cannot kill the search. ✔
- **Per-indexer timeout (Torznab path):** 10 s `AbortController` in `searchIndexer`
  (`index.ts:171-175`); 5 s in `testIndexer`. ✔ (adapters lack this — A12-10).
- **Dedup:** by `infoHash`, keeping higher seeders; empty-hash results preserved (`index.ts:236-252`).
  Reasonable. ✔
- **SQL injection:** `updateIndexer` allowlists columns before building the dynamic SET
  (`config.ts:56-60`); all other queries are parameterized. ✔
- **Indexer CRUD authz:** `/api/indexer`, `/[id]`, `/[id]/test`, `/[id]/activate` all call
  `requireAdmin()`. ✔ (the gap is the Prowlarr proxy A12-04 and torznab/search A12-02).
- **Activate tests before persisting:** `activate/route.ts` runs `testIndexer` with the *provided*
  creds and returns 422 on failure before writing. ✔
- **`parseXml` robustness for xml2js guid shape:** correctly handles guid-as-object vs guid-as-string
  (`index.ts:99-103`) and multi-category collection. ✔
</content>
</invoke>
