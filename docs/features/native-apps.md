# Native Phone + TV Apps (Capacitor)

Turns Unified Media into an installable phone app (Android + iOS) and, eventually, a real app on
Android TV/Fire TV/Google TV plus Chromecast casting. **6-phase plan, only Phase 1 shipped so
far** (2026-07-14). Full phase-by-phase design (file-level detail, cost/effort table, spikes to
run before deeper investment) lives at `/home/minijoe/.claude/plans/sorted-riding-popcorn.md` —
this doc is the condensed, durable version of what actually landed.

## Architecture: one app, thin delivery shells

The Next.js site (`unified.minijoe.dev`) stays the single source of truth. Phone/TV "apps" are
Capacitor shells whose WebView is pointed at the **live production URL** via `server.url` in
`capacitor.config.ts`, instead of loading a bundled static build. Consequences, all deliberate:

- The WebView's cookie jar and `Origin` header are indistinguishable from mobile Chrome/Safari
  hitting `unified.minijoe.dev` — the existing cookie-session auth (`src/lib/dal.ts`) and CSRF
  check (`verifyOrigin()` in `src/lib/csrf.ts`, which allowlists `NEXT_PUBLIC_APP_URL`) work
  **completely unmodified**. No auth rework for phone/TV wrappers themselves.
- Ordinary web deploys are instantly live in every installed app — no APK/IPA rebuild needed
  except for shell-level changes (plugins, icons, native-bridge code).
- Only **Chromecast** (Phase 5, not started) breaks this pattern: a physical Cast receiver device
  fetches media URLs itself and can't send the app's HttpOnly cookie, so it needs a narrow
  HMAC-signed per-media-id query token — additive to the cookie check, not a replacement, and
  explicitly not the site-wide trusted-header auth CLAUDE.md's auth-strategy section forbids.

## Phase 1 — Android phone wrapper (Capacitor) — SHIPPED, emulator-verified 2026-07-14

**New directory, sibling to `app/`, outside the Docker build context:**
```
/home/minijoe/dev/unified-frontend/
  app/            # existing Next.js app — untouched, still the sole Docker build context
  native/         # Capacitor project root (own package.json, only @capacitor/* deps)
    capacitor.config.ts
    android/      # generated via `npx cap add android`
```
`docker-compose.fragment.yml`'s build context is pinned to `app/`, so `native/` never triggers a
web rebuild and vice versa — the `deploy-unified-frontend` skill needed zero changes.

**`native/capacitor.config.ts`:** `appId: dev.minijoe.unified`, `appName: Unified Media`,
`server: { url: 'https://unified.minijoe.dev', cleartext: false }`. Capacitor still requires a
non-empty `webDir` to scaffold platform projects even though it's unused at runtime in `server.url`
mode — `native/www/index.html` is a placeholder with a comment explaining why.

**Web-side integration (the non-obvious part):** in `server.url` mode the WebView loads the site's
own JS bundle, not anything from `native/` — so any native-shell *behavior* (not just config) has
to live in `app/`, not `native/`. That's why `@capacitor/core` + `@capacitor/app` are dependencies
of **`app/package.json`**, not just `native/package.json`. New file
`app/src/components/native/NativeAppBridge.tsx`: a stateless client component (mounted once in
`app/src/app/providers.tsx`, alongside `AuthProvider`) that no-ops entirely in a normal browser tab
(`Capacitor.isNativePlatform()` guard) and, only inside the native shell, wires the Android
hardware back button to `window.history.back()` / `CapacitorApp.exitApp()` — needed because relying
on the WebView's own default back-history behavior silently breaks the moment an SPA route change
doesn't produce a real history entry (e.g. a `router.replace()`).

**Icons/splash:** generated via `@capacitor/assets` from the existing
`app/public/icons/icon-512.png` (the same source the PWA manifest uses — see
`docs/features/pwa-notifications.md`) — no new art asset needed.

**Build toolchain installed on the dev machine (2026-07-14, machine-local, not project state):**
Android SDK cmdline-tools at `~/Android/Sdk` (`platforms;android-36`, `build-tools;36.0.0` — matched
to what `native/android/variables.gradle` requires), plus a scoped JDK 21 (Temurin) at
`~/.jdks/jdk-21.0.11+10` pinned **only for Gradle** via `org.gradle.java.home` in
`~/.gradle/gradle.properties` (the system `java` is a 25-ea preview build; Gradle 8.14/AGP 8.13,
this project's versions, only support up to Java 24 — build fails with `Unsupported class file
major version 69` without the pin). None of this touches the system's default `java`.

`./gradlew assembleDebug` (from `native/android/`) — **verified BUILD SUCCESSFUL**, producing
`native/android/app/build/outputs/apk/debug/app-debug.apk`.

### Emulator verification (2026-07-14)

Full toolchain + testing workflow is a repo skill now:
**`.claude/skills/test-unified-android/SKILL.md`** — build, boot a headless Android emulator, drive
it via `adb` tap/type/screenshot (no display server needed), teardown. Use that skill rather than
re-deriving any of this.

Every item in the plan's Phase 1 verification checklist passed on the emulator:
- Real cookie-session login against production (admin credentials from `app/.env.local`)
- Dashboard/library data loaded correctly
- Genuine hardware-decoded H.264 video + audio playback (confirmed via `Codec2Client`/
  `AAudioStream` activity in logcat, not just a static player UI)
- Android hardware back button correctly navigated within the SPA history instead of exiting or
  breaking (confirms `NativeAppBridge.tsx`)
- Party-play "Join watch party" dialog opened and accepted input correctly

One cosmetic non-issue spotted, not a regression: a couple of very new 2026 titles render blank
poster tiles in "Recently Added" — no image-loading errors in logcat, almost certainly missing TMDB
poster art for unreleased titles (same as it'd look in a browser), not a native-shell bug.

**Not yet done:** testing on a real physical Android phone (the emulator was to unblock testing
immediately; a physical-device pass is still expected before calling Phase 1 fully closed).

## Phases 2–5 — not started

Full detail for each is in the plan file; summarized here only so this doc stays a durable index:

| Phase | What | Status | Key gate |
| ----- | ---- | ------ | -------- |
| 2 | iOS phone wrapper | Not started | $99/yr Apple Developer cost decision + a spike: does WKWebView/AVPlayer forward the session cookie on HLS segment requests (historically finicky) |
| 3 | `/tv` route (D-pad spatial nav + player rework) | Not started | The dominant remaining engineering lift — not just a CSS breakpoint, needs a real LRUD focus system and reconciling `VideoPlayer.tsx`'s existing mouse/touch keydown handler (~lines 773–909) |
| 4 | Android TV / Fire TV / Google TV APK | Not started | Thin once Phase 3 exists — second Capacitor build target + `LEANBACK_LAUNCHER` intent-filter |
| 5 | Chromecast casting | Not started | New backend: signed per-media-id stream token, manifest segment-URI rewrite (relative URIs don't inherit the parent request's query string), custom Cast receiver, $5 Cast SDK dev registration |
| 5b | AirPlay (iOS→Apple TV) | Not started | Near-zero cost once Phase 2 ships — native `<video>` AirPlay support is basically free |

## Related docs

- `.claude/skills/test-unified-android/SKILL.md` — build/boot/drive/teardown workflow for testing
  the Android wrapper.
- `docs/features/pwa-notifications.md` — the existing installable-PWA path (already shipped,
  separate from this Capacitor effort; the two are complementary, not redundant — PWA installs from
  a browser with zero native tooling, Capacitor gives a real APK/IPA with native APIs).
- `/home/minijoe/.claude/plans/sorted-riding-popcorn.md` — the original full plan (architecture
  rationale, file-level design for every phase, cost/effort table).
