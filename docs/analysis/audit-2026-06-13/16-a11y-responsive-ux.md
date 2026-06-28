# Audit 16 — Accessibility, Responsive/Mobile, Per-Route UX States

**Scope:** cross-cutting pass over ~43 pages / ~51 components (src/app, ui/, layout/, media/, player/,
party/). Three lenses: accessibility (keyboard, focus, ARIA, semantics, contrast), responsive/mobile,
per-route UX states (loading/empty/error, segment files, 404). READ-ONLY. Notifications + SMTP skipped.

## Summary

The app has a solid *visual* baseline (consistent skeletons, empty states on the major data grids, a
themed design system, a well-built login/register flow) but a thin *assistive* layer. The biggest gaps
are structural and systemic, so they recur on nearly every screen:

- **Zero route-segment files.** No `loading.tsx`, `error.tsx`, `not-found.tsx`, or `global-error.tsx`
  exist anywhere. Server-component throws render React's default error; the five pages that call
  `notFound()` fall through to the unstyled, theme-bypassing default 404; no route-level streaming.
- **No `aria-live` region anywhere in the codebase.** Every toast, async result, inline form error,
  copied-link confirmation, reset-password reveal, and player state change is silent to screen readers.
- **No skip-to-content link** and **no `aria-current` on nav** — keyboard/SR users re-traverse the whole
  Sidebar on every navigation and get no programmatic "active page" cue.
- **Custom (non-`<dialog>`) modals lack a focus trap, focus restore, Escape, and proper dialog roles.**
  Affects CreateThemeModal, AddTorrentModal, SeriesScopeModal, the admin reset-PW modal, and the
  Downloads settings slide-over. A keyboard/SR user can tab out behind the overlay.
- **Player control-bar dropdowns** (subtitles, audio) have no roving focus, no Escape, no outside-click
  close, and don't close one another — and controls auto-hide after 3s with no keyboard-focus reprieve.
- **17 page files hardcode `bg-zinc-950` / `text-white`**, bypassing the theme tokens; in the Light
  theme these render near-unreadable, and custom themes (midnight/dim/cinema) silently degrade to a
  generic dark palette on the Downloads surface (which keys off Tailwind `dark:` not the tokens).
- Many icon-only controls lack accessible names; many tap targets are < 44px (MobileNav, player).

Severity counts below. Mobile/responsive is the strongest of the three lenses (real mobile layouts on
Downloads, responsive grids, `playsInline`, orientation lock); a11y is the weakest.

## Counts by severity

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 6 |
| MEDIUM | 13 |
| LOW | 8 |
| **Total** | **27** |

---

## HIGH

### A16-H1 — No route-level error boundaries; a thrown server component crashes the whole view
**Severity:** HIGH
**File:** entire `src/app/**` tree (no `error.tsx` / `global-error.tsx` exist — verified by find)
**What's wrong:** There is not a single `error.tsx` or `global-error.tsx`. Server components throw
freely — e.g. `getItemById`, `getNativePlaybackData`, the admin/db queries, every `lib/*` call in a
page. When any of them throws, Next.js shows the framework default error page (dev) or a bare "something
went wrong" with no app chrome, no theme, and no recovery path (prod).
**Why it matters:** A transient DB lock, a TMDB outage, or a malformed row takes a route from "degraded"
to "blank crash" with no retry. For a self-hosted app where the backing services flap, this is the
difference between a usable and an unusable page. Resilience + UX-state lens core miss.
**Suggested fix:** Add `src/app/error.tsx` (client component with a reset button) at the root and, ideally,
per-section (`admin/error.tsx`, `downloads/error.tsx`, player routes). Add `src/app/global-error.tsx`
for the layout-level catch.

### A16-H2 — No `not-found.tsx`; bad `[id]`/`[code]` params render an unstyled, theme-bypassing 404
**Severity:** HIGH
**File:** `app/play/[id]/page.tsx:42,45`; `app/library/[id]/page.tsx`; `app/browse/[id]/page.tsx`;
`app/browse/discover/[mediaType]/[tmdbId]/page.tsx`; `app/watch/[id]/page.tsx` (all call `notFound()`),
plus there is no `app/not-found.tsx`.
**What's wrong:** Five dynamic routes correctly call `notFound()` for a missing item, but with no
`not-found.tsx` anywhere the user lands on Next's built-in 404 — white background, default font, no
Sidebar/Header, no "back to library" affordance, no theme. A typo'd or stale deep link is a dead end.
**Why it matters:** Deep links to deleted media are common in this app (Quick requests auto-delete after
48h; the home "Recently Added" strip can outlive a file). The 404 is a frequent real state, not an edge.
**Suggested fix:** Add `src/app/not-found.tsx` with the app shell, a friendly message, and links to
`/library` and `/browse`. Consider a section-level `not-found.tsx` for `/admin`.

### A16-H3 — Player subtitle/audio dropdowns are keyboard/SR traps (no Escape, no outside-click, no roving focus, mutually non-exclusive)
**Severity:** HIGH (keyboard user cannot reliably operate a core playback control)
**File:** `src/components/media/VideoPlayer.tsx:1180-1245` (subtitle menu + audio menu)
**What's wrong:** Both popovers are plain `{show && <div>…<button>…}` with: no `role="menu"`/`menuitem`,
no `aria-expanded`/`aria-haspopup` on the trigger, no Escape-to-close, no outside-click-to-close (unlike
Header/ThemeToggle which at least close on outside mousedown), and no arrow-key navigation. Opening the
audio menu does not close the subtitle menu, so they can overlap. Worse, the whole control bar
auto-hides after 3s (`showControls`, line 437-441) on a timer that only mouse/touch movement resets —
**a keyboard-only user who tabs to the captions button watches the entire control bar (and the open menu)
disappear under them after 3 seconds.**
**Why it matters:** Choosing a subtitle track or audio language is a primary task, and for deaf/HoH users
subtitles are essential, not optional. This makes it unreliable-to-impossible without a mouse.
**Suggested fix:** Keep the control bar visible while focus is within it (don't start the hide timer when
`containerRef` contains `document.activeElement`, or on `focusin`). Make each menu a real
`role="menu"` with arrow-key roving focus, Escape to close + return focus to the trigger, outside-click
close, and `aria-expanded`/`aria-controls` on the trigger. Close other menus on open.

### A16-H4 — Custom div-modals have no focus trap / focus restore / Escape / dialog role
**Severity:** HIGH (SR + keyboard users can interact with content behind the overlay; focus is lost)
**File:** `src/components/ui/ThemeToggle.tsx:196-279` (CreateThemeModal);
`src/app/downloads/components/AddTorrentModal.tsx:146-169`;
`src/components/media/SeriesScopeModal.tsx:312-318`;
`src/app/admin/users/page.tsx:84-95` (reset-password modal);
`src/app/downloads/page.tsx:1020-1033` (UMT settings slide-over).
**What's wrong:** None of these trap focus inside the dialog, none restore focus to the invoker on close,
and most don't close on Escape. AddTorrentModal puts `aria-modal="true"` on a bare `<div>` with **no
`role="dialog"`**, so `aria-modal` is inert. SeriesScopeModal and the two Downloads dialogs have no
dialog role at all. The shared `Modal.tsx` (native `<dialog>` + `showModal()`) and `JoinByCodeModal`
(role=dialog + aria-modal + Escape) get this right — the custom ones diverge from that good pattern.
**Why it matters:** Tab from an open SeriesScopeModal and focus walks into the page behind it; close the
modal and focus is on `<body>`, dumping the keyboard user at the top of the document. This is a baseline
WCAG 2.4.3 / 2.1.2 failure on every acquisition and admin flow.
**Suggested fix:** Route all of these through the existing `Modal` (`<dialog>`) component, which provides
trap + restore + Escape for free, or add a shared focus-trap hook. At minimum add `role="dialog"
aria-modal="true"`, an Escape handler, an initial-focus target, and focus restore on unmount.

### A16-H5 — SeriesScopeModal per-season "checkboxes" are not keyboard-operable and are interactive-inside-interactive
**Severity:** HIGH (keyboard user cannot select seasons in the Episodes scope — blocks a core request path)
**File:** `src/components/media/SeriesScopeModal.tsx:426-457` (the `<span role="checkbox">` inside the
season-header `<button>`)
**What's wrong:** In the Episodes scope, each season row is a `<button>` (the expander), and *nested
inside it* is `<span role="checkbox" onClick=… >` with **no `tabIndex` and no `onKeyDown`**. So (a) it is
not reachable or togglable by keyboard, and (b) a `role="checkbox"` nested inside a `<button>` is invalid
ARIA — a control inside a control. (The standalone `Checkbox` component at lines 72-116 *is* done right
with `tabIndex={0}` + key handler; only the inlined season-header variant is broken.)
**Why it matters:** A keyboard or SR user can expand a season but cannot select-all its episodes, and the
nested interactive element confuses AT focus order. The Episodes request scope is effectively
mouse-only.
**Suggested fix:** Move the season-level checkbox out of the `<button>` (siblings, not nested), reuse the
working `Checkbox` component, and give it `tabIndex`/`onKeyDown` like its sibling. Restructure the row as
`[checkbox] [expander button]` rather than checkbox-inside-button.

### A16-H6 — Async status changes are never announced (no `aria-live` anywhere)
**Severity:** HIGH (SR users get no feedback on the outcome of core actions)
**File:** systemic — verified `grep -r aria-live` returns nothing. Representative sites:
`app/admin/users/page.tsx:84-95` (temp password reveal), `components/party/PartyPanel.tsx:118-146`
(copied / copy-failed), `app/downloads/page.tsx:799-828` (UMT unreachable banner), login/register error
blocks, `SeasonAccordion`/`SeriesScopeModal` load errors.
**What's wrong:** Every result that appears *after* an action — "Temporary Password" generated, "Copied"/
"Copy failed", "UMT unreachable", "Passwords do not match", "New code sent", a torrent delete — is
rendered as plain DOM with no `role="alert"`, `role="status"`, or `aria-live`. A screen-reader user
clicks "Reset PW" and never learns the one-time password was shown; clicks "Copy link" and can't tell if
it worked.
**Why it matters:** Without a live region, the only feedback for a blind user is silence. For the
admin reset-password case the information is *only* shown once, so it is effectively unrecoverable.
**Suggested fix:** Add a shared polite live region (e.g. a `<Toast>`/announcer in the root layout) and
mark inline error/success blocks with `role="alert"` (assertive) or `role="status"` (polite). The
reset-PW dialog and copy-confirmation are the highest priority.

---

## MEDIUM

### A16-M1 — 17 pages hardcode `bg-zinc-950` / `text-white`, bypassing the theme system
**Severity:** MEDIUM
**File:** `app/browse/page.tsx:564`; `app/library/page.tsx:245`; `app/downloads/page.tsx` (gray/zinc
throughout); `app/search/page.tsx`, `app/search/SearchResults.tsx`, `app/requests/page.tsx`,
`app/requests/RequestsTable.tsx`, `app/browse/[id]/page.tsx`, `app/browse/DiscoverResults.tsx`,
`app/browse/discover/[mediaType]/[tmdbId]/page.tsx` + `RequestButton.tsx`, `app/library/[id]/page.tsx`,
`app/admin/quality-profiles/page.tsx`, `app/admin/subtitles/page.tsx`, `app/admin/requests/AdminRequestsClient.tsx`,
`app/settings/profile/ProfileClient.tsx` (grep-confirmed list of 17).
**What's wrong:** The app ships 5 built-in themes + custom themes driven by `--theme-*` / shadcn HSL
tokens (`bg-background`, `text-foreground`, `bg-card`). These pages instead pin literal `bg-zinc-950
text-white` (and Downloads uses Tailwind `gray-*` + `dark:` variants). In the **Light** theme these stay
dark-on-light or light-on-light → contrast failure / unreadable surfaces; under custom themes
(midnight/cinema) the page ignores the user's palette.
**Why it matters:** The theme switcher is a prominent feature; selecting Light then visiting Library or
Downloads yields a broken-looking, low-contrast page (WCAG 1.4.3 risk). It silently makes a shipped
feature look broken.
**Suggested fix:** Replace `bg-zinc-950/900`, `text-white`, `text-zinc-400`, etc. with the token classes
(`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`). For Downloads,
migrate `gray-*`/`dark:` pairs to tokens so custom themes apply.

### A16-M2 — `min-h-screen` set inside the scrolling `<main>` on 9 content pages
**Severity:** MEDIUM
**File:** `app/browse/page.tsx:564`, `app/library/page.tsx:245`, `app/requests/page.tsx`,
`app/search/page.tsx`, `app/browse/[id]/page.tsx`, `app/library/[id]/page.tsx`,
`app/browse/discover/[mediaType]/[tmdbId]/page.tsx`, `app/downloads/page.tsx:724` (auth pages with
`min-h-screen` are fine — they render chromeless).
**What's wrong:** `AppLayout` already wraps page content in `<main className="flex-1 overflow-y-auto p-6
pb-16 md:pb-6">` (`AppLayout.tsx:28`). These pages then declare their own full-height
`min-h-screen` block *inside* that scroll container. The inner `100vh` minimum ignores the header height
and the existing `p-6`, producing extra empty space at the bottom and, with the page's own background,
visually fighting the shell.
**Why it matters:** Causes a slightly-too-tall scroll region (a small dead-scroll band) and compounds the
hardcoded-background issue by painting a full-viewport non-themed rectangle over the shell background.
**Suggested fix:** Drop `min-h-screen` (and the redundant background) from these page roots; let `<main>`
own the height and let the themed shell background show through.

### A16-M3 — MobileNav tap targets are under the 44px minimum and lack `aria-current`
**Severity:** MEDIUM
**File:** `src/components/layout/MobileNav.tsx:22-41`
**What's wrong:** The bar is `h-16` (64px) but each item is `flex-col … px-3 py-2` around a 20px icon +
10px label — the actual hit area per link is roughly 36-40px tall and narrow, below the 44×44 WCAG 2.5.5
/ platform guideline. Active state is conveyed by color only (`text-primary`) with no `aria-current="page"`.
**Why it matters:** This is the *primary* navigation on the stated primary device (phone-as-remote).
Small targets cause misfires; color-only active state fails SR users and low-vision users.
**Suggested fix:** Make each link fill the bar height (`h-full flex-1` + larger touch padding) and add
`aria-current={isActive ? 'page' : undefined}`. Same `aria-current` fix applies to the desktop Sidebar
(`Sidebar.tsx:34-48`).

### A16-M4 — No skip-to-content link
**Severity:** MEDIUM
**File:** `src/components/layout/AppLayout.tsx:22-32` (and root `layout.tsx`)
**What's wrong:** There is no "Skip to content" link before the Sidebar, and `<main>` has no `id`/landmark
target. Every keyboard tab sequence starts by walking the logo + 5 sidebar links + header search + theme
+ account menu before reaching page content — on every navigation.
**Why it matters:** WCAG 2.4.1 (Bypass Blocks). For keyboard and switch users this is a constant tax.
**Suggested fix:** Add a visually-hidden-until-focused `<a href="#main">Skip to content</a>` as the first
focusable element, give `<main id="main">`, and add `role="navigation"` labels to the two navs.

### A16-M5 — Disclosure widgets lack `aria-expanded` / `aria-controls`
**Severity:** MEDIUM
**File:** `src/components/media/SeasonAccordion.tsx:102-123`; `SeriesScopeModal.tsx:420-471` (season
expanders); `src/components/ui/ThemeToggle.tsx:344-351` and `src/components/layout/Header.tsx:51-57`
(dropdown triggers).
**What's wrong:** These are correctly `<button>`s (keyboard-operable — good), but none expose
`aria-expanded` (and the dropdowns lack `aria-haspopup`). A SR user gets no cue that the control reveals
/ hides content, or whether it's currently open.
**Why it matters:** WCAG 4.1.2 — state not exposed. The accordion/dropdown "works" but is opaque to AT.
**Suggested fix:** Add `aria-expanded={isOpen}` (+ `aria-controls` pointing at the panel id) to each
accordion/disclosure button, and `aria-haspopup="menu" aria-expanded={open}` to the Header and
ThemeToggle dropdown triggers.

### A16-M6 — Account & theme dropdowns are not keyboard-dismissible and aren't menu-semantic
**Severity:** MEDIUM
**File:** `src/components/layout/Header.tsx:50-91`; `src/components/ui/ThemeToggle.tsx:343-424`
**What's wrong:** Both close on outside *mousedown* but not on Escape, and there is no focus management
(focus isn't moved into the menu on open, nor restored on close). They're `<div>`s of `<button>`s rather
than `role="menu"`/`menuitem`, so arrow-key navigation isn't available.
**Why it matters:** A keyboard user can open the account menu (Sign Out lives here) but must Tab through
page content to escape it, and can't dismiss it with Escape. Sign-out and theme change are reachable but
clumsy.
**Suggested fix:** Add Escape-to-close + focus restore, move focus to the first item on open, and adopt
the menu/menuitem roles with arrow-key roving focus. The ThemeToggle delete-`X` (opacity-0 until
group-hover) is also mouse-only — see A16-L lists.

### A16-M7 — Downloads UMT settings slide-over: no overlay a11y, hardcoded theme, bare glyph close
**Severity:** MEDIUM
**File:** `src/app/downloads/page.tsx:1020-1033`
**What's wrong:** The settings panel is a `fixed inset-0 z-50` overlay with `bg-zinc-950` hardcoded, no
`role="dialog"`/`aria-modal`, no focus trap, no Escape, and a close control that is the literal text
`✕` in a `<button>` with **no `aria-label`** (SR announces "✕" or nothing useful). The backdrop is a
clickable `<div>` with no role.
**Why it matters:** Opens the entire torrent settings surface; trapping focus and labeling the close are
basic requirements. Combined with the theme bypass it's also visually off under non-dark themes.
**Suggested fix:** Use the shared `Modal`/dialog pattern, add `aria-label="Close"` + an `<X>` icon, trap
focus, support Escape, and switch to theme tokens.

### A16-M8 — Register Step-2 OTP cells are unlabeled; verification errors not announced
**Severity:** MEDIUM
**File:** `src/app/register/page.tsx:396-412`
**What's wrong:** The six code inputs (`digits.map(... <input>)`) have no `aria-label` (e.g. "Digit 1 of
6") and the group has no `role="group"`/label. The error and "code resent" messages (lines 407-412) are
plain text with no `role="alert"`/`aria-live`. (The paste/focus-advance logic is genuinely good — this is
purely the AT layer.)
**Why it matters:** A SR user hears six anonymous "edit text" fields and never hears "Verification failed"
or "New code sent". Account creation is gated on this step.
**Suggested fix:** Add `aria-label={\`Digit ${i+1} of 6\`}`, wrap in a labelled `role="group"`, and give
the status/error blocks `role="alert"` / `role="status"`.

### A16-M9 — `MediaCard` `onClick` variant renders a non-keyboard-operable clickable `<div>`
**Severity:** MEDIUM
**File:** `src/components/media/MediaCard.tsx:38-42,79`
**What's wrong:** When a caller passes `onClick` (instead of `href`), the card returns a bare
`<div className="… cursor-pointer" onClick={onClick}>` with no `role="button"`, no `tabIndex`, and no key
handler — so it cannot be focused or activated by keyboard. The `href` path (the common case) correctly
wraps in `<Link>` and is fine. Callers using the `onClick` form (e.g. carousels/grids that open a panel)
inherit the gap.
**Why it matters:** Any surface using the onClick form presents mouse-only cards. WCAG 2.1.1.
**Suggested fix:** In the `onClick` branch render a `<button>` (or add `role="button" tabIndex={0}` +
`onKeyDown` for Enter/Space) so both variants are operable. Also the poster `<Image>` good — it has an
`alt={title}` already.

### A16-M10 — Admin users table: no empty state, unlabeled select-all, color-only status, color-only role
**Severity:** MEDIUM
**File:** `src/app/admin/users/page.tsx:134-209`
**What's wrong:** (a) When the filtered query returns zero users the `<tbody>` simply renders nothing —
no "No users match" row (contrast with Downloads, which handles empty well). (b) The header select-all
`<input type="checkbox">` (line 142) has no `aria-label`. (c) Status (Active/Suspended) and role
(admin/user) are conveyed by colored pills only; "Active" vs "Suspended" differ in text too (ok) but the
role pill relies on purple vs muted.
**Why it matters:** An admin filtering to a name with no matches sees a blank table and can't tell if it
loaded; SR users get an unlabeled "select all" toggle.
**Suggested fix:** Add an empty-state row, `aria-label="Select all users"` on the header checkbox, and
ensure status/role always carry text (they mostly do).

### A16-M11 — Native `<dialog>` Modal has no `aria-labelledby`; backdrop-only close
**Severity:** MEDIUM
**File:** `src/components/ui/Modal.tsx:24-46`
**What's wrong:** The shared Modal uses a native `<dialog>` (great — gets focus trap + Escape for free),
but the `<dialog>` is not tied to its `<h2>` title via `aria-labelledby`, so AT announces it generically.
The close `<button>` (line 40) has only an `<X>` icon and **no `aria-label`** ("Close"). It also does not
move focus to a sensible first element on open (native `showModal` focuses the first focusable, which is
the unlabeled X).
**Why it matters:** SR users hear "dialog" with no name and an unlabeled close button. Low-effort, broad
impact since this is the shared primitive.
**Suggested fix:** Add `aria-labelledby` referencing the title id (and `aria-label` fallback when no
title), and `aria-label="Close"` on the X button.

### A16-M12 — Player relies on a document-level keydown handler with no focusable player region or visible shortcut affordance
**Severity:** MEDIUM
**File:** `src/components/media/VideoPlayer.tsx:593-711, 982-987`
**What's wrong:** All shortcuts (space/k play, j/l/arrows seek, f fullscreen, m mute, i stats) are bound
on `document` and gated only by "not in an INPUT/TEXTAREA". The player container `<div>` is not focusable
(`tabIndex` absent) and exposes no `role`/`aria-label`, and the `<video>` has no `controls` fallback. So
when focus is anywhere non-input on the page the keys work, but there is no discoverable, focusable
"player" for AT, and on a route that later embeds the player in-page the global listener could swallow
keys. The seek `<input type="range">` and the icon buttons *are* labelled (good).
**Why it matters:** Keyboard works by luck-of-focus rather than by a focused, announced player widget; SR
users get no "video player" landmark and no list of available shortcuts.
**Suggested fix:** Give the container `tabIndex={0}` + `role="region" aria-label="Video player"`, scope
the keydown handler to when focus is within the container (or keep global but document it), and surface a
shortcuts hint. (`/settings/shortcuts` exists — link it from the player.)

### A16-M13 — `window.confirm` / `window.alert`-style native dialogs for destructive actions
**Severity:** MEDIUM
**File:** `src/app/downloads/page.tsx:480-484,697-701`; `src/app/admin/users/page.tsx:62`
**What's wrong:** Torrent delete and bulk delete, and user delete, gate on `window.confirm(...)`. Native
confirms are keyboard-accessible but unstyled/untranslatable, break the visual language, and the torrent
one even embeds an instruction it can't fulfill ("Hold Shift to also delete files — not supported in this
dialog"). They also block the main thread and can be suppressed by "prevent additional dialogs".
**Why it matters:** Inconsistent, can be dismissed/blocked at the browser level, and the confusing copy
risks a user thinking files are being deleted when they aren't.
**Suggested fix:** Replace with the in-app `Modal` confirm pattern (focus-trapped, themed), and drop the
non-functional Shift instruction or wire a real "also delete files" checkbox.

---

## LOW

### A16-L1 — Many icon-only buttons have accessible names, but several don't
**Severity:** LOW
**File:** `src/app/downloads/page.tsx:786-791` (`⚙ Settings` glyph button — relies on `title`, ok-ish but
the `⚙`/`💾`/`✕` glyphs are decorative text), `:1026` (`✕` close, no aria-label);
`MediaToolsPanel.tsx` tab buttons (text — fine). Most lucide buttons elsewhere *do* carry `aria-label`
(player, ThemeToggle, ChatPanel send). This is the residual set.
**What's wrong:** A handful of controls convey meaning through an emoji/glyph or `title` only; `title`
isn't reliably announced and emoji read literally.
**Why it matters:** Minor, scattered SR friction.
**Suggested fix:** Add `aria-label` to the glyph/✕ buttons; mark purely-decorative glyphs `aria-hidden`.

### A16-L2 — Tap targets in the player control bar are ~28-32px
**Severity:** LOW
**File:** `src/components/media/VideoPlayer.tsx:1118-1272` (controls use `p-1` around 20-24px icons)
**What's wrong:** Play/seek/mute/captions/audio/tools/fullscreen buttons are `p-1` (~4px) padding around
`h-5/h-6` icons → ~28-32px hit area, under 44px. On a phone (the stated primary remote use case) these
are fiddly, especially clustered at the bottom-right.
**Why it matters:** WCAG 2.5.5 / touch ergonomics on the main use case.
**Suggested fix:** Bump to `p-2`/`p-2.5` (or `min-h-11 min-w-11`) on the control buttons, at least on
touch breakpoints.

### A16-L3 — Volume slider and reaction bar hidden on mobile with no alternative
**Severity:** LOW
**File:** `src/components/media/VideoPlayer.tsx:1154-1163` (`hidden sm:block` volume), `:1173-1177`
(`hidden sm:block` ReactionBar)
**What's wrong:** The volume `<input range>` and the party ReactionBar are `hidden sm:block`. On phones
volume falls back to hardware keys (reasonable), but the **party reaction bar is simply unavailable on
mobile** — there is no compact reactions affordance, so a phone user in a watch party cannot send
reactions at all.
**Why it matters:** Party play is explicitly designed for phones; reactions are a v1 feature that silently
disappears on the target device.
**Suggested fix:** Provide a mobile reactions entry point (e.g. a small emoji button that opens the bar),
or move ReactionBar into the party panel on small screens.

### A16-L4 — Color-contrast risk: `muted-foreground` and badge text on tinted backgrounds
**Severity:** LOW
**File:** `src/app/globals.css` (`--muted-foreground: 215 20% 55%` dark; light `… 45%`); `Badge.tsx:6-13`
(e.g. `text-green-400` on `bg-green-500/20`, `text-yellow-400` on `bg-yellow-500/20`).
**What's wrong:** `muted-foreground` at ~55% L on the dark `bg-card` is borderline for small text
(~4.0-4.4:1 depending on exact pairing); the `*-400` badge text on a 20%-opacity same-hue background can
dip below 4.5:1, particularly yellow/green. Heavy use of `text-[10px]`/`text-[11px]` (party panel,
MediaCard badges) compounds it since small text needs the full 4.5:1.
**Why it matters:** WCAG 1.4.3 for the many muted captions and status pills, especially at 10-11px.
**Suggested fix:** Spot-check the muted text and `*-400`-on-tint pairings with a contrast tool; nudge
`muted-foreground` darker (light theme) / lighter (dark) and use `*-300`/`*-200` text on the tinted
badges, or raise the badge text size.

### A16-L5 — Focus rings suppressed on several custom controls (`focus:outline-none` without a ring)
**Severity:** LOW
**File:** `src/app/downloads/page.tsx:839` (filter tabs: `focus:outline-none` only), `:1066-1068` (Clear
button), `src/app/admin/users/page.tsx:108,114` (select filters `focus:outline-none`), `EpisodeToolbar.tsx`
selects (no focus style).
**What's wrong:** Some controls strip the native outline with `focus:outline-none` and don't add a
`focus-visible:ring`, so there's no visible keyboard-focus indicator. (The shared `Button`, login, and
register controls do add `focus-visible:ring` correctly — this is the inconsistent subset.)
**Why it matters:** WCAG 2.4.7 — keyboard focus invisible on those controls.
**Suggested fix:** Pair every `focus:outline-none` with `focus-visible:ring-2 focus-visible:ring-ring`
(or `focus-visible:ring-primary`).

### A16-L6 — ThemeToggle "delete theme" control is mouse-only (opacity-0 until hover)
**Severity:** LOW
**File:** `src/components/ui/ThemeToggle.tsx:399-406`
**What's wrong:** The per-custom-theme delete `X` is `opacity-0 group-hover:opacity-100` — it only appears
on mouse hover and there's no focus-visible reveal, so a keyboard user tabbing the menu can focus an
invisible control (and can't see it). It does have an `aria-label` (good).
**Why it matters:** Deleting a custom theme is keyboard-reachable but invisible; minor.
**Suggested fix:** Add `group-focus-within:opacity-100 focus-visible:opacity-100` so it reveals on focus.

### A16-L7 — Submit buttons mostly guard double-submit, but a few async actions don't disable in-flight
**Severity:** LOW
**File:** good: login/register/AddTorrent/AddTorrentForm all disable on `loading`/`isPending`. Gaps:
`src/components/party/PartyPanel.tsx:118-131` (Copy link — fine, idempotent), `ChatPanel.tsx:122-129`
(Send — not disabled while a send is in flight, but sends are fire-and-forget over WS so low risk),
`SeasonAccordion` sort buttons (no in-flight concept). The clearest gap: bulk action buttons in
`admin/users` disable via the shared `actionLoading` but the *per-row* buttons disable **all** rows during
any single action (line 183-197), which is over-broad rather than under-broad.
**What's wrong:** Mostly fine; the admin per-row disable is coarse (one action greys every row's buttons),
which is a minor UX wart, not a correctness bug.
**Why it matters:** Low — no real double-submit hole found on the mutation paths reviewed.
**Suggested fix:** Scope the admin row-button disable to the specific `userId` being acted on rather than
disabling all rows.

### A16-L8 — `<html lang="en">` is static; no per-content language and no reduced-motion handling
**Severity:** LOW
**File:** `src/app/layout.tsx:27`; animations throughout (`animate-spin`, `animate-pulse`,
`hover:scale-105`/`125`, `open:animate-in zoom-in-95`).
**What's wrong:** `lang="en"` is fine for a single-language app. But there is no
`@media (prefers-reduced-motion)` anywhere — the many `animate-*`, hover-scale, and modal zoom/fade
animations always run, including the perpetual spinners and the reaction-overlay motion.
**Why it matters:** WCAG 2.3.3 (Animation from Interactions) for motion-sensitive users; minor here since
most motion is small/transient.
**Suggested fix:** Add a global `@media (prefers-reduced-motion: reduce)` block that neutralizes
transitions/animations (Tailwind `motion-reduce:` variants on the hover-scale and modal-anim utilities).

---

## What works well (so the fixes don't regress it)

- **Loading/empty/error on the major grids:** Library, Browse, Downloads, admin Users all have skeletons
  and empty states; Downloads has a full loading/empty/error trio plus a dedicated mobile card layout
  with 44px buttons and a connection-status indicator.
- **Forms:** login (`login/page.tsx`) and register (`register/page.tsx`) use real `<label htmlFor>`,
  `autoComplete`, password show/hide with `aria-label`, disabled-on-submit, and live client validation —
  a strong baseline to extend (just add the live-region announcements).
- **Modal primitive & JoinByCodeModal:** the native `<dialog>` `Modal` and `JoinByCodeModal`
  (role=dialog + aria-modal + Escape + autoFocus) are the correct pattern the custom modals should adopt.
- **Player resilience:** `onError` wired on `<video>`, themed error overlay with Try Again/Go Back,
  `playsInline`, orientation lock, resume-after-metadata — robust against the documented failure modes.
- Icon buttons in the player, ChatPanel, ReactionBar, and ThemeToggle do carry `aria-label`s.

## Notes / limits

- Did not run an automated contrast checker or a real AT pass; contrast items (A16-L4) are flagged as
  *risks* from token math + small font sizes and should be tool-verified. Marked accordingly.
- Did not exhaustively open all ~51 components; sampled the shared primitives, layout, player, party,
  and the highest-traffic data pages, then grep-verified systemic claims (segment files, `aria-live`,
  theme-bypass list, focus-trap libs, `notFound`, `tabIndex`, dropdown aria).
