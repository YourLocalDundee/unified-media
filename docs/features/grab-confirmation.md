# Grab Confirmation Flow

Every user-initiated auto-pick action shows the release it would grab and lets the user Grab it /
walk to the Next best / drop to the interactive picker / Cancel, instead of firing straight to the
download client. The background `grab` cron and the old request app webhook path are **untouched** —
confirmation only applies where there's a live user session to show a modal to. Cadence and the
scheduler's side of that split: `docs/features/scheduling.md`.

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

## One grab per item

An item can carry at most one live grab claim. `POST /api/requests/[id]/approve` used to claim the
monitored item `'wanted'` → `'grabbing'` *inside* the fire-and-forget preferred-grab call — that left
a window between the response returning and the claim actually landing where the 5-minute grab cron
could claim the same row and auto-pick its own release before the preferred grab's dynamic imports
resolved. Hit for real 2026-08-16: an interactive pick followed by approve grabbed both the
hand-picked release and a 4K release the cron chose independently, and the cron's pick was the one
that got imported.

The claim now happens synchronously in the approve route, before the response is sent
(`claimForPreferredGrab(itemId)`), and `firePreferredGrab` takes the already-claimed item id instead
of calling `createItem()` a second time — the old second call carried no scope fields, so an
interactive pick on a scoped TV request could mint a second `monitored_items` row (different
`scope_key`) and leave the original row at `'wanted'` for the cron to grab on its own. The failure
path releases the claim by item id (`WHERE id = ? AND status = 'grabbing'`), not by `tmdb_id`+`type`,
which could release a different scope's row. The approve response carries `pickGrabbed: true|false`
on the pick paths — `false` means the request was approved but nothing was dispatched because the
item already had a grab of its own; `RequestsTable.tsx`'s approve-with-pick and admin
override-approve handlers show a message rather than approving silently.

`POST /api/grab/confirm` returns 409 when the target item is already `'grabbing'` or `'grabbed'`, so
the confirmation modal can't add a second release to an item whose hand-picked release was already
grabbed at approval. Admin-only escape hatch: `force: true` in the body, honoured only when
`session.role === 'admin'`. `GrabConfirmTarget` gained `allowRegrab?: boolean`, forwarded as `force`
— the Monitored Items table's "Grab Now" button on `/admin/automation` passes `allowRegrab: true`,
since that's an explicit per-item admin action that must keep working on an already-grabbed item.

A claim held for more than a few seconds belongs to a claimer that died mid-search (container
restart, or the gap between the approve route's synchronous claim and its fire-and-forget grab) —
without a sweep such a row is stranded, since the grab cron only ever reads `'wanted'` items. New
`releaseStaleGrabClaims(maxAgeMs)` in `src/lib/automation/monitor.ts`; the grab cron calls it with a
15-minute threshold before reading the want list.

This closes half of the fix for the backlog item "one request can produce two grabs"; the other half
— a pre-import guard for the race that can still slip past a synchronous claim — is
`resolveDuplicateGrabs()`, documented in `docs/features/decision-engine.md`.

**Testing:** Vitest is now installed (`vitest.config.ts`, `npm run test`). Test files live next to
their source (`src/lib/automation/grabber.test.ts`) — this was the first test in the repo, so there
was no prior mocking convention; `vi.hoisted()` is required when a `vi.mock()` factory needs to
reference a shared mock function (plain module-scope `const`s aren't visible inside a hoisted factory).
