# Session handoff — react-hooks lint cleanup (2026-06-23)

Fixed **all 78** `eslint-plugin-react-hooks` v6 warnings with real code changes (zero `eslint-disable`
suppressions), then promoted the four React-Compiler-era rules from `warn` back to `error`. The config
had downgraded them during the Next 16 migration "until a cleanup pass"; this is that pass.

- **Version:** `0.10.1` (was 0.10.0).
- **Gate:** `npm run lint` clean at **error** level, `npm run type-check` clean, `npm run build` green.
- **Runtime smoke:** standalone server boots clean (`/api/health` 200, `/login` 200, `/register` 200 —
  exercises the changed debounce/effect code via SSR, root 307 → login, party WS server up).
- **Working tree:** committed + pushed; image rebuilt + redeployed.

---

## What changed by rule

### `set-state-in-effect` (44 sites)
The rule flags any `setState` synchronously *reachable* from an effect body — including calling an `async`
function that setStates (the leading `setLoading(true)` is not the only trigger; even all-post-`await`
setStates are flagged when the call is in the effect body). Fixes by shape:

- **Fetch-on-mount** (admin/list/settings pages, `TorrentDetailPanel`, `SeriesScopeModal`, etc.) — wrapped
  the call/body in `const id = setTimeout(fn, 0); return () => clearTimeout(id)`. Deferring off the
  synchronous commit path clears the rule and preserves the loading-on-refetch behavior.
- **Debounced search** (`PartyPanel`, `register` username + password-strength) — moved the setStates inside
  the debounce timeout (empty-term/invalid resolves on a 0ms timer).
- **Prop-sync** (`SearchInput`) — React "adjust state during render" pattern (`if (prop !== prev) {…}`),
  effect removed.
- **localStorage restore** — player-tool panels (Equalizer/Transform/VideoEffects/AudioTools/Subtitles)
  and the theme components defer only the React state commit; the imperative applies (audio chain, video
  transform, `applyTheme`, style injection) stay synchronous so there's no flash.
- **`useSettings`** — rewritten on `useSyncExternalStore` (a small localStorage-backed store). The `ready`
  flag (which the player's one-time audio/subtitle default logic depends on) is preserved via the new
  `useIsClient` hook.
- **`VideoPlayer`** — aspect-ratio became a lazy `useState(() => detectAspectRatio(...))`; the
  screen-aware quality select and the post-hydration audio/subtitle defaults defer their setStates
  (the once-only `defaultsApplied` ref is still set synchronously).
- **`usePartySync`** — the disabled-instance branch no longer setStates; `connected`/`connectionState` are
  derived as settled at the return. The reconnect `setEnded(false)` became a during-render reset keyed on
  `partyId` change (also safer — the old unconditional reset could clobber a just-set `ended=true`).

### `refs` (16 sites)
- Latest-value ref writes in `usePartySync` (`mediaIdRef`/`onQueueAdvanceRef`) and `VideoPlayer`
  (`partyKbdRef`, `reportStopRef`) moved from render into `useEffect(() => { ref.current = … })`. These refs
  are only read from callbacks/listeners that fire after commit, so the one-frame lag is irrelevant.
- Refs read **in JSX** became state set from event handlers: `pendingResumeSeconds` (resume dialog) and
  `videoResolution` (stats overlay, set on `loadedmetadata`).

### `purity` (4 sites)
Render-time `Date.now()` in `admin/page`, `admin/users/[id]`, `invite/[code]` routed through a new
`nowMs()` helper in `lib/utils.ts`.

### `immutability` (4 sites)
- `textTracks[i].mode = …` iterates via `Array.from(tracks).forEach(...)`.
- The keydown handler's use-before-declaration of `toggleFullscreen`/`toggleMute`/`totalSubCount` (declared
  far below the mount-once listener) goes through a `kbdActionsRef` populated by a later effect.
- `detectAspectRatio` hoisted to module scope (also unblocks the lazy aspect-ratio initializer).

### Other (non react-hooks, fixed in passing to get to 0)
4 `<img>` → `next/image` (admin requests, home, requests table, TorrentPickModal); 2 internal `<a>` →
`next/link` (error boundary "Go home", discover back-link); named the flat-config default export; removed 2
stale `eslint-disable` directives.

---

## New shared code
- **`src/hooks/useIsClient.ts`** — `useSyncExternalStore`-based is-client gate (false on SSR/hydration, true
  after mount). Used by `ModalPortal` and `useSettings`.
- **`src/lib/utils.ts` `nowMs()`** — single indirection for `Date.now()` to keep clock reads out of render.

## Notes / not done
- **The setTimeout(fn, 0) deferral pattern appears ~20×.** It's deliberate and documented inline; it's the
  reliable way to move a needed setState off the effect's synchronous path. If you ever migrate these fetch
  pages to React Query the effects disappear entirely (bigger change, deferred).
- **Two-browser party auto-advance test still not run by a machine** — same caveat as the 2026-06-22
  handoff. The build + boot smoke confirm no SSR/module regression, but the live multi-client behavior
  (the `usePartySync` `ended`/derive changes and `VideoPlayer` party.ended teardown moving to during-render)
  is worth one manual two-browser pass at a screen. Behavior was preserved by construction.
- Rules are now `error`: a future `setState`-in-effect / ref-in-render will fail `npm run build`. See
  CLAUDE.md §7 "react-hooks rules enforced at error" for the compliant patterns.
