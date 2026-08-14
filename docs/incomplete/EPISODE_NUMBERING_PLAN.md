# Episode numbering — plan

**Status:** planned, not started. Written 2026-08-14.

## The goal

Every show should carry **all** of its numbering systems, and the UI should display whichever one
matches the context. Concretely: long-running anime (Naruto Shippuden, One Piece, InuYasha) are
tracked by fans — and by AnimeFillerList — in **absolute** numbering that counts to 500+ with no
seasons, while TMDB files the same episodes into invented seasons. Cross-referencing a filler list
against a library that says "S12E04" is impossible today.

Secondary goal: stop the library from *lying*. Some episodes currently display the wrong title and
artwork entirely (see Pokémon below).

## What already exists

Most of the model is built. It was written for subtitle search, not display:

| Piece | Where |
| --- | --- |
| `media_items.absolute_episode_number` | `db/migrations.ts` |
| `media_items.subtitle_numbering` — per-series `season` \| `absolute` \| null(auto) | same |
| `computeAbsoluteEpisodeNumbers(seriesId)` | `subtitle/numbering.ts` |
| Auto-probe that detects which scheme a show uses | `subtitle/numbering.ts` |
| Admin override UI | `/admin/subtitles`, `PATCH /api/media/series/[id]/subtitle-numbering` |

So the per-series "which numbering does this show use" concept already exists and already works.
This plan generalises it from *subtitle lookup* to *the whole app*, and fixes the data underneath.

> Jellyfin has the same idea natively — a per-series **Display Order** of Aired / DVD / Absolute.
> Worth knowing it exists rather than rebuilding it there. Note its Absolute mode only works if the
> metadata provider supplies absolute numbers: **TheTVDB does, TMDB does not.** That is a further
> argument for TVDB as the anime metadata source on the Jellyfin side too.

## The three numbering systems

1. **TMDB aired order** (season + episode) — what metadata matching needs.
2. **True absolute** — what AnimeFillerList uses, and what fans mean by "episode 57".
3. **Release-group numbering baked into the filename** — what the scanner actually parses today,
   and it lies.

## Why the current absolute number can't be trusted

`computeAbsoluteEpisodeNumbers` orders the episodes **we own** and counts 1..N. That equals the
true absolute number only when we own a complete run from episode 1. Measured against the live DB:

| Show | Owned | Derived abs | Correct? |
| --- | --- | --- | --- |
| Naruto Shippuden | 500 / 500 | 1–500 | ✅ genuinely correct today |
| Dragon Ball Kai | 117 | 1–117 | ✅ |
| Avatar / Korra / HotD | full | 1–N | ✅ |
| Hunter x Hunter (2011) | 38 / 148 | 1–38 | ❌ meaningless for a filler lookup |
| InuYasha | 194 | only 27 numbered | ❌ 167 episodes have **no season or episode at all** |
| Pokémon | 79 | 1–79 | ❌ dub order, not TMDB order |

### The two concrete data bugs

**InuYasha — 167 unparsed episodes.** Files look like
`001 - 033/[Fullmetal] Inuyasha - 01 [1080p][HEVC 10bits].mkv`. The scanner cannot read that shape,
so `season_number` and `episode_number` are both NULL. That also silently degrades subtitle search
for those 167.

**Pokémon — wrong metadata on screen.** The release group split Kanto into their own "season 1"
(1–52) and "season 2" (53–79), and their numbering skips the banned episodes, so it drifts against
TMDB progressively rather than by a fixed offset:

| File | Real title | Currently displayed |
| --- | --- | --- |
| `036-1x36` | Pikachu's Goodbye | The Bridge Bike Gang |
| `038-1x38` | Wake Up Snorlax! | Cyber Soldier Porygon |
| `053-2x01` | Princess vs. Princess | Pallet Party Panic |

Everything from roughly episode 36 onward shows the wrong title, overview and artwork. No amount of
filename parsing fixes this one — the filename numbering is internally consistent and simply refers
to a different ordering. It needs title matching against the provider.

## Decisions taken

- **Absolute numbers come from TheTVDB's real `absolute_number` field**, not from counting what we
  own.
- **Display in the unified-media UI**, and **rename files on disk** to a canonical form so both apps
  and any future one agree instead of each re-guessing.
- **Filler data by scraping AnimeFillerList** into a local table.
- **Scanner learns more filename patterns AND files get renamed** to canonical form.

## Blockers to clear first

1. ⏳ **TVDB API key — waiting on registration.** Files are staged and ready to receive it:
   - `~/docker/secrets/tvdb.txt` (600) — canonical store, with notes on which account types need a
     PIN.
   - `~/docker/unified-media/.env` (600) — `TVDB_API_KEY=` and `TVDB_PIN=` appended empty at lines
     63–64. Backup of the pre-change file at `.env.bak-20260814`.

   Register at <https://thetvdb.com/api-information> → v4 API. The **PIN is only needed for
   user-supported (free) subscriber keys**; licensed keys leave it blank. After pasting, re-run
   `~/Downloads/copy-secrets-to-usb.sh`, then:

   ```
   docker compose -f ~/docker/unified-media/docker-compose.yml up -d unified-frontend
   ```

   `env_file` is read at container **create** time — a plain restart will not pick the values up.

2. ✅ **`tvdb_id` backfilled 2026-08-14 — all 8 series, no failures.** Pulled from TMDB
   `/tv/{id}/external_ids`; no new credential was needed.

   | Series | tmdb | tvdb |
   | --- | --- | --- |
   | Avatar The Last Airbender | 246 | 74852 |
   | Dragon Ball Kai | 61709 | 88031 |
   | House of the Dragon | 94997 | 371572 |
   | Hunter x Hunter (2011) | 46298 | 252322 |
   | InuYasha | 35610 | 71361 |
   | Legend of Korra | 33880 | 251085 |
   | Naruto Shippuden | 31910 | 79824 |
   | Pokémon | 60572 | 76703 |

   The backfill was a throwaway script run inside the container and then deleted. If it is ever
   needed again (new series arrive with NULL `tvdb_id`), it should become a proper enricher step
   rather than a one-off — the natural home is alongside the existing TMDB enrichment in
   `media-server/enricher.ts`, so new series get an id at scan time instead of needing a backfill.

   Note for whoever writes that: the script must run from `/app` inside the container. Both ESM and
   CJS resolve `node_modules` from the **script's own directory**, so a script dropped in `/tmp`
   cannot see `better-sqlite3` no matter what `--workdir` is passed.

## Phases

Ordered by dependency. Each phase leaves the app working.

### Phase 0 — prerequisites
Obtain the TVDB key; backfill `tvdb_id` for every series from TMDB `external_ids`. Verify all 8
series resolve before going further.

### Phase 1 — scanner parsing
Teach the scanner the shapes it currently fails on:
- `[Group] Show - NN [tags].mkv` (bare absolute, no season marker)
- folder-level range hints such as `001 - 033/`
- `NNN-SxEE` combined forms like `Pokemon - 019-1x19 - Title`

Success test: InuYasha's 167 orphans all acquire numbers. Unit tests per pattern, since this is
exactly the kind of parsing that regresses silently.

### Phase 2 — canonical rename
**Dry-run first — produce the full proposed mapping and review it before a single file moves.**

Rename to one canonical scheme so nothing has to re-guess later. Rules:
- Subtitles (`.srt`) move with their video.
- Every rename is logged to a file so the whole batch is reversible.
- Same-filesystem renames only, so it is instant and atomic per file.
- Pokémon specifically resolves by **title match against the provider**, not by trusting its
  filename numbers.

### Phase 3 — true absolute from TVDB
Add a TVDB v4 client (JWT auth with token caching). Populate `absolute_episode_number` from TVDB's
own field. Add a `numbering_source` column recording provenance (`tvdb` \| `derived`), and fall
back to the existing derivation only where TVDB has no absolute number — most non-anime has none,
and that is fine.

### Phase 4 — display
Generalise the per-series mode from subtitles to the whole app. Episode rows show both numbers,
e.g. `S03E12 · #57`, with the per-series setting deciding which is primary. Reuse the existing
admin override UI rather than building a second one.

### Phase 5 — filler
Scrape AnimeFillerList into a table keyed by **absolute** number:

```
anime_filler(series_id, abs_from, abs_to, kind)
kind ∈ manga_canon | mixed | filler | anime_canon
```

Surface as a badge on episode rows plus a "hide filler" filter. Refresh on a schedule. Expect the
scraper to break when their markup changes — it has no API, so treat a parse failure as "keep the
cached data and warn", never as "wipe the table".

## Risks

- **TVDB absolute numbers are sparse outside anime.** Expected; the fallback covers it.
- **The AnimeFillerList scraper is fragile by nature.** No API exists. Cache aggressively.
- **Title matching can mismatch on generic episode titles.** This is why Phase 2 is dry-run first.
- **Renaming is the only step that touches your files.** Everything else is additive and reversible
  by re-running a scan.
