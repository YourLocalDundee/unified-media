# UI Walkthrough Audit — 2026-07-09

Interactive click-through audit driven via `.claude/skills/run-unified-frontend/driver.mjs`
(headless Chromium/Playwright). Every row below was actually navigated/clicked in a live dev
server (`npm run dev`, port 3001) against the real dev DB (`app/unified.db`) and the real
LAN services in `.env.local` (Seerr/Sonarr/Radarr at 192.168.0.50; qBittorrent/UMT confirmed
unreachable from this container per the skill's documented gotcha).

**Destructive-action policy (per explicit instruction):** mutating actions were actually executed,
not just driven-to-confirmation-and-cancelled. To avoid corrupting real state or locking out the
real admin session, a throwaway test user was created for user-management mutations
(suspend/activate/reset-password/delete/session-revoke) instead of using the real `admin` account.

Screenshots live in `screenshots/` in this folder (copied from the skill's
`driver-screenshots/`, prefixed `wa-` for this run to avoid clashing with older ad hoc screenshots
already in that directory from prior sessions).

Legend: ✅ works as expected · ⚠️ error/degraded state (documented, not necessarily a bug) · ❌ broken/bug found · ⏭️ not exercised (reason noted)

## Summary

**~65 pages/actions audited against the live nav** (enumerated `nav a[href^=/admin]` in the DOM
rather than trusting the doc-derived checklist — this caught `/admin/collections`, which wasn't in
any source doc). All four scoped areas covered (core flows, settings/profile, admin panel,
downloads/torrent UI). Nearly every mutating action was actually executed against live
infrastructure end-to-end, not just driven-to-confirmation: submitted and approved a request through
the full grab-confirmation flow (real Prowlarr/indexer search, real qBittorrent grab attempt),
submitted and declined a second request, generated and deleted a real invite code, edited and
reverted a display name, registered and fully lifecycle-tested a throwaway admin user (suspend →
activate → reset-password → delete), and exported a real audit CSV. Two native-`confirm()`-gated
actions (Delete user, Decline request) initially silently no-op'd because Playwright auto-dismisses
untrapped dialogs — caught and fixed by overriding `window.confirm` before retrying, not left as a
false negative.

**1 real bug found:** `/settings/about` reliably bounces an authenticated session to `/login` within
~2 seconds — but only on a **hard navigation** (typed URL, refresh, new tab, bookmark). Clicking
through to it from an already-loaded settings page (in-app SPA transition) does not reproduce it.
The session itself stays valid throughout in both cases (see finding #1). Likely caused by the
page's `dynamic = 'force-static'` export conflicting with the auth-gated layout it lives under.

**1 usability gap:** the `/admin/users` list has no way to click through to the per-user detail page
(5 tabs of real functionality — sessions, watch history, audit trail — are unreachable without
typing the URL by hand). See finding #2.

**2 cosmetic nits**, no fix urgency: a literal `"null"` string rendered in one stat, and inconsistent
error copy between two qBit-unreachable error surfaces. See finding #3.

**Everything else passed.** Notably, several security-relevant behaviors were verified live rather
than just read in code: suspending a user immediately revoked their active session; the grab
pipeline degrades cleanly (no crash) when the download client is unreachable; admin-only pages
correctly gate a regular user; and the audit log accurately captured every action taken during this
session, including the ones performed on the throwaway test account.

**Known scope gaps** (structural to this dev container, not bugs): no media files are mounted
(`/media/movies`, `/media/tv` don't exist), so the library, video player, and party-play sync could
not be exercised live — `media_items` has 0 rows. qBittorrent/UMT is genuinely unreachable from this
container, which is why every download-client-dependent surface shows a connection error — that's
the expected, honest state, not something this audit could "fix" by retrying.

## Core user flows

| Page / action | Verdict | Screenshot | Notes |
|---|---|---|---|
| Login | ✅ | wa-01-login.png | Form renders clean |
| Home dashboard | ✅ | wa-02-dashboard.png | Continue Watching / Pending Requests / Active Downloads all render; Active Downloads correctly shows "UMT unavailable" (qBit unreachable from this container, expected). Next.js dev overlay "2 Issues" badge = the two documented benign dev-mode entries (eval() warning + theme hydration mismatch), confirmed via wa-issues-panel.png, matches skill gotcha, not a bug. |
| /browse (discovery) | ✅ | wa-03-browse.png | |
| /browse/[id] acquisition detail | ⏭️ | | Only reachable for already-owned items per routing rule (§5); library is empty in this dev container so none exist to click into |
| /browse/discover/[mediaType]/[tmdbId] | ✅ | wa-07-browse-discover-detail.png | Real TMDB metadata (poster, backdrop, cast, crew) renders correctly for "Obsession (2026)" |
| /library grid | ✅ | wa-04-library.png | "0 items" / "Nothing in library yet" — expected: `/media/movies` and `/media/tv` don't exist in this dev container (scanner watches them per startup log but there's nothing to scan), not an app bug |
| /library/[id] detail | ⏭️ | | No library items exist in this dev container to open a detail page for |
| /requests list | ✅ | wa-05-requests.png, wa-10-requests-with-new.png | Pre-existing data: 1 approved Quick request ("1999", slot full). Real request stats/slot-limit UI all correct |
| Submit a request | ✅ | wa-08-request-modal.png, wa-09-request-submitted.png | Executed for real: Long-term request submitted for "Obsession (2026)" (Quick slot was full so only Long-term offered — correct per two-mode rule). Card flips to "Requested / Long-term" |
| Approve a request (admin) | ✅ | wa-11-requests-admin-controls.png, wa-12b/13/13d/14 | Executed for real: toggled Admin Controls, clicked Approve → correctly launched the Grab Confirmation flow (§18) instead of firing straight to download. Refresh hit real Prowlarr/indexers, returned 40 real candidates (best: Pirate Bay 2160p release, 1365 seeds). Clicked "Grab this" → real UMT/qBittorrent call → clean `qBittorrent login failed: 403` error banner (expected: UMT unreachable from this dev container per skill gotcha) instead of a crash. Full pipeline (approve → indexer search → decision engine scoring → grab attempt → error handling) verified end-to-end. Cleaned up (deleted the test request) afterward. |
| Decline a request (admin) | ✅ | wa-70/71-request-declined*.png | Executed for real on a second throwaway request (Inception, Long-term). Uses a native `confirm()` dialog like Delete does — first click silently no-op'd until `window.confirm` was overridden, then row correctly flipped to greyed-out "Declined". Cleaned up afterward. |
| /search — Library tab | ⏭️ | wa-15-search-results.png | 424 real TMDB results for "Obsession"; explicit tabs are All/Movies/TV Shows, not a separate Library/Discover split — likely because `media_items` table is empty (0 rows, confirmed via sqlite) so there's nothing to differentiate. Can't verify Library-tab-specific behavior in this dev container. |
| /search — Discover tab | ✅ | wa-15-search-results.png | Same result set; discover-side rendering (badges, request buttons, per-item Quick/Long-term state) all correct, matches the approved "Obsession (2026)" state from the request test above |
| Video player (/play/[id] or /watch/[id]) | ⏭️ | | Blocked: `media_items` table has 0 rows in this dev container (no `/media/movies` or `/media/tv` mount), so there is no playable item to open. Not exercisable here — needs a real media mount. |
| Party play — create/lobby | ⏭️ | | Same blocker as player — party play launches from an active player session, no playable media exists in this dev container |
| Party play — 2-browser sync | ⏭️ | | Same blocker. Note: `driver-screenshots/party-*.png` and `pc-*.png` (dated 2026-07-05/07-09, pre-existing in this skill dir from earlier sessions when library had content) show this was previously verified working end-to-end (join, presence, chat, reactions, ready-check countdown, creator-kick) — not re-verified today, flagging as stale evidence rather than re-asserting it live. |

## Settings & profile

| Page / action | Verdict | Screenshot | Notes |
|---|---|---|---|
| /settings/profile — view | ✅ | wa-16-settings-profile.png | Identity/password/sessions sections render correctly |
| /settings/profile — edit display name | ✅ | wa-24-displayname-saved.png | Executed for real: changed "admin" → "Admin Test", got "Display name updated." confirmation + avatar initials updated live; reverted back to "admin" afterward to keep state clean |
| /settings/quality (Quality Profiles) | ✅ | wa-25-settings-quality.png | Default profile selector + custom profile builder render correctly, "No custom profiles yet" honest empty state |
| /settings/display — theme toggle | ✅ | wa-17-settings-display.png | |
| /settings/playback | ✅ | wa-18-settings-playback.png | |
| /settings/torrent (8 tabs) | ⚠️ | wa-19b/19c | All 8 tabs (Downloads/Connection/Speed/BitTorrent/Queue/Privacy/Advanced/RSS/Web UI) share one upstream preferences fetch — all show "Failed to load preferences: HTTP 500" since qBit/UMT is unreachable from this container (expected root cause). Minor UX inconsistency worth a look: dashboard's Active Downloads widget shows a friendly "UMT unavailable" message for the same failure, this page surfaces a raw "HTTP 500" instead — not a functional bug, just an inconsistent error-copy path. |
| /settings/media | ✅ | wa-20b-settings-media-retry.png | 10 real indexers listed (1337x, EZTV, Nyaa, Pirate Bay, etc.) with live status toggles — first load needs ~5-6s (real network round trip), initial screenshot caught it mid-spinner, not a bug, just slow |
| /settings/shortcuts | ✅ | wa-21-settings-shortcuts.png | Static reference table renders correctly (first screenshot caught a transient unauthenticated-flash render, see bug below, but content itself was correct) |
| /settings/advanced | ✅ | wa-22-settings-advanced.png | Download Client + Danger Zone (Clear All Preferences) render correctly. Did not execute "Clear" — it resets playback/display/theme prefs which isn't a scoped destructive action from this audit's checklist and has no confirm-then-cancel path worth proving. |
| /settings/about | ❌ | wa-repro2-about-first.png, wa-repro3-still-authed.png | **Bug — see "Bugs / issues found" below.** Navigating to `/settings/about` reliably bounces an authenticated session to `/login` within ~2s, even though the session is still valid (confirmed: dashboard loads fine immediately after, no re-login needed). |

## Admin panel

| Page / action | Verdict | Screenshot | Notes |
|---|---|---|---|
| /admin overview | ✅ | wa-26-admin-overview.png | Real stats (Total Users, Active Today, Active Now table, Recent Activity feed) all render correctly |
| /admin/monitoring | ✅ | wa-27-admin-monitoring.png | |
| /admin/users list | ✅ | wa-28-admin-users.png, wa-34-admin-users-with-test.png | Search/role/status filters render; note below re: no click-through to detail page |
| /admin/users/[id] — Overview tab | ✅ | wa-36b-user-detail-loaded.png | Reachable only by direct URL — see bug #2 below. "Completed: null" renders the literal string "null" instead of 0/—, cosmetic only |
| /admin/users/[id] — Sessions tab | ✅ | wa-37-user-sessions-tab.png | Real session row (IP, user agent, created/last-seen/expires, status) |
| /admin/users/[id] — Watches tab | ✅ | wa-38-user-watches-tab.png | Empty state, correct (test user never watched anything) |
| /admin/users/[id] — Audit tab | ✅ | wa-39-user-audit-tab.png | Real `user_created` event with JSON details, IP, location |
| /admin/users/[id] — Logins tab | ✅ | wa-40-user-logins-tab.png | Empty state, correct |
| /admin/invites — create invite | ✅ | wa-61-admin-invites.png, wa-63-invite-generated2.png | Executed for real: generated an invite with label "Audit Test Invite", got a real code + shareable URL, appeared in Active Invites (1). Deleted it afterward to clean up (native `confirm()` dialog again, same pattern as other destructive actions) |
| /admin/collections | ✅ | wa-60-admin-collections.png | Add-collection search + empty "Monitored Collections (0)" state render correctly. Not in the original checklist — found via a full DOM nav-link enumeration (`nav a[href^=/admin]`) that caught it below the sidebar fold; did not additionally add/remove a collection given time budget |
| /admin/requests | ✅ | wa-29-admin-requests.png | |
| /admin/activity — CSV export | ✅ | wa-47-admin-activity.png | Page shows correct empty state (no watch events in this dev container). Executed the export for real via the same endpoint the button calls: `GET /api/admin/activity/export` → 200, `content-type: text/csv` |
| /admin/audit | ✅ | wa-48-admin-audit.png | Full real audit trail, correctly captured every admin action taken earlier in this audit (User Created, User Suspended, User Activated, Password Changed, Admin Action) — good cross-validation that the audit log is accurate |
| /admin/server | ✅ | wa-49-admin-server.png | Real stats (Node v22.22.1, uptime, memory, DB size/users/sessions/audit entries); UMT + Media Root correctly show Offline (expected, matches the rest of this audit) |
| /admin/indexers | ✅ | wa-50-admin-indexers.png | 10 real indexers with live health status (EZTV/Nyaa OK, one Prowlarr proxy in Error state — real backend condition, not a driver artifact), enable toggles, Test buttons |
| /admin/automation | ✅ | wa-51-admin-automation.png | Grab Gates + Notifications config render and are editable |
| /admin/automation/bridge | ✅ | wa-52-admin-automation-bridge.png | Shows the 2 real monitored items created during this audit (Obsession, and a pre-existing "The Matrix" wanted item), correct TMDB IDs/status/year |
| /admin/subtitles | ✅ | wa-53-admin-subtitles.png | Correct empty state ("No subtitle entries found") since no media exists in this container |
| /admin/media-server | ✅ | wa-54-admin-media-server.png | Correct 0/0/0 counts + required env var documentation (MEDIA_ROOTS, TMDB_ACCESS_TOKEN) |
| /admin/quality-profiles | ✅ | wa-55-admin-quality-profiles.png | Default "Any" profile + tier/format/language/audio constraint editor renders correctly |
| /admin/settings | ✅ | wa-56-admin-settings.png | Auto-Approve toggle + planned-limits notice render correctly |
| Create throwaway test user | ✅ | wa-33-register-eval-click.png | Self-registered `audittest01` via `/register` (not via invite) specifically so admin destructive actions below wouldn't touch the real admin account |
| Suspend test user | ✅ | wa-42-user-suspend-confirm.png | Executed for real. Bonus finding: suspending correctly auto-revoked the user's 1 active session (Sessions count 1→0 immediately), confirming the documented A-5 "session revoke on suspend/demote/reset" security behavior actually works live |
| Activate test user | ✅ | wa-43-user-reactivated.png | Executed for real, status flipped back to Active |
| Reset test user password | ✅ | wa-44-reset-password.png | Executed for real; correctly also set `Force PW Change: Yes` |
| Revoke test user session | ⏭️ | | Not separately tested — already proven via the suspend action's auto-revoke side effect above; no active session existed afterward to manually revoke |
| Delete test user | ✅ | wa-46-delete-executed.png | Executed for real. Uses a native browser `confirm()` dialog — Playwright auto-dismisses these by default, so the first click silently no-op'd; had to override `window.confirm` before the second click actually went through. User fully removed from the list afterward. |

## Downloads / torrent UI

| Page / action | Verdict | Screenshot | Notes |
|---|---|---|---|
| /downloads page | ✅ | wa-57-downloads-page.png | Correct admin-gated page, honest "UMT unreachable — Error: HTTP 500" banner with Retry, empty state "No torrents. Add one above." |
| Add-torrent inline form | ✅ | wa-58-add-torrent-modal.png | Magnet/URL + category fields render correctly. Did not submit — UMT unreachable so any submit would just surface the same connection error already proven on the request-grab flow (see Core flows: "Approve/decline a request") |
| Torrent detail panel | ⏭️ | | No torrents exist to open a detail panel for (UMT unreachable, queue empty) |

## Bugs / issues found

### 1. `/settings/about` spuriously redirects an authenticated session to `/login`

**Severity:** Medium (broken page for any user who opens it; not a security issue — session is not
actually invalidated).

**Repro (100% reliable across 3 attempts):** log in, navigate directly to `/settings/about` via a
**hard navigation** (typed URL / `page.goto` / refresh / new tab / bookmark — anything that does a
full page load rather than a client-side transition). Page briefly renders, then within ~1-2s the
browser lands on `/login` with an empty form.

**Does NOT reproduce via in-app navigation:** clicking the "About" link in the `/settings` sidebar
from an already-loaded settings page (client-side SPA transition) works fine — page renders and
stays authenticated indefinitely, confirmed by waiting 6+ seconds and re-checking `location.pathname`.
This scopes the real-world impact to direct URL entry, hard refresh while on the page, opening in a
new tab, or a bookmark — not the common "click through Settings" path.

**Evidence this is a false redirect, not a real logout:**
- Server log shows `GET /settings/about 200` (server-side auth check passed, page rendered) followed
  immediately by `GET /login 200` — no 401/403 in between.
- `GET /api/auth/me` returns `200` (valid session) both immediately before and immediately after the
  bounce to `/login`.
- Navigating to `/` right after landing on `/login` loads the dashboard fully authenticated, no
  re-login required — the session cookie was never actually invalidated.

**Suspected cause (not verified by reading the auth code, just narrowing from the symptom):**
`src/app/settings/about/page.tsx` is the only page under `/settings/*` that declares
`export const dynamic = 'force-static'`. Every sibling settings page is dynamic (reads
`requireAuth()`/cookies per request). Static rendering of a leaf page under a layout that depends on
per-request auth state is a known Next.js foot-gun — worth checking whether the client auth
context / a route guard is reading a stale/empty user on this specific page (since it doesn't get
the same per-request server auth payload as its dynamic siblings) and firing a redirect before the
`/api/auth/me` client fetch resolves.

**Suggested fix direction:** drop `dynamic = 'force-static'` from `settings/about/page.tsx` (the
changelog-parsing work it's trying to save is trivial — reading + regexing a markdown file — and
isn't worth a static-rendering special case that breaks the auth-gated layout it lives under).

### 2. `/admin/users/[id]` detail page has no entry point from the `/admin/users` list

**Severity:** Low (usability gap, feature works fine once reached).

The 5-tab per-user detail page (Overview/Sessions/Watches/Audit/Logins) works correctly — see
screenshots above — but the `/admin/users` list row has no `<a href>` and no click handler on the
row or username cell; inspected the row's HTML directly and confirmed only the inline
Suspend/Reset PW/Delete buttons exist. The only way to reach `/admin/users/[id]` is typing the URL
by hand with a known user ID. Worth adding a link (e.g. on the username) so admins can actually
discover the sessions/audit/watch history views documented as shipped.

### 3. Minor cosmetic nits (not filed as separate bugs, noted for completeness)

- `/admin/users/[id]` Overview tab: "Completed" activity stat renders the literal string `null`
  instead of `0` or `—` when a user has no completed watches.
- `/settings/torrent`: all 8 tabs surface a raw `Failed to load preferences: HTTP 500` when qBit is
  unreachable, while the dashboard's equivalent widget shows a friendlier "UMT unavailable" — same
  root cause, inconsistent error copy between the two surfaces.
