# Video Player — Quality & Resolution System

## How quality options are built (server-side)

`getPlaybackData()` in `src/lib/jellyfin/playback.ts`:

1. Extracts native resolution from `MediaSources[0].MediaStreams` (video track `Width`/`Height`).
2. Stores `nativeWidth`, `nativeHeight` on `PlaybackData`.
3. Builds `availableQualities: QualityOption[]`:
   - First element: `{ label: 'Direct Play' | 'Auto', isDirect: true, streamUrl: <original> }`.
   - Remaining: standard tiers `[4K, 1080p, 720p, 480p, 360p, 240p]` **filtered to only tiers strictly
     below `nativeHeight`** — never offers upscaling.
   - Each lower-quality URL is built by setting `MaxWidth`, `MaxHeight`, `VideoBitrate` on
     `hlsTranscodeUrl`.
4. Always computes `hlsTranscodeUrl` — if Jellyfin returns a `TranscodingUrl`, uses it; otherwise
   constructs a manual HLS URL with `h264`/`aac` params so quality switching is available even for
   direct-play content.

## Quality switching in VideoPlayer (client-side)

- `activeStreamUrl` / `activeIsHls` state replace `props.streamUrl` / `props.isHls` in the HLS init
  effect.
- Changing quality: `setActiveStreamUrl(quality.streamUrl)` + `setActiveIsHls(quality.isHls)` +
  `setRetryCount(c => c + 1)` — the retryCount increment triggers HLS reinitialization.
- `MediaQualitySelector` dropdown appears between the time display and the Sliders button; hidden if
  `availableQualities.length <= 1`.

## Auto aspect ratio

On mount, `detectAspectRatio(nativeWidth, nativeHeight)` maps the native AR to the closest
`AspectRatioMode` within a tolerance of 0.15. If none is close enough, falls back to `'auto'` (CSS
`object-fit: contain`).

| Mode | Ratio |
| ---- | ----- |
| `16:9` | 1.778 |
| `4:3` | 1.333 |
| `21:9` | 2.333 |
| `2.35:1` | 2.350 |
| `1:1` | 1.000 |
| `9:16` | 0.5625 |

## Screen-aware quality selection

On mount, if `window.screen.height × devicePixelRatio < nativeHeight × 0.75`, the player auto-selects
the highest quality tier that fits the screen (avoids streaming 4K to a 1080p screen). The 75%
threshold prevents an unnecessary downgrade when the difference is small.
