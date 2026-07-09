# Grab Confirmation Flow

Every user-initiated auto-pick action shows the release it would grab and lets the user Grab it /
walk to the Next best / drop to the interactive picker / Cancel, instead of firing straight to the
download client. The 5-minute background cron (`scheduler.ts`) and the Seerr webhook path are
**untouched** — confirmation only applies where there's a live user session to show a modal to.

**Core split** (`src/lib/automation/grabber.ts`): `grabItem` used to do everything inline. It's now
`searchAndScoreItem` (search + scope-filter + gate-partition + score — no side effects besides the
delay-gate's `release_seen_timestamps` upsert) → `grabSpecificRelease` (the actual commit: addTorrent
+ grab_history + status→'grabbed'). `grabItem` itself is now a thin wrapper: D3 claim →
`searchAndScoreItem` → `grabSpecificRelease`. `searchCandidatesForItem` dispatches to this generic
pipeline OR to `findSeasonPackCandidates`/`findArcPackCandidates` (the bespoke range/pack-aware
search) depending on the item's scope — the confirmation flow's one entrypoint for "what would we
grab," shared by the candidates preview and the confirm-time re-validation. `splitTiers` divides a
scored candidate list into Tier 1 (gate-passing + live, `autoPickScore` order) and Tier 2 (gated
and/or dead, revealed only after explicit opt-in, grab requires a second confirm).

**API:** `GET /api/grab/candidates` (cached-first via `grab_results`, `?refresh=true` for a live
re-search — never written back to `grab_results`, that table is cron/grab history) and
`POST /api/grab/confirm` (re-validates fresh, requires `override:true` to commit a Tier-2 release,
calls `grabSpecificRelease`). Both accept `itemId` (preferred) or `tmdbId`+`type` (resolved via
`resolveMonitoredItemForRequest`, for callers that only have the request row).

**Client:** `useGrabConfirm()` / `<GrabConfirmModal>` (`src/components/media/GrabConfirmModal.tsx`)
— every trigger point (`RequestOptions` Auto-grab, `SeasonGrabControl` Grab pack, admin/automation
Grab Now, requests-page Re-Search / Approve-auto-search) opens the same modal rather than
duplicating UI. Two flows (`RequestOptions`, `SeasonGrabControl`'s "Grab pack") had to split
"create the wanted item" from "grab it" — the item/request is created exactly as before, only the
immediate grab is deferred; Cancel just leaves the item `'wanted'` for the cron, same as a
not-found grab attempt always did. `TorrentPickModal`'s optional `onSubmitOverride` prop routes a
manual pick through `/api/grab/confirm` instead of its own `POST /api/requests` (which would 409 —
a request already exists by the time the confirm modal's "Search manually" is reachable).

**Testing:** Vitest is now installed (`vitest.config.ts`, `npm run test`). Test files live next to
their source (`src/lib/automation/grabber.test.ts`) — this was the first test in the repo, so there
was no prior mocking convention; `vi.hoisted()` is required when a `vi.mock()` factory needs to
reference a shared mock function (plain module-scope `const`s aren't visible inside a hoisted factory).
