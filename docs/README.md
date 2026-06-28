# unified-frontend docs

Documentation for the unified-frontend / unified-media project. `CLAUDE.md` at the repo root is the
**lean entry point** an agent reads first; this tree holds the detail that would otherwise bloat it.

## Conventions

- **Diátaxis-ish split** by *status*, not just topic: `analysis/` (research/audits), `complete/`
  (shipped-feature history), `incomplete/` (open work), plus topic folders `player/` and `features/`
  for deep-dives that are still live reference.
- **SemVer, PATCH before MINOR.** Bump `0.0.x` for feature batches, `0.x.0` only for a milestone.
- **Keep a Changelog.** `CHANGELOG.md` at the repo root; new work goes under `[Unreleased]`.
- **Docs-as-code.** When a feature ships: add it to `complete/FEATURES.md`, add a `CHANGELOG.md` entry,
  remove it from `incomplete/BACKLOG.md`, and leave a short pointer in `CLAUDE.md` (move the deep-dive
  here).

## Map

| Path | What |
| ---- | ---- |
| `analysis/audit-2026-06-13-summary.md` | The 21-agent audit (closed) + remediation status |
| `complete/FEATURES.md` | Shipped-feature index: build phases, independence build, party play, subtitle search, request system |
| `incomplete/BACKLOG.md` | Remaining work + future ideas |
| `player/player-tools.md` | Player tool components + Web Audio chain |
| `player/quality-resolution.md` | Quality option building, switching, aspect ratio, screen-aware tiers |
| `player/chrome-orientation.md` | Chrome suppression, fullscreen/orientation, resume-seek, error handling |
| `player/audio-subtitles.md` | Embedded subs → WebVTT, audio switching, language defaults, on-demand subtitle search |
| `features/torrent-system.md` | qBittorrent client UI, types, proxy, endpoint catalogue, settings tabs |
| `features/party-play.md` | Watch-together: architecture, protocol, sync, queue, audit, edge test |
| `features/decision-engine.md` | Hard gates + custom formats in the grabber |

The original full-text per-section content also lives in git history if a condensed pointer ever loses
a detail you need.
