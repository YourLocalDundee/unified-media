# Audit 19 — API Input Validation & Payload Handling (cross-cutting)

**Scope:** Input *shape / type / bounds* correctness across all ~105 `src/app/api/**/route.ts` handlers — request-body validation, numeric query/route param coercion, pagination caps, enum allowlists, content-negotiation, coercion footguns, and response-shape robustness.
**Out of scope (covered by prior reports):** authn/authz gaps (reports 01, 09, 13, 14), CSRF/Origin (14), SQL injection (14), SSRF-via-`[...path]` host (13). Where this report mentions an unguarded relay it is *only* about the missing input validation, not the auth gap.
**Date:** 2026-06-14 · **Mode:** READ-ONLY · **App:** unified-frontend v0.9.5 (Next.js 16, better-sqlite3, TypeScript, no zod).

---

## Summary

Validation is **hand-rolled and wildly inconsistent**. A minority of routes are exemplary
(`media/image` size allowlist + path guard; `admin/users/[id]` PATCH allowlist + try/catch;
`automation/items` POST per-field type checks; `subtitle` filter allowlist;
`subtitles/embedded/[id]/[streamIndex]` integer guard). The majority trust the client. The
recurring defects:

1. **Unguarded `await req.json()`** — ~22 mutating handlers parse the body with no try/catch, so an
   empty body, non-JSON body, or wrong `Content-Type` throws and returns an unhandled **500** instead
   of a 400. (party/auth routes are the exception — they use `.json().catch(()=>null)`.)
2. **Maltyped values bound straight into SQL.** Several handlers validate *field names* (SQLi-safe,
   per report 14) but never validate *value types*. A PATCH with `{"tmdb_id":{}}` or `{"score":[1]}`
   passes the allowlist and reaches `better-sqlite3 .run()`, which throws `TypeError: SQLite3 can only
   bind numbers, strings, …` → unhandled 500. Worse, `.trim()`/`.length` are called on fields assumed
   to be strings, throwing on a numeric/object value.
3. **Numeric params not range-checked.** `parseInt`/`Number` results feed SQL `LIMIT/OFFSET`, array
   indices, and `fs.createReadStream({start,end})` with no NaN / negative / `start>end` / overflow
   guards. The `Range` header parser in `media/stream/[id]` is the worst case (negative
   `Content-Length`, no 416).
4. **No pagination upper bound on most list routes** (only `media/items` caps at 200). `limit`/`take`
   are passed through unbounded.
5. **Blind body/param relays** to Jellyfin / the download client with no shape validation
   (`jellyfin/sessions/*`, `requests/[id]/grab` magnet override).

### Counts by severity

| Severity | Count |
|---|---|
| HIGH     | 3 |
| MEDIUM   | 9 |
| LOW      | 6 |
| **Total** | **18** |

---

## HIGH

### A19-H1 — `media/stream/[id]` Range header parsed with no validation (negative Content-Length, no 416)
**Severity:** HIGH
**File:** `src/app/api/media/stream/[id]/route.ts:47-78`
**What's wrong:** `start = parseInt(startStr ?? '0', 10)` and `end = endStr ? parseInt(endStr,10) : fileSize-1` are used directly with no validation. A `Range: bytes=abc-` yields `start=NaN`; `Range: bytes=999999999-0` yields `start>end`; a start ≥ `fileSize` is not rejected with 416. `chunkSize = end-start+1` can be negative/NaN and is emitted as `Content-Length`. The values flow into `fs.createReadStream(filePath,{start,end})`.
**Why it matters:** Any authenticated client can send a malformed/over-range `Range` header and get a stream with a negative or NaN `Content-Length` and a nonsensical `Content-Range`, or trigger a read-stream error → broken/500 response. RFC 7233 requires a 416 for unsatisfiable ranges; none is returned. This is the single most attacker-reachable numeric-coercion bug.
**Suggested fix:** After parsing: `if (Number.isNaN(start) || start < 0 || start >= fileSize) return 416 with 'Content-Range: bytes */'+fileSize`; clamp `end = Math.min(end, fileSize-1)`; if `end < start` → 416.

### A19-H2 — Maltyped body values bound into SQL without type checks (systemic; quality-profiles, automation items, indexers)
**Severity:** HIGH
**Files (representative):**
- `src/app/api/quality-profiles/[id]/route.ts:45,47-50,64,73-74` (PATCH)
- `src/app/api/quality-profiles/route.ts:27,34` (POST)
- `src/lib/automation/monitor.ts:153-173` (`updateItem`, reached via `automation/items/[id]` PATCH)
- `src/lib/indexer/config.ts:58-68` (`updateIndexer`, reached via `indexer/[id]` PATCH)
- `src/app/api/admin/invites/route.ts:31,36` (POST): `body.maxUses ?? 1`, `body.expiresAt ?? null` bound to INSERT with no type check; an object value throws.
**What's wrong:** These handlers/helpers allowlist the *column names* (so report 14 correctly found no SQLi) but never validate *value types*. The client controls the JSON value. Examples:
  - quality-profiles PATCH binds `cutoff_quality_id`, `min_format_score`, `cutoff_format_score` directly (line 47-49); an object/array value → `better-sqlite3` throws `TypeError: SQLite3 can only bind…` → 500.
  - `body.name.trim()` (line 45) and `body.language.trim()` (line 50) throw `TypeError` if the field is present but non-string (number, object, null).
  - `body.formats` is iterated (line 73) with no `Array.isArray` check; `f.format_id`/`f.score` bound unchecked.
  - `updateItem`/`updateIndexer` pass the raw value for any allowlisted key straight to `.run()` — `{"tmdb_id":{}}`, `{"enabled":[1]}`, `{"year":true}` all reach SQLite and throw.
**Why it matters:** Admin-only, but any malformed admin request (or a buggy client) yields a 500 instead of a 400, and in the case of partial multi-statement handlers (quality-profiles PATCH writes profile fields, then formats, with no transaction) a throw mid-way leaves the row half-updated. The pattern is duplicated across the automation/indexer/quality config surface.
**Suggested fix:** Centralise a `coerceInt`/`coerceString`/`coerceBool` helper and validate each value before binding (reject or coerce non-conforming types with 400). Wrap multi-statement writes in a transaction.

### A19-H3 — `requests/[id]/grab` forwards client `magnetUrl` to the download client unvalidated
**Severity:** HIGH
**File:** `src/app/api/requests/[id]/grab/route.ts:32-45`
**What's wrong:** `body = await req.json()` (the inner `try/catch` only covers an *empty* body; a present-but-malformed `magnetUrl` is trusted). When `body.magnetUrl` is truthy it is passed verbatim to `getClient().addTorrent({ urls: body.magnetUrl })` with no check that it is a `magnet:`/`http(s):` URL. `info_hash`/`indexerName`/`title` are likewise stored unvalidated.
**Why it matters:** The download client (qBittorrent `/torrents/add` via UMT) will accept whatever string it is handed — a local file path, an arbitrary `http://internal-host/…` URL, or junk. This is an SSRF/abuse vector into the torrent backend through a *body* field that the proxy/SSRF report (which covered `[...path]` segments) did not examine. Same untyped-magnet pattern also appears in `requests/route.ts:159-162` (`pickedTorrent.magnetUrl || pickedTorrent.downloadUrl`).
**Suggested fix:** Validate the scheme with a strict regex (`^magnet:\?` or `^https?://`) and reject otherwise with 400 before calling `addTorrent`. Apply the same guard in `requests/route.ts`.

---

## MEDIUM

### A19-M1 — Unguarded `await req.json()` across ~22 mutating handlers → unhandled 500 on bad body
**Severity:** MEDIUM (systemic)
**Files (representative, not exhaustive):**
- `src/app/api/media/progress/route.ts:16`
- `src/app/api/media/playback/route.ts:16`
- `src/app/api/jellyfin/sessions/progress/route.ts:10`, `…/playing/route.ts`, `…/stopped/route.ts`
- `src/app/api/requests/route.ts:45`
- `src/app/api/indexer/route.ts:16`, `indexer/[id]/route.ts:39`
- `src/app/api/quality-profiles/route.ts:19`, `quality-profiles/[id]/route.ts:27`
- `src/app/api/automation/items/route.ts:26`, `automation/items/[id]/route.ts:57`
- `src/app/api/admin/settings/route.ts:18`, `subtitle/[id]/route.ts:20`, `admin/invites/route.ts:31`
**What's wrong:** These call `await req.json()` with no surrounding try/catch. An empty body, a body that is not valid JSON, or a request with a non-JSON `Content-Type` makes `.json()` reject, the rejection is uncaught, and the handler returns a generic 500.
**Why it matters:** Routes that should answer `400 Bad Request` instead 500 — noisier logs, worse client UX, and a trivially reachable error path (just `POST` with an empty body). Contrast `party/*` and most `auth/*` routes which correctly use `await req.json().catch(()=>null)` then validate.
**Suggested fix:** Wrap every body parse in `try { body = await req.json() } catch { return 400 }` (the `admin/users/[id]` and `auth/profile/demographics` routes already model this).

### A19-M2 — `Number()` coercion lets NaN reach SQL LIMIT/OFFSET (media/items, media/resume); offset uncapped
**Severity:** MEDIUM
**Files:** `src/app/api/media/items/route.ts:13-14,22,26`; identical pattern in `src/app/api/media/resume/route.ts:12` (`Math.min(Number(... ?? '12'), 50)`)
**What's wrong:** `limit = Math.min(Number(searchParams.get('limit') ?? '50'), 200)` — `Number('abc')` is `NaN`, and `Math.min(NaN,200)` is `NaN`, which flows into `getItemsByType(type, limit, offset)` → SQL `LIMIT`. `offset = Number(...)` has no NaN/negative cap at all (`offset=-5` or `offset=1e9` pass through).
**Why it matters:** A `LIMIT NaN` / `OFFSET NaN` either errors in SQLite or silently returns nothing; a huge offset is a wasted full scan. No floor at 0, no integer coercion, no NaN fallback. This is the canonical "parseInt/Number → NaN into SQL" footgun the brief calls out.
**Suggested fix:** `const limit = Math.min(Math.max(1, Number.parseInt(raw,10) || 50), 200)`; clamp offset `Math.max(0, Number.parseInt(raw,10) || 0)`.

### A19-M3 — No pagination upper bound on list routes (unbounded `limit`/`take`)
**Severity:** MEDIUM (systemic)
**Files (representative):** `src/app/api/requests/route.ts` (no take/limit at all — returns *all* rows), list helpers reached from `automation/items`, `subtitle`, `indexer` (all `getAll*` with no cap), `media/resume`, `media/stats`. Only `media/items` (200) caps anything.
**What's wrong:** Most list endpoints return the full table or accept a client-supplied `limit` with no maximum. `requests` GET calls `getAllRequests()/getUserRequests()` with no pagination.
**Why it matters:** A client (or a growing DB) can force a giant query + giant JSON response. The brief explicitly asks for default+max caps; they are absent on nearly every list route.
**Suggested fix:** Add a default (e.g. 50) and hard max (e.g. 200) to every list handler; paginate `requests`.

### A19-M4 — `quality-profiles/[id]` PATCH/DELETE: `parseInt(id)` NaN not guarded → 500 on bad id
**Severity:** MEDIUM
**File:** `src/app/api/quality-profiles/[id]/route.ts:15,26,87`
**What's wrong:** GET uses `getProfileFull(parseInt(id,10))` and returns 404 on null — safe. But PATCH (`profileId = parseInt(id,10)`, line 26) and DELETE (line 87) never check `isNaN`; a non-numeric `[id]` yields `WHERE id = NaN`, which `better-sqlite3` rejects as a non-bindable value → 500. Most sibling routes (`indexer/[id]`, `automation/items/[id]`, `subtitle/[id]`) *do* guard `isNaN`; this one is the outlier.
**Why it matters:** `PATCH /api/quality-profiles/abc` 500s instead of 400/404. Inconsistent with the rest of the `[id]` family.
**Suggested fix:** Add `if (Number.isNaN(profileId)) return 400` after each parse, matching the sibling routes.

### A19-M5 — `requests` POST trusts `seasons`/`scopeSeasons`/`scopeEpisodes` shapes and numeric fields
**Severity:** MEDIUM
**File:** `src/app/api/requests/route.ts:45-78,116-118,125-139`
**What's wrong:** Only `tmdbId`/`mediaType`/`title` are presence-checked (and `mediaType` is *not* validated against `'movie'|'tv'` — a typo'd value flows into `createRequest`, `createItem({type: mediaType==='movie'?…:'tv'})`, and the download category). `year` is used in `year < currentYear` with no number check (a string `"2019"` compares lexically/coerces oddly). `seasons`/`scopeSeasons`/`scopeEpisodes` are passed to `createRequest` and only *some* paths `Array.isArray`-guard them (lines 176-177) while `createRequest` itself receives them raw (line 132-137).
**Why it matters:** Mass-assignment-ish: the body shape is trusted into multiple DB writes and an external `addTorrent` category. A non-array `scopeEpisodes` or a bogus `mediaType` produces inconsistent rows or downstream throws.
**Suggested fix:** Validate `mediaType ∈ {movie,tv}`, coerce `year`/`tmdbId` to integers, and `Array.isArray`-guard all three season/episode fields before use.

### A19-M6 — `jellyfin/sessions/*` blindly relay the request body to Jellyfin (no shape/type validation)
**Severity:** MEDIUM
**Files:** `src/app/api/jellyfin/sessions/progress/route.ts:10-11`, `…/playing/route.ts`, `…/stopped/route.ts`
**What's wrong:** `const body = await req.json(); await jellyfinFetch('/Sessions/Playing/Progress',{body:JSON.stringify(body)})`. No try/catch, no field validation — the entire client object is forwarded to Jellyfin's session API. (Report 14 flagged the *missing auth*; this finding is the *unvalidated relay + unhandled-JSON 500*.)
**Why it matters:** Malformed JSON → 500; otherwise an arbitrary attacker-shaped object reaches Jellyfin's `/Sessions/*` endpoints. No allowlist of fields (ItemId, PositionTicks, etc.).
**Suggested fix:** Parse defensively, validate the handful of fields Jellyfin needs, and forward only those.

### A19-M7 — `jellyfin/subtitles/[itemId]/[streamIndex]`: params interpolated into upstream URL with no validation
**Severity:** MEDIUM
**File:** `src/app/api/jellyfin/subtitles/[itemId]/[streamIndex]/route.ts:14-16`
**What's wrong:** `itemId` and `streamIndex` are placed straight into `${JELLYFIN_URL}/Videos/${itemId}/Subtitles/${streamIndex}/Stream.vtt` with no integer/format check (contrast the sibling `media/subtitles/embedded/[id]/[streamIndex]` which does `Number.isInteger(...) && >=0`). Path segments are not URL-encoded.
**Why it matters:** A crafted `streamIndex` like `0/../../Users` (URL-encoded) could alter the upstream path; at minimum non-integer values produce malformed upstream requests. Input-shape gap distinct from the auth gap report 13 noted for the Jellyfin metadata relays.
**Suggested fix:** Validate `streamIndex` is a non-negative integer; validate/encode `itemId`; reject otherwise with 400.

### A19-M8 — `media/playback` & `media/progress`: enum/type fields unvalidated; `positionTicks` not bounds-checked
**Severity:** MEDIUM
**Files:** `src/app/api/media/playback/route.ts:16-23`, `src/app/api/media/progress/route.ts:16-23`
**What's wrong:** playback: `method`/`quality` are typed as unions but only presence (`!method`) is checked — any string passes to `createSession(mediaId, method, quality)`. progress: `positionTicks` is checked only for `=== undefined`; a negative, NaN, string, or absurdly large value is written via `upsertWatchState`. `played` defaults to a non-boolean if the client sends a string.
**Why it matters:** Garbage resume positions persist to `media_watch_state`; an out-of-enum `quality`/`method` may break the transcode/stream layer downstream.
**Suggested fix:** Allowlist `method ∈ {direct,hls}` and `quality ∈ {1080p,720p,480p,360p}`; coerce `positionTicks` to a non-negative integer.

### A19-M9 — `requests/[id]/approve`: unguarded `JSON.parse` of `scope_seasons`/`scope_episodes` DB columns → 500
**Severity:** MEDIUM
**File:** `src/app/api/requests/[id]/approve/route.ts:160-161` (cf. the *guarded* parse at 178-184)
**What's wrong:** `scope_seasons` / `scope_episodes` are read back from `media_requests` and `JSON.parse`d with no try/catch (lines 160-161). These columns are populated from **client-supplied** request bodies (written via `JSON.stringify` in `requests/route.ts:176-177` and the scope fields of `createRequest`). The parse sits inside the `createItem` try block, but that catch only swallows messages containing `'already exists'` — any `SyntaxError` from a malformed/legacy column value re-throws and returns 500. Note the `preferred_release` parse on line 180 *is* correctly wrapped in its own try/catch, showing the author knew the pattern — it just was not applied to the scope columns.
**Why it matters:** A single corrupt/legacy/hand-edited `scope_seasons` value makes approving that request impossible (hard 500), and the inconsistency (one parse guarded, two not) is a latent footgun. The brief explicitly calls out "`JSON.parse` of DB text columns without guards."
**Suggested fix:** Wrap each `JSON.parse` in a try/catch that falls back to `null` (as the `preferred_release` parse already does), or use a shared `safeJsonParse` helper.

---

## LOW

### A19-L1 — `admin/audit/export`: `new Date(param)` → NaN silently returns empty CSV
**Severity:** LOW
**File:** `src/app/api/admin/audit/export/route.ts:44-45`
**What's wrong:** `fromMs = new Date(fromParam).getTime()` is `NaN` for a garbage `?from=` value; `created_at >= NaN AND <= NaN` matches nothing. No validation/feedback.
**Why it matters:** Admin gets a silently empty export instead of a 400; confusing, not dangerous.
**Suggested fix:** Validate `!Number.isNaN(fromMs/toMs)` and 400 on bad dates.

### A19-L2 — `search` GET: `Math.max(1, Number(page))` yields NaN for non-numeric `page`
**Severity:** LOW
**File:** `src/app/api/search/route.ts:20`
**What's wrong:** `Number('abc')` → NaN, `Math.max(1, NaN)` → NaN, passed to `searchTMDB(q,type,page)`. `type` cast to the union with no allowlist.
**Why it matters:** NaN reaches the TMDB page param (string-interpolated, low impact); a bogus `type` is forwarded unchecked.
**Suggested fix:** `Number.parseInt(...,10) || 1`; allowlist `type`.

### A19-L3 — `jellyfin/image/[itemId]`: `type`/`index`/`width` unvalidated in upstream URL
**Severity:** LOW
**File:** `src/app/api/jellyfin/image/[itemId]/route.ts:15-34`
**What's wrong:** `type` is used as a path segment and `index`/`width` as query values with no allowlist/integer check (the sibling `media/image` route correctly allowlists sizes). `new URL()` encodes query values, limiting the blast radius, but `type` reaches the path.
**Why it matters:** Mostly cosmetic (bad artwork / 404 from Jellyfin); minor SSRF surface is bounded by the fixed `JELLYFIN_URL` host.
**Suggested fix:** Allowlist `type ∈ {Primary,Backdrop,Thumb,Logo}`; coerce `index`/`width` to integers.

### A19-L4 — `auth/profile/demographics`: length checks throw on non-string fields
**Severity:** LOW
**File:** `src/app/api/auth/profile/demographics/route.ts:23-41`
**What's wrong:** `if (bio && bio.length > 256)` etc. assume the field is a string; if the client sends `bio: 123`, `bio.length` is `undefined` (check passes) and `bio.trim()` (line 37) throws `TypeError` → 500. The try/catch only covers `req.json()`, not the field handling.
**Why it matters:** Authenticated user can 500 the route with a maltyped field. Low impact (own data).
**Suggested fix:** `typeof bio === 'string'` guard before `.length`/`.trim()`.

### A19-L5 — `admin/settings` PUT: generic key/value writer (mass-write to app_settings)
**Severity:** LOW
**File:** `src/app/api/admin/settings/route.ts:18-25`
**What's wrong:** Iterates every `[key,value]` in the body and writes any string/string pair via `setSetting(key,value)` with no key allowlist. Admin-only and string-gated (non-strings dropped), so impact is contained, but there is no schema — a client can create arbitrary settings keys.
**Why it matters:** Unexpected/garbage settings rows; depends on how `getSettings()` consumers treat unknown keys. Low because admin-gated and type-filtered.
**Suggested fix:** Allowlist the known settings keys.

### A19-L6 — `media/hls/[id]/[...slug]`: `audioRel = parseInt(slug[0].slice(1))` not range-validated before `getSegmentPath`
**Severity:** LOW
**File:** `src/app/api/media/hls/[id]/[...slug]/route.ts:56-57,112`
**What's wrong:** The manifest branch *does* bounds-check `audioRel` against `probe.audioStreams.length` (line 81). The *segment* branch (line 112) passes `audioRel` straight to `getSegmentPath(id, audioRel, resource)` with only the `/^a\d+$/` regex as a guard — a huge value (`a999999999`) parses fine and builds a cache path that won't exist (→ 503), but the value is otherwise unbounded.
**Why it matters:** Bounded by the regex (digits only) and the 503 fallback, so low — no traversal, just a miss.
**Suggested fix:** Clamp `audioRel` to `[0, audioStreams.length)` in the segment branch too.

---

## Routes reviewed and found OK (representative)

- `media/image` — size allowlist + path-must-start-with-`/` guard (model implementation).
- `admin/users/[id]` PATCH/DELETE — field allowlist, try/catch body, self-demote/self-delete guards.
- `automation/items` POST — explicit per-field `typeof` checks before `createItem`.
- `subtitle` GET / `subtitle/[id]` PATCH — status validated against a 4-value allowlist.
- `media/subtitles/embedded/[id]/[streamIndex]` — `Number.isInteger && >= 0` guard.
- `tmdb/tv/[tmdbId]/season/[seasonNumber]` — `isNaN` guard on both numeric params, try/catch.
- `admin/activity` — `Math.max(1, parseInt(page))`, fixed server-side limit.
- `party/*` — `.json().catch(()=>null)` + presence checks.
- `indexer/[id]`, `automation/items/[id]`, `subtitle/[id]` — `isNaN(id)` guards (the good pattern A19-M4 is missing).

*(Draft — to be refined.)*
