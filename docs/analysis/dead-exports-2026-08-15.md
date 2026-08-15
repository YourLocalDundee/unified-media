# Dead exports, re-derived — 2026-08-15

Backlog item: re-derive the wiring audit's "45 exported symbols never referenced outside their own
file" with same-file callers counted, because that figure was a list of over-wide `export` keywords,
not a list of dead code, and acting on it directly nearly shipped a breakage.

**Result: 45 → 24.** Roughly 45% of what the original criterion flags is live code.

## Why the original number was wrong

The original detector counted references from *other files only*. A symbol that is exported and also
called inside its own module therefore read as zero references. That is how it flagged
`findSeasonPackCandidates` and `findArcPackCandidates` in `app/src/lib/automation/grabber.ts` as dead
when both have live same-file callers, including `searchCandidatesForItem`, which the season/arc
grab-confirmation preview depends on. The deletion was attempted and caught before it shipped.

**111 symbols** have zero other-file references and live same-file callers — 73 interfaces, 23
functions, 13 types, 1 const, 1 export-list entry. Every one would be flagged by the original
criterion. This pass also found a **second instance of the same near-miss pattern** the original audit
did not flag: `processOnePending` (`app/src/lib/subtitle/downloader.ts:260`) is exported in a trailing
`export { … }` list, has zero other-file references, and has three same-file callers.

Verification of the method: the two near-miss symbols and their neighbours show 4–5 whole-word
occurrences each, while every symbol on the confirmed list below shows exactly 1 — its own
declaration.

## What was excluded, and why

| Reason | Count |
| ------ | ----- |
| Next.js framework exports — route `GET`/`POST`/`PATCH`/`DELETE`/`PUT`, `page`/`layout` defaults, `metadata`, `generateMetadata`, `viewport`, `dynamic`, `instrumentation.ts`'s `register`, `proxy.ts`'s `proxy` | 313 |
| Live same-file callers (the bug class above) | 111 |
| Test-only references | 0 |
| Barrel re-export as the only external reference | 0 |

Starting population was 1,045 export declarations across 377 non-test files, leaving 732 candidates
after framework exclusions.

**A second failure mode worth recording.** Naive text search manufactures false *liveness* as well as
false deadness. `Card` (`components/ui/Card.tsx`) appeared to have three external references; all
three were the English word "Card" inside unrelated comments and JSX text (`ThemeToggle.tsx:337`
"Preview Card", `DiscoverResults.tsx:93` `{/* Card body */}`, `login/page.tsx:82` `{/* Card */}`).
`grep -rl "from '@/components/ui/Card'"` returns nothing. A symbol whose name is also a common English
word cannot be cleared by occurrence count alone.

## Deleted

Runtime values, all with zero references anywhere including their own file:

| File | Symbol |
| ---- | ------ |
| `lib/push.ts` | `isPushConfigured` |
| `lib/download-client/registry.ts` | `isDownloadClientImplemented` (and its `IMPLEMENTED_CLIENTS` set) |
| `lib/indexer/config.ts` | `getEnabledIndexers`, `getPendingIndexers` |
| `lib/qbittorrent/api.ts` | `getMainData`, `getTorrentFiles`, `recheckTorrents` |
| `lib/automation/monitor.ts` | `updateImportStatus` |
| `lib/automation/gates.ts` | `isBlocklisted` (sibling `addToBlocklist` and `loadBlocklist` are live) |
| `lib/subtitle/monitor.ts` | `markSkipped` |
| `components/ui/Card.tsx` | whole file — `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` |

Types that were dead duplicates rather than merely unreferenced:

| File | Symbol | Superseded by |
| ---- | ------ | ------------- |
| `types/torrent.ts` | `QbtTorrent` (44 fields) | `Torrent` in `lib/qbittorrent/types.ts`, which is what `downloads/page.tsx` imports |
| `types/torrent.ts` | `QbtTransferInfo` | `TransferInfo`, defined and used in both `lib/qbittorrent/types.ts` and `lib/download-client/types.ts` |
| `types/torrent.ts` | `QbtTorrentState` | second-order — existed only to type `QbtTorrent` |
| `lib/qbittorrent/types.ts` | `TorrentFile` | second-order — `QbtFileInfo` is what the Files tab and piece map use |

## Narrowed rather than deleted

Per the agreed remediation, an export with no consumers gets its `export` keyword dropped rather than
being deleted, so the module's public surface narrows without discarding the declaration:

- `lib/party/types.ts` — `WatchPartyMemberRow`
- `lib/party/events.ts` — `PartyEvents`
- `components/player/types.ts` — `PlaybackRate`

## Left exactly as they are

Three symbols match the "unreferenced export" pattern but carry documented intent. Deleting or
narrowing them would discard information, which is the failure this whole exercise exists to avoid.

- **`CUSTOM_FORMAT_FLAGS`** (`lib/automation/quality.ts:61`) — its comment says it is "exported so the
  admin UI can offer them as a dropdown", and `admin/quality-profiles/page.tsx` never imports it. This
  is unfinished wiring, structurally identical to the no-op settings already tracked. It is a small
  feature to finish, not code to remove.
- **`VIP_DAILY_DOWNLOAD_CEILING`** (`lib/subtitle/opensubtitles.ts:27`) — `= 1000`, the documented VIP
  quota. There is an unconditional low-quota `console.warn` at `opensubtitles.ts:211` that looks like
  it was meant to compare against this constant and does not. Also unfinished wiring.
- **`ABLoopState`** (`components/player/types.ts:9`) — the comment says the type "exists for potential
  future lifting" of A/B loop state to a parent. Deliberate scaffolding, explicitly labelled.

## Second-order cascade

Deleting a function can orphan what it used. Three type imports were left dangling and **eslint did not
flag them** (the unused-vars rule does not catch type-only imports here) — `MainData` and `TorrentFile`
in `lib/qbittorrent/api.ts`, `ImportStatus` in `lib/automation/monitor.ts`. Removing those in turn
orphaned the `TorrentFile` declaration itself. Anyone repeating this exercise should re-run the
reference count after deleting, not just before.

## Verification

`tsc --noEmit` clean, `eslint` clean on every changed file, 69 vitest tests pass, `npm run build`
compiles. Note that a green build is necessary but not sufficient evidence here: the symbols removed
had zero references, so a build would have stayed green even if the analysis were wrong about their
being reachable at runtime through a dynamic path. The manual per-symbol check is the real evidence.
