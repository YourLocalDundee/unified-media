# Audit 08 — User Settings, App Shell & UI Primitives

Scope: `src/app/settings/*`, `src/app/layout.tsx`, `src/app/page.tsx`, shell components
(`AppLayout`, `ConditionalLayout`, `Header`, `Sidebar`, `MobileNav`), state/hooks
(`useSettings`, `lib/settings`, `store`), UI primitives (`Button`, `Card`, `Badge`,
`Modal`, `ModalPortal`, `Spinner`, `ThemeToggle`). READ-ONLY. Notifications/SMTP skipped.

## Summary

The app shell and navigation are in good shape: active-nav highlighting in **Sidebar**
and **MobileNav** both correctly use `pathname === href || pathname.startsWith(href + '/')`
(the trailing-slash convention), and **no nav href contains a query string** — the two
known project conventions are satisfied. Theme system (ThemeToggle / display ThemeSection),
profile page client wiring, and the torrent qBittorrent-backed tabs are all correctly wired
with persistence + feedback.

The dominant problem is **dead/no-op settings**. An entire family of preferences is written
to localStorage (or zustand) but **never read by any consumer**: the whole Display settings
page except theme (10 controls), 9 of 11 Playback prefs, the Advanced "Jellyfin URL override",
the whole Torrent → Interface tab (10 controls), and the zustand `browsePageSize`. The
Shortcuts page also documents two key bindings (**S**, **N**) that are not bound in the
player, and the Sidebar "Collapsed by Default" / "Show Labels" toggles target a different
state source than the Sidebar actually reads. These are silent UX failures: the control moves,
shows a saved value on reload, and changes nothing.

Lower-severity items: zustand whole-store subscription in Sidebar, Modal lacks an explicit
focus trap / restore (native `<dialog>` gives Escape + scroll context but not focus return),
and `ThemeSection` cross-tab sync only covers some custom-theme mutations.

### Counts by severity

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 4 |
| MEDIUM | 6 |
| LOW | 6 |
| **Total** | **16** |

---

## HIGH

### A8-H1 — Entire Display settings page (except theme) is a no-op
**Severity:** HIGH
**File:** `src/app/settings/display/page.tsx:75-171`; hook `src/hooks/useSettings.ts:134-150`

**What's wrong:** `useDisplayPrefs()` is consumed in exactly one place — the Display
settings page that *writes* it. A codebase-wide search for `useDisplayPrefs`,
`unified-display-prefs`, and each field name returns no reader. None of
`showContinueWatching`, `showRecentlyAdded`, `showNextUp`, `carouselLimit`, `defaultView`,
`posterSize`, `showTypeBadge`, `showYear`, `sidebarCollapsed`, `sidebarLabels` is read by
the home page (`src/app/page.tsx`), the library grid, the media card, or the sidebar. The
home page (`page.tsx`) renders Continue Watching / Recently Added / Pending Requests /
Active Downloads unconditionally and hardcodes its limits (`getResumeItems(userId, 10)`,
`getRecentlyAdded(12)`).

**Why it matters:** 10 visible, fully interactive controls (4 toggles + 2 selects + 4 more
toggles) persist and re-hydrate on reload but do nothing. Users will toggle "Show Continue
Watching" off and still see it. This is the single largest correctness gap in the settings UI.

**Suggested fix:** Either wire the prefs into the consumers (home page should be a client
island or receive prefs to gate sections and pass `carouselLimit`; library grid should read
`defaultView`/`posterSize`/`showTypeBadge`/`showYear`), or remove the page sections until
they are wired. At minimum gate the home-page sections behind the three "Show …" toggles.

### A8-H2 — 9 of 11 Playback prefs are no-ops (only audioLang + subtitleLang are read)
**Severity:** HIGH
**File:** `src/app/settings/playback/page.tsx:105-211`; hook `src/hooks/useSettings.ts:19-46,109-132`

**What's wrong:** `VideoPlayer` (the only `usePlaybackPrefs` consumer) reads exactly two
fields: `prefs.audioLang` (`VideoPlayer.tsx:416`) and `prefs.subtitleLang`
(`VideoPlayer.tsx:423`). A broad search for the rest returns no consumer anywhere:
`quality`, `hwAccel`, `subtitleSize`, `subtitleBg`, `subtitleColor`, `autoPlayNext`,
`autoPlayDelay`, `skipIntro`, `resumeMode` are written by the settings page but never read.
Notably the player has its own next-episode autoplay countdown overlay
(`VideoPlayer.tsx:1276-1283`) that does **not** gate on `autoPlayNext`, and a server-side
quality system (`MaxStreamingBitrate`) that does not consult `prefs.quality`.

**Why it matters:** 9 of the 11 playback controls (the entire Video Quality section, three
of five subtitle-appearance selects, and the entire Playback Behavior section) silently do
nothing. "Auto-play Next Episode = off" will still autoplay; "Subtitle Size = large" has no
effect; "Preferred Quality = 480p" is ignored.

**Suggested fix:** Wire each consumed pref into the player: `autoPlayNext` should short-circuit
the countdown effect; `resumeMode` should drive the resume-vs-restart decision; subtitle
appearance prefs should style the `<track>`/cue rendering; `quality` should seed the initial
`MediaQualitySelector` choice / streaming bitrate. Remove or disable any that cannot be
supported (e.g. `hwAccel` is a server transcode concern).

### A8-H3 — Torrent → Interface tab (10 controls) is a no-op on the live downloads page
**Severity:** HIGH
**File:** `src/app/settings/torrent/TorrentSettingsClient.tsx:356-387,1374-1476`;
live page `src/app/downloads/page.tsx:445-452`

**What's wrong:** The Interface tab persists `TorrentUIPreferences` to
`unified-torrent-prefs` (visible columns, column order, sort column/direction, rows per page,
refresh interval, date format, show-speed-in-toolbar, confirm-delete, confirm-delete-files).
But `unified-torrent-prefs` is read **only inside the settings page itself** — no other file
reads that key. The live `/downloads` page (`page.tsx`) uses its own inline `TorrentRow`
(line 445) that takes no prefs prop, hardcodes its columns, and hardcodes the delete confirm
via `window.confirm` (`downloads/page.tsx:479-484`) ignoring `confirmDelete`/`confirmDeleteFiles`.
A search of `downloads/page.tsx` for `refreshInterval`, `rowsPerPage`, `dateFormat`,
`visibleColumns`, `sortColumn`, `showSpeedInToolbar` returns nothing. The
`src/app/downloads/components/TorrentRow.tsx` that *does* consume `TorrentUIPreferences` is
the alternate component that "ships alongside" (per its own header comment) but is not the
one the active page renders.

**Why it matters:** All 10 Interface-tab controls reload with their saved value (so they look
functional) yet change nothing on the actual downloads view. The other 9 torrent tabs are
genuinely wired to qBittorrent, which makes this one dead tab especially deceptive.

**Suggested fix:** Make `/downloads/page.tsx` load `unified-torrent-prefs` (reuse
`loadUIPrefs`/`DEFAULT_UI_PREFS`) and thread it into the rendered row/table — or switch the
page to render the prefs-aware `components/TorrentRow.tsx`. Until then, hide the Interface tab.

### A8-H4 — Shortcuts page lists S (subtitles) and N (next episode), neither is bound
**Severity:** HIGH
**File:** `src/app/settings/shortcuts/page.tsx:12-21`; player handler
`src/components/media/VideoPlayer.tsx:619-705`

**What's wrong:** The static shortcut table advertises `S → Toggle subtitles` and
`N → Next episode`. The player keydown switch binds Space/K (play-pause), F (fullscreen),
M (mute), J/L and ←/→ (seek), ↑/↓ (volume), `,`/`.` (frame step), `0-9` (seek %), and
`I` (stats). There is **no `case 's'`/`'S'` and no `case 'n'`/`'N'`** — subtitles have no
keyboard toggle and next-episode is only reachable via the autoplay overlay, not a key.

**Why it matters:** Documented shortcuts that do nothing erode trust in the whole reference.
Conversely, several real bindings (K, J, L, `,` `.`, digits, I) are undocumented, so the page
is wrong in both directions.

**Suggested fix:** Either bind `S` (toggle `activeSubIndex` between -1 and the preferred
track) and `N` (`router.push('/watch/${nextEpisode.id}')`, the handler already exists at
`VideoPlayer.tsx:941-943`), or correct the table to match the actual bindings and add the
missing K/J/L/`,`/`.`/digit/I rows. Also note "Esc → close modal" is handled by the native
`<dialog>` element, but "Esc → exit fullscreen" is the browser default, not this handler.

---

## MEDIUM

### A8-M1 — Sidebar "Collapsed by Default" / "Show Labels" target the wrong state source
**Severity:** MEDIUM
**File:** `src/app/settings/display/page.tsx:154-167`; sidebar reads zustand
`src/components/layout/Sidebar.tsx:54`; store `src/store/index.ts:17,35`

**What's wrong:** The Display page's Sidebar toggles write `sidebarCollapsed` and
`sidebarLabels` into the `unified-display-prefs` localStorage blob. But the actual `Sidebar`
component derives its collapsed/expanded state purely from the zustand store
(`sidebarOpen`, default `false` = collapsed-to-icons via `w-16`/`w-56`) and renders labels
based on that same `sidebarOpen`. It never reads the display prefs. So "Collapsed by Default"
and "Show Labels" are no-ops, and there is no bridge from the persisted pref into zustand on
load.

**Why it matters:** Two more dead toggles, and a genuine feature gap: the sidebar's open
state is in-memory zustand (resets to collapsed every full reload), while the user's stated
"collapsed by default" preference that *should* drive that initial value is ignored.

**Suggested fix:** Seed zustand `sidebarOpen` from `unified-display-prefs.sidebarCollapsed`
on mount (or persist the zustand slice), and gate the label rendering on `sidebarLabels`.
Subset of A8-H1 but called out because it spans two state systems.

### A8-M2 — Advanced "Jellyfin URL Override" is written but never read
**Severity:** MEDIUM
**File:** `src/app/settings/advanced/page.tsx:16-31`

**What's wrong:** `saveJellyfinUrl` writes/removes `unified-jellyfin-url-override` in
localStorage. The only references to that key are in this file (write) and in
`clearAllPreferences` (delete). No stream-URL builder, player, or API route reads it. The
page's own comment claims it "lets a user point the browser at a different Jellyfin base URL
for video streaming," which does not happen.

**Why it matters:** A persisted setting with a Save button that has no effect; the explanatory
copy actively misleads.

**Suggested fix:** Read the override where stream URLs are constructed (client-side player
src), or remove the section. If kept, also note streams are proxied server-side via
`/api/jellyfin/...`, so a client-only override may be architecturally moot.

### A8-M3 — zustand `browsePageSize` is dead state
**Severity:** MEDIUM
**File:** `src/store/index.ts:19,26,35,47`

**What's wrong:** The store defines `browsePageSize` (default 25) and `setBrowsePageSize`,
documented as "Browse page per-page preference (in-memory — persists across client
navigations)." A codebase search for both identifiers outside `store/index.ts` returns
nothing — neither `/browse` nor `/library` reads or sets it.

**Why it matters:** Dead store slice; misleads future maintainers into thinking browse
page-size is centrally managed, and every store subscriber (see A8-L1) carries it.

**Suggested fix:** Remove `browsePageSize`/`setBrowsePageSize`, or wire the browse page-size
selector to it.

### A8-M4 — Modal has no focus trap and no focus restore on close
**Severity:** MEDIUM
**File:** `src/components/ui/Modal.tsx:15-47`

**What's wrong:** The primitive uses a native `<dialog>` with `showModal()`, which provides
Escape-to-close (via the `close` event → `onClose`), backdrop rendering, and an inert
background — good. But it does not implement a focus trap beyond the browser default and does
not restore focus to the previously-focused element on close. `showModal()` moves focus into
the dialog, yet on close focus can land on `<body>` rather than the trigger, and there is no
initial-focus management for the close button vs. first field.

**Why it matters:** Keyboard and screen-reader users lose their place when the modal closes;
WCAG 2.4.3 (Focus Order) regression. Affects every `Modal` consumer.

**Suggested fix:** Capture `document.activeElement` on open and `.focus()` it on close; set
initial focus deliberately. Native `<dialog>` traps Tab within itself in modern browsers, so
a full JS trap may be unnecessary, but focus restore should be added explicitly.

### A8-M5 — CreateThemeModal / ThemeToggle dropdowns are not Escape-closable and lack focus management
**Severity:** MEDIUM
**File:** `src/components/ui/ThemeToggle.tsx:166-279` (modal), `283-435` (dropdown)

**What's wrong:** `CreateThemeModal` is a hand-rolled `fixed inset-0` overlay (not the
`Modal` primitive). It has no Escape handler, no focus trap, no body scroll-lock, and no
backdrop-click-to-close (clicking the dimmed area does nothing). The ThemeToggle dropdown
closes on outside mousedown but not on Escape and does not return focus to the trigger.

**Why it matters:** Inconsistent modal behavior across the app; keyboard users cannot dismiss
the theme-create dialog with Escape and can scroll the background.

**Suggested fix:** Reuse the `Modal` primitive for CreateThemeModal (gets Escape + inert
background for free once A8-M4 focus restore is added), add `onKeyDown Escape` to the
dropdown, and add backdrop click-to-close.

### A8-M6 — Header account dropdown and ThemeToggle dropdown have no keyboard/ARIA semantics
**Severity:** MEDIUM
**File:** `src/components/layout/Header.tsx:50-91`; `src/components/ui/ThemeToggle.tsx:344-424`

**What's wrong:** Both are click-only popover menus. The trigger buttons lack
`aria-haspopup`, `aria-expanded`, and `aria-controls`; the menu containers lack
`role="menu"`/`role="menuitem"`; there is no arrow-key navigation and no Escape-to-close on
the Header menu. Outside-click closes via a `mousedown` listener only.

**Why it matters:** Screen-reader users get no indication these are menus or whether they are
open; keyboard-only users cannot operate them as menus. The visible `Search` and Settings
links are still reachable, so impact is moderate, not critical.

**Suggested fix:** Add `aria-haspopup="menu"`, `aria-expanded={menuOpen}`, role attributes,
Escape handling, and basic arrow-key focus movement.

---

## LOW

### A8-L1 — Sidebar subscribes to the whole zustand store
**Severity:** LOW
**File:** `src/components/layout/Sidebar.tsx:54`

**What's wrong:** `const { sidebarOpen, toggleSidebar } = useAppStore()` calls the hook with
no selector, so the component re-renders on **any** store change — including `openPlayer`,
`closePlayer`, `playerStartTicks`, and `browsePageSize`. Sidebar only needs `sidebarOpen`
and the stable `toggleSidebar`.

**Why it matters:** Unnecessary re-renders of the sidebar (and its nav `Suspense` subtree)
whenever the player opens/closes. Small in practice (player is on a chromeless route), but
it is the only store subscriber and an easy precision win.

**Suggested fix:** Use atomic selectors:
`const sidebarOpen = useAppStore(s => s.sidebarOpen)` and
`const toggleSidebar = useAppStore(s => s.toggleSidebar)`.

### A8-L2 — Theme initial-paint default is hardcoded `dark`, can flash for `prefers-color-scheme: light` first-time users
**Severity:** LOW
**File:** `src/app/layout.tsx:27`; inline script `:33-37`

**What's wrong:** `<html className="dark" data-theme="dark">` is the SSR default. The inline
pre-paint script does handle the light case (`matchMedia('(prefers-color-scheme: light)')`),
so this is mostly covered, but the `className="dark"` (separate from `data-theme`) is never
updated by the inline script — only `data-theme` is patched. If any Tailwind `dark:` variant
relies on the `dark` class (rather than the `data-theme` CSS-variable system), a
light-preference user keeps the stale `dark` class until React reconciles.

**Why it matters:** Potential brief mismatch / FOUC for first-time light-mode users; only if
`dark:` class-based variants exist alongside the variable system.

**Suggested fix:** Have the inline script also toggle the `dark` class on
`document.documentElement` to match the resolved theme, or drop the static `className="dark"`
in favor of variable-driven theming only.

### A8-L3 — Display/Playback toggles are `role="switch"` but not keyboard-focusable beyond default and missing `aria-label`
**Severity:** LOW
**File:** `src/app/settings/display/page.tsx:21-44`; `src/app/settings/playback/page.tsx:49-72`

**What's wrong:** The custom `Toggle` is a `<button role="switch" aria-checked>` (good) but
carries no accessible name of its own — it relies entirely on the adjacent `SettingRow`
label, which is not programmatically associated (no `aria-labelledby`/`id`). A screen reader
on the switch announces "switch, on/off" with no label.

**Why it matters:** Each settings toggle is unlabeled to assistive tech. Visual users are
fine.

**Suggested fix:** Pass the row label into the `Toggle` as `aria-label`, or give the label an
`id` and reference it via `aria-labelledby`.

### A8-L4 — `Select` swallows a value when option lookup fails (no else); type-narrowing relies on `String()` round-trip
**Severity:** LOW
**File:** `src/app/settings/display/page.tsx:46-73`; `src/app/settings/playback/page.tsx:21-47`

**What's wrong:** The shared `Select` maps the raw string back to a typed option via
`options.find(o => String(o.value) === raw)` and only calls `onChange` when a match is
found. This is defensive but means a value mismatch silently no-ops. It is correct today
because `<option value>` is always the stringified option, but it is fragile if option values
ever collide after stringification (e.g. number `0` vs string `'0'` — `carouselLimit:0` and a
hypothetical string option would both stringify to `"0"`).

**Why it matters:** Latent footgun, not a live bug. Currently safe.

**Suggested fix:** Key options by index instead of stringified value, or assert exhaustive
matching.

### A8-L5 — ThemeSection cross-tab sync re-injects custom themes but does not handle deletions or active-theme cleanup
**Severity:** LOW
**File:** `src/app/settings/display/ThemeSection.tsx:56-71`

**What's wrong:** The `storage` listener for `unified-custom-themes` reloads and re-injects
`<style>` for all current themes, but never calls `removeCustomThemeStyle` for themes that
were deleted in another tab — orphan `<style id="custom-theme-...">` nodes linger. It also
doesn't reconcile `active` if the active theme was deleted in the other tab.

**Why it matters:** Minor leak of stale style tags across multi-tab sessions; no user-visible
breakage in the common case.

**Suggested fix:** Diff previous vs next theme ids and `removeCustomThemeStyle` the dropped
ones; if `active` is no longer present, fall back to `dark`.

### A8-L6 — `Button` `isLoading` shows a spinner but does not hide/replace label, and has no `aria-busy`
**Severity:** LOW
**File:** `src/components/ui/Button.tsx:32-54`

**What's wrong:** When `isLoading` is true the button is disabled (good) and a `Spinner` is
prepended, but `children` still render beside it and there is no `aria-busy="true"`. The
Spinner itself has `role="status" aria-label="Loading"` so SR users do hear "Loading," but
the button's busy state is not conveyed on the control.

**Why it matters:** Minor a11y/polish; the disabled state already prevents double-submit.

**Suggested fix:** Add `aria-busy={isLoading}` to the button.

---

## Verified-correct (no findings)

- **Active-nav highlighting** — `Sidebar.tsx:26-29` and `MobileNav.tsx:24-26` both use
  `pathname === href || pathname.startsWith(href + '/')` with a `/` special-case. Correct per
  project convention; no bare `startsWith(href)`.
- **No query strings in nav hrefs** — all `navItems` hrefs in Sidebar/MobileNav and the
  Settings `USER_NAV` / Header links are plain paths.
- **ConditionalLayout** — `:15` uses the same trailing-slash-safe prefix match for auth pages.
- **AppLayout** chrome suppression for `/watch/` and `/play/` (`:15`) matches CLAUDE.md §10a.
- **Profile client wiring** (`ProfileClient.tsx`) — correct endpoints
  (`/api/auth/profile/{display-name,email,demographics,change-password,sessions,...}`),
  per-section saving/saved/error feedback, optimistic session removal, and confirm-mismatch
  UI. Endpoint internals are out of scope and were not audited.
- **Torrent tabs 1-9** (`TorrentSettingsClient.tsx`, `NewTabs.tsx`) — genuinely wired to
  qBittorrent via `/api/qbit/app/preferences` → `/app/setPreferences`, sending only the dirty
  diff, with dirty-tab indicators, Save/Reset, success/error feedback.
- **Media settings page** (`MediaSettingsClient.tsx`) — admin-gated, parallel
  `Promise.allSettled`, graceful per-service "unavailable", and real indexer toggle/test
  calls to the Prowlarr proxy.
- **About page** — static changelog parse with try/catch fallback; no runtime concerns.
- **Modal Escape + backdrop** — native `<dialog>` `onClose` handles Escape; backdrop click is
  handled via `e.target === ref.current` (`Modal.tsx:27-31`). Only focus restore (A8-M4) is
  missing.
- **lucide-react imports** — all named (`import { Home, Film } from 'lucide-react'`),
  tree-shakeable; no namespace/`* as` imports found.
