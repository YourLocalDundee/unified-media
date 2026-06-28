# Video Player — Chrome, Orientation, and Error Handling (v0.9.3)

## App chrome suppression

`AppLayout` (`src/components/layout/AppLayout.tsx`) checks `usePathname()` on every navigation and
skips rendering `Sidebar`, `Header`, and `MobileNav` for player routes:

```
const isWatchPage = pathname?.startsWith('/watch/') || pathname?.startsWith('/play/')
```

Both `/watch/[id]` and `/play/[id]` bypass the full app shell. **If a new player route is added it
must be listed here**, otherwise `MobileNav` (fixed `bottom-0 z-50`) renders on top of the player
controls (z-20) and all bottom controls become unreachable on mobile.

## Fullscreen and screen orientation

`toggleFullscreen` in `VideoPlayer.tsx` is `async` to satisfy the Android orientation-lock ordering
constraint:

1. `await container.requestFullscreen()` — resolves only after the element is fully in fullscreen.
   Android Chrome requires this before `screen.orientation.lock`.
2. `await screen.orientation.lock('landscape')` — after fullscreen is confirmed. Wrapped in try/catch;
   throws `NotSupportedError` on iOS Safari and desktop, which must not interrupt playback.
3. iOS fallback: if `requestFullscreen` throws (div not supported), call `video.webkitEnterFullscreen()`
   if present, then attempt the orientation lock (throws + caught on iOS).

On exit, `screen.orientation.unlock()` runs before `exitFullscreen` so the device returns to natural
orientation. `handleBack` also unlocks before `router.back()`.

Fullscreen state is tracked via both `fullscreenchange` and `webkitfullscreenchange`, checking both
`document.fullscreenElement` and `document.webkitFullscreenElement`. Without the webkit variant
`isFullscreen` is always false on iOS and the Maximize/Minimize button never toggles correctly.

## Resume seek and loadedmetadata

The resume position (`resumePositionTicks`) is applied in `handleLoadedMetadata` — **not** in the init
effect. Setting `video.currentTime` before `loadedmetadata` fires causes seek stalls on MKV and other
containers where the seek index (Cues element for MKV, moov atom for late-faststart MP4) needs extra
range requests before the timestamp resolves. The `resumeApplied` ref guards double-application on
quality switches.

```
Init effect: video.src = url            → browser fetches initial bytes
loadedmetadata fires                    → browser knows duration + seek table
handleLoadedMetadata: video.currentTime → browser seeks cleanly
```

For HLS the same `loadedmetadata` handler fires after `MANIFEST_PARSED` triggers native playback.

## Video element error handling

The `<video>` element fires `error` on the DOM element — it does **not** bubble as a React event and
is not caught by try/catch around `video.play()`. Without `onError` wired, any failure leaves an
infinite spinner: `handleWaiting` sets `isLoading = true`, the error fires with no handler, and
`isLoading` never clears.

`handleVideoError` reads `video.error.code`:

| Code | Meaning | Message |
| ---- | ------- | ------- |
| 2 | MEDIA_ERR_NETWORK | Network error — check connection |
| 3 | MEDIA_ERR_DECODE | Unsupported codec |
| 4 | MEDIA_ERR_SRC_NOT_SUPPORTED | Format not playable — try lower quality |
| other | Unknown | File may be missing on server |

The handler calls `setIsLoading(false)` + `setError(message)`, replacing the spinner with an error
overlay + retry path.

## Series containers and /play routing

The scanner (`src/lib/media-server/scanner.ts`) creates series container rows in `media_items` with
`file_path = NULL` — FK targets for `series_id`, no playable file. Any link to `/play/${series_id}`
throws in `getNativePlaybackData` on the `!item.file_path` guard.

Safety net in `play/[id]/page.tsx`: if `getNativePlaybackData` throws and the item type is `series`,
the page `redirect('/browse/${id}')` instead of `notFound()`. Upstream prevention:

- `browse/[id]/page.tsx` Watch Now resolves to an episode target via `getSeriesResumeEpisode` /
  `episodes[0]`, never linking series container IDs to `/play/`.
- `page.tsx` Recently Added uses `item.type === 'series' ? /browse/${id} : /play/${id}`.

**`getSeriesResumeEpisode(userId, seriesId)`** (`src/lib/media-server/library.ts`) joins `media_items`
and `media_watch_state` to find the most recently updated in-progress episode (played=0,
position_ticks>0, ordered by updated_at DESC). Returns `undefined` if none started → `episodes[0]`
fallback.
