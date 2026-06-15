# Audit 07 — Downloads & Torrent Management

Scope: `/downloads` page + components, `/api/qbit/[...path]`, `/api/torrent-search`,
`/api/torznab/search`, `/api/media/match-torrent`, `TorrentPickModal`, the download-client
abstraction (`src/lib/download-client/*`), and `src/lib/qbittorrent/*`.

## Summary

The qBittorrent integration is functionally solid for the happy path: the SID cookie is held
server-side, v4/v5 cookie names and stop/start endpoint renames are handled, the proxy correctly
forwards multipart `.torrent` uploads and query strings, and the `useMainData` delta-merge polling
loop is efficient (rid threading, in-place map, single 2s interval with proper cleanup). The
download-client abstraction has a clean interface and the qBittorrent adapter implements it fully.

However there is **one CRITICAL auth gap**: the `/api/qbit/[...path]` proxy performs **no
`requireAuth()` check** — unlike every sibling proxy (sonarr/radarr/prowlarr/bazarr). Any
unauthenticated client that can reach the app can drive the entire qBittorrent API (add/delete
torrents, change preferences, read save paths, ban peers). The Transmission/Deluge adapters are
unimplemented stubs that throw, so selecting either via `DOWNLOAD_CLIENT` silently breaks the whole
download surface with no UI signal. The interactive-pick grab path contradicts the documented
"interactive always goes to the admin queue" contract (it auto-approves and grabs quick+interactive
picks). Several button/UX defects: the active `/downloads` page has no delete-with-data path at all
(always `deleteFiles=false`) and a confusing confirm dialog; the entire component-split UI
(`TorrentRow.tsx`, `DetailPanel.tsx`, `FilterSidebar.tsx`, `AddTorrentModal.tsx`) is dead code, not
imported anywhere. Action hooks swallow errors so failures are invisible until the next poll.

| Severity | Count |
|---|---|
| CRITICAL | 1 |
| HIGH | 4 |
| MEDIUM | 7 |
| LOW | 6 |
| **Total** | **18** |

---

## CRITICAL

### A7-01 — `/api/qbit/[...path]` proxy is not auth-gated
- **Severity:** CRITICAL
- **File:** `src/app/api/qbit/[...path]/route.ts:19` (GET), `:32` (POST)
- **What's wrong:** Neither the `GET` nor `POST` handler calls `requireAuth()`. Compare the sibling
  proxies, all of which gate at the handler: `src/app/api/sonarr/[...path]/route.ts:14`
  (`await requireAuth()`), and likewise radarr/prowlarr/bazarr. The `/downloads` *page* is gated by
  `src/app/downloads/layout.tsx`, but that protects the page render only — the API route is a
  separate, independently reachable endpoint. `src/proxy.ts` is explicitly documented as a UX-only
  redirect guard and "NOT a security boundary" (and it only redirects on missing cookie; it never
  validates the session, per CVE-2025-29927). So `/api/qbit/...` is effectively open to anyone who
  can issue an HTTP request to the container with any (or no) cookie that the edge lets through.
- **Why it matters:** This exposes the *entire* qBittorrent Web API to unauthenticated callers via a
  same-origin path: `POST /api/qbit/torrents/add` (add arbitrary magnets/URLs),
  `POST /api/qbit/torrents/delete` with `deleteFiles=true` (destroy library files),
  `POST /api/qbit/app/setPreferences` (rewrite save paths, disable the WebUI, change the proxy),
  `GET /api/qbit/app/preferences` (leaks WebUI host headers, proxy creds fields, IP filter paths),
  `GET /api/qbit/torrents/info` (leaks save paths and content layout). The server-side SID means the
  caller does not even need qBit credentials — the proxy attaches them. This is a full
  privilege-bypass of the download subsystem.
- **Suggested fix:** Add `await requireAuth()` at the top of both `GET` and `POST` in the qbit proxy
  (and `verifyOrigin(req)` on `POST`, matching the app's CSRF pattern in `src/lib/csrf.ts`), exactly
  as the sonarr proxy does. Consider `requireAdmin()` for the mutating preference endpoints.

---

## HIGH

### A7-02 — Transmission and Deluge adapters are throwing stubs with no graceful degradation
- **Severity:** HIGH
- **File:** `src/lib/download-client/transmission.ts:14-42`, `src/lib/download-client/deluge.ts:14-42`;
  selected by `src/lib/download-client/registry.ts:11-27` from `src/lib/download-client/config.ts:15`
- **What's wrong:** Every method on both stubs does `throw new Error('... not yet implemented')`.
  The registry instantiates the chosen client at module load based on `DOWNLOAD_CLIENT`. If an
  operator sets `DOWNLOAD_CLIENT=transmission` or `deluge` (both are accepted by the config type
  union and documented as "pluggable" in the task brief and CLAUDE.md), the app boots fine but every
  server-side call (`getClient().addTorrent(...)` in `src/app/api/requests/route.ts:159`, automation
  grabs, etc.) throws at call time. There is no capability flag and no fallback.
- **Why it matters:** "Download clients are pluggable (qBittorrent, Deluge, Transmission)" is a
  stated contract, but two of three silently break the request/grab pipeline at runtime with an
  opaque 500. The failure surfaces deep in the request flow (an interactive quick grab → 201 with
  `_grabError`, or a swallowed automation error), not at config time.
- **Suggested fix:** Either (a) make `registry.ts` throw a clear startup error naming the unsupported
  client, or (b) add an `isImplemented`/capabilities probe so callers can degrade. At minimum the
  client UI (`/downloads`) and the requests route should detect the not-implemented error and show
  "download client X is not supported in this build" rather than a generic failure.

### A7-03 — Interactive quick picks are auto-approved, contradicting the documented contract
- **Severity:** HIGH
- **File:** `src/app/api/requests/route.ts:153-216`; UI claim in
  `src/components/media/TorrentPickModal.tsx:634` ("Interactive picks always go to admin queue
  regardless of retention")
- **What's wrong:** CLAUDE.md §15 states the `request_method` gate makes `tryAutoApprove()` return
  false for any `request_method !== 'auto-pick'`, so a quick request submitted via TorrentPickModal
  (`requestMethod: 'interactive'`, set at `TorrentPickModal.tsx:289`) "is NOT auto-approved — it goes
  to the admin queue regardless." The route does the opposite: for `pickedTorrent` present AND
  `retentionType === 'quick'` it calls `client.addTorrent(...)` immediately, records a grab, and sets
  `status = 'approved', auto_approved = 1` (route.ts:159-207) — no admin gate. The modal footer text
  shown to the user (`:634`) also promises the admin-queue behavior, so the UI lies about what
  happens.
- **Why it matters:** Bypasses admin approval for hand-picked quick grabs, contradicts both the spec
  and the on-screen copy, and skips the quick-slot accounting that `tryAutoApprove()` enforces
  (1 movie / 2 TV) — a user can self-approve unlimited interactive quick grabs. This is a
  policy/logic divergence, not just cosmetic.
- **Suggested fix:** Decide the intended behavior and make code, docs, and UI agree. If the spec is
  authoritative, route quick+interactive to pending (admin queue) like longterm+interactive. If the
  immediate-grab behavior is intended, update CLAUDE.md §15 and remove the misleading footer text,
  and run the quick-slot check before grabbing.

### A7-04 — Torrent action hooks swallow all errors (no failure feedback)
- **Severity:** HIGH
- **File:** `src/lib/qbittorrent/hooks.ts:112-126` (`useTorrentAction`), `:155-177`
  (`useDeleteTorrents`), `:180-198` (`useAddTorrent`)
- **What's wrong:** Each action does `try { await fetch(...) } finally { setIsPending(false) }`.
  There is no `res.ok` check and no error state. The proxy returns `{ error }` with HTTP 500 on
  failure (route.ts:28, :87), and qBit itself returns non-2xx (e.g. 415 on bad add, 409 conflicts),
  but the hook treats every outcome as success. The in-code comment even acknowledges it: "errors are
  currently not surfaced to the caller." `AddTorrentForm.handleSubmit` (page.tsx:298-309) closes the
  form and clears inputs unconditionally.
- **Why it matters:** A failed pause/resume/delete/add gives the user a success-looking UI; the only
  signal is that the next 2s poll doesn't reflect the change. A failed add silently discards the
  magnet/URL the user typed. Destructive deletes that fail (e.g. qBit unreachable) look like they
  worked.
- **Suggested fix:** Check `res.ok`, throw on non-2xx, and expose an `error` from each hook; surface
  it via a toast/inline message. `AddTorrentForm` should not clear/close on failure (the
  `AddTorrentModal` dead-code version does this correctly at `AddTorrentModal.tsx:120-136`).

### A7-05 — Active `/downloads` page has no "delete with data" path and a misleading confirm
- **Severity:** HIGH
- **File:** `src/app/downloads/page.tsx:479-484` (`TorrentRow.handleDelete`), `:681-684`
  (`handleDelete`/`handleBulkDelete` → `deleteTorrents([...], false)`)
- **What's wrong:** The live page (`page.tsx` — the file actually rendered at `/downloads`; the
  component-split `TorrentRow.tsx` is not imported anywhere) hardcodes `deleteFiles=false` for both
  single and bulk delete. Its per-row confirm reads: *"Click OK to delete torrent only. (Hold Shift
  to also delete files — not supported in this dialog, use the torrent manager for that.)"* — Shift
  does nothing here; there is no code path reading a modifier. So the user can never delete the
  downloaded files from this UI, and the dialog advertises a capability that doesn't exist.
- **Why it matters:** Functional gap (cannot reclaim disk from the downloads page) plus a confusing,
  inaccurate destructive-action dialog. The proxy and `useDeleteTorrents(hashes, deleteFiles)` fully
  support `deleteFiles=true`; the page just never passes it.
- **Suggested fix:** Add an explicit "Also delete files" choice to the delete confirm (a second
  `confirm`, or a small custom dialog with two buttons), and pass the real boolean. Remove the
  inaccurate "Hold Shift" sentence. The dead `TorrentRow.tsx:304-315` already shows the intended
  two-step pattern.

---

## MEDIUM

### A7-06 — `/api/torznab/search` is an unauthenticated, server-side fan-out to all indexers
- **Severity:** MEDIUM
- **File:** `src/app/api/torznab/search/route.ts:11-35` (no `requireAuth`); contrast
  `src/app/api/torrent-search/route.ts:32` which does `await requireAuth()`
- **What's wrong:** The route header comments "No session auth — callers are server-side scheduled
  jobs," but it is a normal HTTP route reachable by any browser/client. `proxy.ts` would redirect a
  cookieless browser navigation, but a direct `fetch`/curl with any present `unified-session` cookie
  value (never validated at the edge) reaches it, and it calls `searchAllIndexers(...)`
  (`src/lib/indexer/index.ts:204`) which fans out outbound HTTP to every configured indexer.
- **Why it matters:** Unauthenticated request amplification / abuse: an attacker can drive
  unbounded outbound indexer queries (rate-limit burn, potential IP bans on private trackers) through
  one open endpoint. It also leaks indexer result metadata. Internal-only intent should be enforced,
  not assumed.
- **Suggested fix:** Add `await requireAuth()` (and rate-limit), or restrict it to in-process callers
  (it's invoked server-side already — call `searchAllIndexers` directly instead of via HTTP), or gate
  behind a shared secret header for the scheduler.

### A7-07 — `/api/media/match-torrent` is dead/unwired and unbounded `LIKE` scan
- **Severity:** MEDIUM
- **File:** `src/app/api/media/match-torrent/route.ts:15-38`
- **What's wrong:** No caller exists anywhere in `src` (grep for `match-torrent` returns only the
  route file). It is auth-gated (good) but performs `... WHERE LOWER(title) LIKE LOWER('%' || ? || '%')`
  on `media_items` with a user-supplied, loosely-cleaned name. The "Download-to-browse linking"
  feature it presumably backs is listed as backlog in CLAUDE.md §13, so this endpoint is shipped but
  unused.
- **Why it matters:** Dead surface area that still executes a full-table leading-wildcard `LIKE`
  (non-indexable) per call. Low blast radius today, but it's reachable and unbounded.
- **Suggested fix:** Either wire it into the downloads UI as intended or remove it. If kept, cap input
  length and consider a more selective match than a leading `%`.

### A7-08 — Entire component-split downloads UI is dead code
- **Severity:** MEDIUM
- **File:** `src/app/downloads/components/TorrentRow.tsx`, `DetailPanel.tsx`, `FilterSidebar.tsx`,
  `AddTorrentModal.tsx` (none imported — grep for `downloads/components/...` and `from './components/`
  finds no importer; `page.tsx:1-11` documents it uses its own inline implementation)
- **What's wrong:** `page.tsx` is "an older, self-contained page" with its own inline `TorrentRow`,
  add form, and no detail panel. The richer split components (context menu, 6-tab `DetailPanel`,
  per-file priority, trackers/peers, options toggles, proper delete-with-files confirm) are fully
  built but unreferenced.
- **Why it matters:** The better implementations of several behaviors flagged elsewhere (correct
  delete-with-data confirm A7-05, add-error handling A7-04) live in the dead code while the inferior
  inline versions ship. Maintenance hazard: bug fixes are likely to land in the wrong file. Also
  bloats the bundle if tree-shaking misses them (they're page-segment files under `components/`, not
  obviously imported, so likely excluded — but the divergence is the real cost).
- **Suggested fix:** Either adopt the component-split version as the page (it's strictly more capable
  and fixes A7-04/A7-05), or delete it to avoid confusion. Do not leave two divergent torrent UIs.

### A7-09 — Interactive quick grab sets `category` but never a save path; no infoHash dedup
- **Severity:** MEDIUM
- **File:** `src/app/api/requests/route.ts:159-162`
- **What's wrong:** The add sends only `{ urls, category: mediaType }` — no `savePath`. It relies on
  qBit's per-category Auto-TMM path being configured; if the `movie`/`tv` category doesn't exist or
  has no path, the torrent lands in the default save path and won't be where the importer/scanner
  expects. There is also no check that a torrent with the same `infoHash` is already in qBit (or that
  the request was already grabbed) before adding — re-submitting the same pick adds a duplicate.
- **Why it matters:** Silent mis-filing of downloads (importer can't find them) and duplicate
  torrents on repeat submits. The brief explicitly asks whether the add flow sets category/save-path
  and dedups against existing — category yes, save-path no, dedup no.
- **Suggested fix:** Resolve and pass an explicit `savePath` (from the quality profile / root path),
  or verify the category exists with a configured path first. Before adding, check existing torrents
  by `infoHash` (the abstraction would need a `getTorrents()`/exists call) and skip if present.

### A7-10 — Two parallel qBit session caches can double the login rate and confuse 403 handling
- **Severity:** MEDIUM
- **File:** `src/lib/qbittorrent/session.ts:22` (module-level `sessionCache`) and
  `src/lib/download-client/qbittorrent.ts:165` (per-instance `sessionCache`)
- **What's wrong:** Two independent SID caches exist: one powers the `/api/qbit` proxy (browser
  path), the other powers the registry client (automation/requests path). They never share a cookie.
  Each maintains its own 25-minute TTL. In normal operation that's at most two logins, but qBit's
  WebUI has `web_ui_max_auth_fail_count`/ban behavior and a session cap; under churn (e.g. server
  restart invalidates both, then both re-auth on their next call, possibly concurrently) you get
  redundant logins. The brief specifically asks about "redundant qbit logins" and whether the SID is
  "cached and reused safely across requests/users" — it is reused, but in two disjoint caches.
- **Why it matters:** Redundant auth round-trips and a higher chance of tripping qBit's auth-fail
  ban, plus divergent 403-retry state. Both caches are process-global so they are safe across users
  (single qBit account), but the duplication is wasteful and was likely unintended.
- **Suggested fix:** Have `download-client/qbittorrent.ts` reuse `getQbitSession()`/`qbitFetch` from
  `session.ts` (or vice-versa) so there is a single SID cache. If kept separate by design, document
  why and ensure both honor the same TTL.

### A7-11 — 403 re-auth retry does not handle a successful-status login that returns "Fails."
- **Severity:** MEDIUM
- **File:** `src/lib/qbittorrent/session.ts:84-106` and `src/lib/download-client/qbittorrent.ts:240-261`
- **What's wrong:** The 403 path calls `clearSession()` then `getQbitSession()` → `login()`. `login()`
  guards wrong credentials by checking the *body* for `"Fails."` (session.ts:39-42), but only when
  the login response is `res.ok`. If qBit returns 403 on the action, re-login succeeds with a new SID,
  and the retried request *also* 403s (e.g. clock skew, host-header validation, or genuinely revoked
  perms), the retry throws a generic `qBittorrent <method> <path>: 403`. There's no detection of an
  auth *loop*, and `clearSession()` is not called after a failed retry, so the just-acquired (and
  apparently useless) SID stays cached for 25 min, making every subsequent call 403 → re-login →
  403 until TTL.
- **Why it matters:** A persistent 403 condition (misconfig, host-header validation, reverse-proxy
  list) degrades into a login storm capped only by the 25-minute TTL, and the cached-but-broken SID
  blocks recovery. Single-retry is otherwise correct.
- **Suggested fix:** On a failed retry, call `clearSession()` before throwing so the next request
  re-authenticates cleanly. Optionally treat repeated 403-after-fresh-login as a hard auth error and
  surface it distinctly.

### A7-12 — `DetailPanel` Files/Trackers/Peers actions ignore failures and poll while hidden
- **Severity:** MEDIUM
- **File:** `src/app/downloads/components/DetailPanel.tsx:35-41` (`qbitPost` no `res.ok`), per-tab
  `useQuery` with `refetchInterval: 5000` (`:63-67`, `:260-264`, `:297-301`)
- **What's wrong:** (Applies if the split UI is ever adopted — see A7-08.) `qbitPost` for
  filePrio/addTrackers/removeTrackers/banPeers/limits/toggles never checks the response, so a failed
  mutation silently no-ops (only the follow-up invalidate hints at it). The Overview/Files/Trackers
  tabs each set `refetchInterval: 5000` and React Query keeps these intervals running as long as the
  component is mounted; the panel stays mounted (just translated off-screen) on large screens, so all
  three poll continuously even when not visible. (Peers correctly uses `staleTime: Infinity` + manual
  refresh.)
- **Why it matters:** Invisible failures for destructive/important actions (e.g. banning a peer,
  removing a tracker) and continuous background polling of three endpoints per open torrent.
- **Suggested fix:** Check `res.ok` in `qbitPost` and surface errors; gate `refetchInterval` on the
  active tab (`enabled: activeTab === 'overview'`, etc.) or on panel visibility.

---

## LOW

### A7-13 — `useMainData` polls at a fixed 2s with no background-tab throttle
- **Severity:** LOW
- **File:** `src/lib/qbittorrent/hooks.ts:90-96`
- **What's wrong:** `setInterval(poll, 2000)` runs regardless of tab visibility. The delta payload is
  small (good — rid threading keeps it minimal), and cleanup on unmount is correct, but there is no
  `document.visibilitychange` pause and no respect for the user's configurable `refreshInterval`
  (`TorrentUIPreferences.refreshInterval` exists in `src/types/torrent.ts:391` but the live page
  ignores it). The page also keeps a 60-sample speed-history `setState` on every poll
  (`page.tsx:603-612`) and re-derives all four tab counts inline on every render (`page.tsx:707-721`).
- **Why it matters:** A backgrounded `/downloads` tab keeps hitting qBit every 2s indefinitely; minor
  battery/network/qBit load. Re-deriving tab counts each render is cheap but redundant.
- **Suggested fix:** Pause polling when `document.hidden`, honor `refreshInterval`, and memoize the
  per-tab counts (compute once into a map).

### A7-14 — `getTransferInfo()` (abstraction) and `pollMaindata()` are unused; one returns wrong free-space on delta
- **Severity:** LOW
- **File:** `src/lib/download-client/qbittorrent.ts:281-309`
- **What's wrong:** The abstraction's `getTransferInfo`/`pollMaindata` aren't reached by the UI (the
  UI uses `useMainData` against the proxy). `normaliseServerState` only emits keys present in the
  delta, so on an incremental `maindata` the `serverState` partial omits unchanged fields — correct
  for merging, but any consumer that reads `result.serverState.freeSpace` directly on a delta gets
  `undefined`. No current consumer does, so impact is latent.
- **Why it matters:** Latent correctness trap for future server-side consumers of the abstraction's
  poll path; also dead-ish methods.
- **Suggested fix:** Document that `pollMaindata().serverState` is a delta (merge against prior), or
  have the abstraction maintain its own merged state if a server-side consumer is added.

### A7-15 — `TorrentPickModal` re-runs the indexer search on every season/episode dropdown change
- **Severity:** LOW
- **File:** `src/components/media/TorrentPickModal.tsx:209-248`
- **What's wrong:** `handleSeasonChange`/`handleEpisodeChange` each call `runSearch(q)` synchronously
  on every selection; there's no debounce and no abort of an in-flight search. Rapid dropdown changes
  fire overlapping `/api/torrent-search` calls (each a full multi-indexer fan-out), and a slower
  earlier response can land after a newer one and overwrite `results` (last-write-wins by arrival,
  not by request order).
- **Why it matters:** Wasted indexer queries and a possible stale result set if responses arrive out
  of order.
- **Suggested fix:** Abort the previous search (AbortController) or tag requests and ignore
  out-of-order responses; optionally debounce dropdown-driven searches.

### A7-16 — `addTorrent` payload type omits skip-check/auto-TMM that the UI sends
- **Severity:** LOW
- **File:** `src/lib/download-client/types.ts:54-60` (`AddTorrentPayload`) and
  `src/app/downloads/components/AddTorrentModal.tsx:100-101,112-113`
- **What's wrong:** The modal sends `skip_checking` and `useAutoTMM` as raw form fields straight to
  the proxy (bypassing the typed `AddTorrentPayload`), so the abstraction's `addTorrent` can't express
  them. `AddTorrentPayload` also lacks `sequentialDownload`/`firstLastPiecePrio` that
  `lib/qbittorrent/api.ts:101-117` supports. Two different "add" shapes exist
  (`AddTorrentPayload` vs `AddTorrentParams`).
- **Why it matters:** The abstraction is not a faithful superset of what callers actually use; a
  server-side caller can't request the same add options the browser can. Minor contract drift.
- **Suggested fix:** Unify on one add-params type and extend it with the fields the UI already sends.

### A7-17 — `normalisePartialTorrent` can emit `hash`/`name` as `''` on a sparse delta
- **Severity:** LOW
- **File:** `src/lib/download-client/qbittorrent.ts:110-125` (`normaliseTorrent`) vs `:129-144`
  (`normalisePartialTorrent`)
- **What's wrong:** `normaliseTorrent` coerces missing `hash`/`name` to `''`. A torrent in a full
  update with (improbably) no hash would get an empty-string key. More practically, the proxy-fed
  `useMainData` path merges raw qBit partials directly (`hooks.ts:48-55`) and never normalizes
  numeric/undefined fields, so the two poll paths normalize differently (abstraction normalizes;
  proxy/UI does not). Behavior differs silently between the server-side abstraction and the
  browser hook.
- **Why it matters:** Divergent normalization between the two poll implementations; a field the
  abstraction defaults (e.g. `eta: -1`) is left raw in the UI path. Mostly cosmetic given the UI
  formats defensively, but it's an inconsistency the brief asked to flag.
- **Suggested fix:** Pick one normalization layer. Since the UI path is the live one, ensure its
  formatters tolerate `undefined` (they mostly do) or run partials through a shared normalizer.

### A7-18 — Delete confirms use native `window.confirm`; bulk delete lacks file-vs-no-file choice
- **Severity:** LOW
- **File:** `src/app/downloads/page.tsx:696-701` (`handleBulkDelete`), `:479-484`
- **What's wrong:** Destructive deletes rely on `window.confirm` (blockable, unstyled, no
  "delete files?" sub-choice for bulk). The bulk path confirms a count then always deletes with
  `deleteFiles=false`. The dead `TorrentRow.tsx`/`AddTorrentModal` use a `prefs.confirmDelete` /
  `prefs.confirmDeleteFiles` two-stage flow that's strictly better.
- **Why it matters:** Inconsistent destructive-action UX; no styled confirmation; bulk delete can't
  remove files.
- **Suggested fix:** Use a styled confirm dialog with an explicit "also delete files" toggle for both
  single and bulk delete; respect `TorrentUIPreferences.confirmDelete*`.

---

## Notes on things that are correct (to avoid re-flagging)

- SID handling keeps qBit credentials server-side; browser never sees them (`session.ts`, proxy).
- v4/v5 cookie name regex `((?:QBT_SID_\d+|SID)=[^;]+)` and stop/start endpoint renames handled
  (`session.ts:46`, `api.ts:64-79`, `download-client/qbittorrent.ts:199,337,345`).
- Multipart `.torrent` passthrough with boundary + query-string preservation on POST is correct
  (`api/qbit/[...path]/route.ts:41-83`), matching the documented fix.
- `useMainData` delta merge is sound: rid threading, in-place map mutation, full-update reset on
  error, single interval with cleanup (`hooks.ts:34-96`).
- The interactive add goes through the server-side abstraction (`getClient().addTorrent`), not the
  browser proxy, so that specific add is auth-gated by `/api/requests` (`requireAuth` there) — the
  A7-01 gap is about the *proxy*, which the live `/downloads` UI uses for everything else.
