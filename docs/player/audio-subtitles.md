# Video Player — Audio & Subtitle Tracks, Language Defaults (v0.9.4)

Codec knowledge is centralised in `src/lib/media-server/codecs.ts` (client-safe, type-only imports).
`PlaybackData.audioStreams`/`subtitleStreams` carry `codec`, audio `relIndex`, and subtitle
`forced`/`extractable`, threaded from `probe.ts` through `playback.ts`.

## Embedded subtitle extraction → WebVTT

A plain `<video>` does **not** render embedded MKV subtitle streams on Direct Play. The old
`/api/media/subtitles/[id]/[streamIndex]` route only serves *downloaded external* files
(`subtitle_wants`) and treats its index as a position in that list — so embedded `<track>`s pointed at
it rendered nothing.

Embedded tracks now point at **`/api/media/subtitles/embedded/[id]/[streamIndex]`** (`streamIndex` =
absolute ffprobe stream index). It probes, rejects image-based codecs (`isImageSubtitleCodec` →
PGS/VOBSUB/DVB) with **415** (they need burn-in, not conversion), then `extractSubtitleToVtt()` runs
`ffmpeg -map 0:<idx> -c:s webvtt -f webvtt` and caches the `.vtt` under
`TRANSCODE_CACHE/.subs/<mediaId>/<idx>.vtt`. Text codecs (ass, subrip, mov_text) convert cleanly; ASS
styling/positioning is flattened. The player renders one `<track>` per stream (index-aligned with
`activeSubIndex` and the video's `textTracks`); image tracks are shown disabled. No `default` attr —
visibility is driven solely by `activeSubIndex` so multi-default files don't auto-show the wrong track.

## Audio track selection & switching (option B — restart-and-seek)

Browsers can't switch embedded audio tracks on Direct Play, so switching routes through HLS with the
chosen track mapped (`-map 0:a:<relIndex>`). HLS URLs are namespaced by audio index:
**`/api/media/hls/[id]/a[N]/master.m3u8`** (segments resolve relatively under `aN/`); the transcode
cache and job registry are keyed per `(mediaId, audioIdx)` (`TRANSCODE_CACHE/<mediaId>/a<idx>/`).

On switch, the player captures `video.currentTime` into `pendingSeekRef`, swaps the source, and
`handleLoadedMetadata` consumes the ref to resume at that exact position. This is **option B**: it
reuses the player's single position path (`currentTime` / resume / progress / `position_ticks`) — no
timestamp offset / parallel position system — so watch-progress and continue-watching stay correct.
Selecting the server's default track reverts to the original Direct-Play-or-HLS decision.

**Per-path switch cost:** h264 source → cheap remux (`-c:v copy` + audio→aac); hevc/vp9/av1 source →
Tier C full VAAPI (video must be re-encoded for HLS-TS). Full VAAPI is reserved for incompatible video.

**v1 seek limitation (still applies):** transcodes are linear-from-0; seeking past the transcoded point
returns 503 (seek backwards to resume). A switch resumes at the captured position by letting the linear
transcode reach it.

**FUTURE (option A, deferred):** start the per-audio transcode at the current position via input-seek
(`-ss T`, already supported by `buildArgs` `seekSec`) for an instant switch. Deferred deliberately — it
requires a stream-start time offset that would fork position tracking away from the single 0-based
timeline the watch-progress feature depends on. Documented at the top of `transcode.ts`.

## Language defaults (English) — `usePlaybackPrefs`

The user preference (`/settings/playback` → `usePlaybackPrefs`, localStorage `unified-playback-prefs`):
`audioLang` (default `'en'`), `subtitleLang` (default `''` = off). The player reads it.
`usePlaybackPrefs` exposes a `ready` flag so the one-time default applies on the *hydrated* value, not
the pre-hydration default. `selectPreferredAudioRel` picks the matching audio track (else server
default); `selectPreferredSubtitleIndex` picks the matching subtitle **preferring the full track over
signs-and-songs / forced**, returning -1 (off) when no subtitle language is set. ffprobe 3-letter codes
are normalised to ISO 639-1 via `normalizeLang`/`languageMatches`.

## On-demand subtitle search + live `<track>` injection (v0.9.11)

The background subtitle system (Phase 4) writes `subtitle_wants` rows from a nightly scan + a download
pass; `getNativePlaybackData` reads `status='downloaded'` rows into `downloadedSubtitles`, rendered as
`<track>`s at page-load. v0.9.11 adds the **mid-playback** path so a viewer can fetch a subtitle that
doesn't exist yet, without a reload.

Player surface: `SubtitleSearchPanel` (`src/components/player/SubtitleSearchPanel.tsx`), opened from
the subtitle menu's "Search online…" entry. The captions button renders even when a title has **zero**
tracks (gated on `subtitleApiBase`) so search is reachable when there's nothing to toggle.

Routes (under `subtitleApiBase` = `/api/media/subtitles`):

| Route | Auth | Role |
| ----- | ---- | ---- |
| `GET …/search?mediaId=&language=&hi=` | `requireAuth` | Resolves the item's IMDB id **server-side**, queries OpenSubtitles, returns trimmed candidates. **Episodes (v0.10.2)** search by **series** IMDB id + `season_number`/`episode_number` (parent row via `series_id`), falling back to the episode's own imdb, then a series-title query. Movies use item imdb + title-query fallback. Does **not** spend the daily download quota. |
| `POST …/grab` | `requireAuth` + `verifyOrigin`, 10/hr/user | Downloads the picked file, `upsertSubtitleWant` (heals an existing `wanted`/`skipped`/`failed` row via the `(item,lang,forced,hi)` UNIQUE index), writes the `.srt` next to the media with markers, sets `status='downloaded'`. Returns stable `wantId` + remaining quota; OpenSubtitles 406 → "daily limit reached". |
| `GET …/want/[wantId]` | `requireAuth` | Serves a downloaded sub by immutable `subtitle_wants.id` as WebVTT. |

**Why a by-id serving route.** The pre-existing `…/{id}/{index}` route keys by *positional* index into
the ordered downloaded query. Adding a sub can reorder that query, shifting an already-rendered track's
URL — fine at page-load (list rebuilt) but wrong for a live-injected track. So session grabs are served
by immutable row id. In `VideoPlayer`, session grabs live in `extraTracks` state, appended **after**
the server-provided embedded + downloaded tracks
(`subtitleTracks = [...embedded, ...downloaded, ...extra]`), so existing indices and `activeSubIndex`
never shift; `handleSubtitleAdded` selects the new track by its appended index. `srtToVtt` is shared
from `src/lib/subtitle/vtt.ts`. Requires `OPENSUBTITLES_API_KEY` + `SUBTITLE_MEDIA_ROOT` (grab returns
503 if either is unset). Any authenticated viewer can search/grab; the OpenSubtitles daily quota is
shared, so grab is rate-limited per user (20/hr) and the panel surfaces remaining count.

**OpenSubtitles auth model (two quota buckets — important).** The static `Api-Key` alone draws on a low
**anonymous ~100/day** bucket. The **VIP 1000/day** quota is only reached by logging in: the client
(`opensubtitles.ts`) does `POST /login` with `OPENSUBTITLES_USERNAME`/`PASSWORD`, caches the returned
JWT (~24h, refreshed on expiry/401) and its `base_url`, and sends it as `Authorization: Bearer` on
`/download` and `/infos/user`. Without credentials the feature still works but is capped at ~100/day (a
warning is logged). `GET /api/subtitle/account` (admin) returns the live `/infos/user` quota so a
login/auth failure can be told apart from a subscription problem — if it shows
`allowed_downloads: 1000, vip: true`, auth is fine. `VIP_DAILY_DOWNLOAD_CEILING = 1000` documents the
plan ceiling. **Bug fixed in passing:** `searchSubtitles` used to filter on `attributes.format`, which
the v3 search response leaves `undefined` for every result — silently returning zero candidates and
making the whole subtitle feature appear dead. The filter is removed; format is normalised at download
time via `sub_format: 'srt'`, and the written file is content-validated.
