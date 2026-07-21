# Unified-Media Full Rust Conversion Plan

Goal is a complete replacement of the TypeScript codebase (~44k lines across Next.js 16 web app, Capacitor Android/TV apps, and backend services) with a Rust-native stack, executed as a strangler-fig migration so the running system on minime never breaks mid-conversion.

Target stack

- Backend services: Axum 0.8 + Tokio, reqwest, serde, sqlx, tracing
- Frontend: Leptos (SSR + WASM hydration, closest analog to the Next.js model)
- Native Android/TV: Tauri 2 mobile wrapping the same Leptos frontend, replacing Capacitor
- Workspace: single cargo workspace monorepo with shared crates

Ground rules for the whole migration

- Every phase cuts over behind the existing API contract. The old TS implementation stays running until the Rust replacement passes parity tests, then the TS code is deleted in the same phase.
- One database, owned by whichever side currently writes to a given table. No dual-write. Schema migrations freeze during each phase's cutover window.
- Every Rust service ships with tracing + a Prometheus /metrics endpoint from day one so it lands in the existing Grafana dashboards.
- Clippy (deny warnings) and rustfmt as pre-commit gates, same discipline as the current lint gates.
- Each new service is a new container behind BunkerWeb. Remember the 1.5.10 multisite rule, hostname-prefixed env vars per service and a bwscheduler restart after every config change.

---

## Phase 0. Groundwork (no user-facing changes)

0.1 Contract extraction. Walk every Next.js API route and document it as an OpenAPI spec, request/response shapes, auth requirements, error codes. This spec is the source of truth for the entire migration. Anything undocumented gets documented or deleted now.

0.2 Parity test harness. Repurpose the planned Vitest work into black-box contract tests that run against a base URL, so the same suite validates the TS implementation today and each Rust service at cutover. Golden-file tests for the gnarly bits, release name parsing, ranking output, TMDB episode group resolution.

0.3 Cargo workspace scaffold.

```
unified-media-rs/
  crates/
    um-models      shared types, serde derives, DB row structs
    um-db          sqlx pool, queries, migrations
    um-config      env/config loading
    um-clients     qBittorrent, TMDB, OpenSubtitles, indexer HTTP clients
  services/
    um-indexer
    um-automation
    um-media
    um-api
  frontend/
    um-web         Leptos app
    um-native      Tauri 2 shell
```

0.4 Database strategy. Point sqlx at the existing schema with compile-time checked queries. Migrations move to sqlx-migrate but the existing schema is the baseline, no schema rewrite during conversion. Schema changes only between phases, never during one.

0.5 CI. GitHub Actions with cargo test, clippy, fmt check, and the contract suite against a docker-compose test stack.

Exit criteria. OpenAPI spec covers 100% of routes, contract suite green against the TS app, workspace compiles, first sqlx queries validated against the real schema.

---

## Phase 1. Indexer service (um-indexer)

The 35-indexer aggregation layer. Most self-contained boundary and the most Rust-shaped workload in the app, concurrent fan-out HTTP, parsing, dedup, ranking.

1.1 Port indexer client definitions to a trait (IndexerClient) with per-indexer implementations. Torznab/Newznab-style clients collapse into one generic implementation with config, custom ones get their own.

1.2 Concurrent fan-out with buffered futures (futures::stream, bounded concurrency), per-indexer timeouts, and circuit-breaker state per indexer so one dead tracker never stalls a scan.

1.3 Port release name parsing and ranking. This is the highest-risk logic port, so it gets golden-file tests generated from real captured TS outputs before a single line is written.

1.4 Quality profile evaluation stays where it is for now (automation calls the indexer), only search/parse/rank moves.

1.5 Cutover. Deploy container, point the TS app's internal indexer calls at um-indexer via env flag, run both in shadow mode for a week (Rust results logged and diffed against TS results on real searches), then flip and delete the TS indexer layer.

Exit criteria. Shadow diff under agreed threshold, contract suite green, TS indexer code deleted.

---

## Phase 2. Automation service (um-automation)

Grab pipeline, TV arc pipeline, stale torrent reaper, duplicate-grab prevention.

2.1 qBittorrent client in um-clients (it is a simple cookie-auth HTTP API, no crate dependency worth taking).

2.2 TMDB client including episode groups (type 5 handling for shows like One Piece). Golden-file tests from captured TMDB responses.

2.3 Port grab decision logic and quality profiles. Same golden-file discipline as ranking.

2.4 Background jobs on tokio intervals (or tokio-cron-scheduler), reaper, retry sweeps, availability refresh. Job runs recorded to the DB for the deep-health endpoint later.

2.5 Duplicate-grab prevention moves to a DB uniqueness constraint plus application check, closing the race window the TS version had to handle in code.

2.6 Cutover. Automation is background-only, so cutover is disabling the TS cron paths and enabling um-automation. Watch Grafana for a full grab lifecycle (search, grab, download, import) before deleting TS.

Exit criteria. One week of real grabs completed end to end by Rust with no manual intervention, TS automation deleted.

---

## Phase 3. Media service (um-media)

HLS transcoding orchestration, session management, VAAPI ffmpeg control, subtitles. Riskiest backend phase because playback is the product.

3.1 Port the three-tier decision logic (remux, audio transcode, full VAAPI) as a pure function with table-driven tests covering every codec/container combination currently handled.

3.2 ffmpeg process management with tokio::process, session structs owning child handles, kill-on-drop so orphaned transcodes cannot outlive sessions.

3.3 Segment serving. Port the path traversal fix as the design, not a patch. Segment paths are opaque IDs mapped server-side to filesystem paths, the strict allowlist regex remains as defense in depth. The vulnerability class should be unrepresentable, not just blocked.

3.4 OpenSubtitles integration and subtitle extraction/conversion.

3.5 Cutover per client. Web player first (flip stream base URL via env), then native apps once stable. Keep the TS media routes alive as fallback for two weeks since playback regressions are the ones Brittany notices mid-episode.

Exit criteria. Direct play, remux, audio transcode, and full VAAPI all verified on web + Android + TV, seek/resume/subtitle switching parity, TS media routes deleted.

---

## Phase 4. Core API (um-api)

Everything remaining server-side. Auth integration (Authentik forward-auth headers plus session handling), library/metadata endpoints, watch state, requests/grab-confirmation flow, availability badges, Downloads page API, WebSocket party play, deep-health.

4.1 Port route by route against the OpenAPI spec. This is the long grind phase, mostly mechanical, ideal Claude Code territory with the contract suite as the accept gate per route group.

4.2 Party play on axum's native WebSocket support, room state in a tokio task per room with mpsc channels, same message protocol so mid-migration clients keep working.

4.3 deep-health endpoint aggregating DB, qBittorrent, indexer health, job recency, disk headroom. Wire into the existing Prometheus alerting.

4.4 Cutover route group by route group at the BunkerWeb/Caddy layer, path-prefix routing shifting from the Next.js container to um-api. Next.js keeps serving pages and proxying nothing once this phase completes.

Exit criteria. Next.js serves zero API routes, contract suite fully green against Rust, all TS backend code deleted.

---

## Phase 5. Frontend (um-web, Leptos)

At this point the TS surface is only UI. This is the phase with the least performance payoff and the most work, and it is where "building in Rust for its own sake" is doing all the justification. Worth stating plainly in the doc so future-you remembers it was a deliberate choice.

5.1 Leptos SSR + hydration app, Tailwind via the standard Leptos/Tailwind pipeline so existing class names and design mostly transfer.

5.2 Port order by risk. Static/simple pages first (settings, downloads), then library browse/detail, then search + request flow with the grab confirmation and availability badges, player page last since it is mostly wrapping hls.js via wasm-bindgen (keep hls.js, do not rewrite HLS playback in Rust/WASM, the browser JS interop is the pragmatic call).

5.3 localStorage-persisted preferences (sortable Downloads columns) port via web-sys.

5.4 Run both frontends in parallel on separate hostnames during the port (app.minijoe.dev stays Next.js, rs.minijoe.dev is Leptos) so nothing is broken while pages migrate. Flip DNS/routing when parity is reached.

Exit criteria. Every page and flow reachable and functional in Leptos on desktop + mobile web, Next.js container removed from the compose stack.

---

## Phase 6. Native apps (um-native, Tauri 2)

Replace Capacitor. Tauri 2 mobile wraps the Leptos frontend in a system webview with a Rust host process, which keeps one UI codebase.

6.1 Android phone build first, port whatever Capacitor plugins are actually in use to Tauri plugin equivalents or custom Rust commands.

6.2 Android TV. This is the least-proven corner of the whole plan. Tauri on Android TV means validating leanback launcher integration, D-pad focus navigation in the webview, and remote input early, in week one of this phase, not at the end. If it fails validation, the documented fallback is keeping a thin Capacitor shell pointed at the Leptos web app for TV only. That is a contained compromise, not a plan failure.

6.3 Cutover. Side-load Tauri builds alongside Capacitor ones, run both until the Tauri versions survive normal daily use, then retire Capacitor.

Exit criteria. Phone and TV apps in daily use on Tauri builds, Capacitor projects archived.

---

## Phase 7. Decommission and hardening

7.1 Remove Node from every image, final compose cleanup, BunkerWeb host config pass (with the bwscheduler restart), update verify-stack.sh checks for the new containers.

7.2 Full-stack parity run, contract suite, verify-stack, one complete grab-to-playback lifecycle on every client.

7.3 Docs pass. CLAUDE.md rewritten for the Rust workspace, build guide addendum, ADR-style note recording why the conversion was done and what the measured before/after actually was (idle RAM per container, image sizes, cold start, scan latency).

7.4 Tag the last TS commit, archive the branch, delete.

---

## Cross-cutting notes

Sequencing rationale. Backend first because Axum/Tokio is the mature end of Rust and each service is a contained, reversible bet. Frontend and native last because Leptos and Tauri mobile are the raw end, and by then you will have real Rust fluency from phases 1 through 4 instead of learning the borrow checker inside a WASM signal graph.

Learning curve placement. Phase 1 is deliberately the teaching phase, traits, async, error handling with thiserror/anyhow conventions get established there and every later phase copies the patterns. Expect phase 1 to feel slow and everything after it to accelerate.

Honest scope statement. This is a rewrite of a system that took multiple phases over months to build, executed around a full-time job, coursework, the internship, and the org. Run it as strictly sequential phases with the app fully working between each one, and treat any phase as pausable for a semester without the project rotting, which the strangler-fig structure guarantees. The two places most likely to eat unplanned weeks are ranking-logic parity in phase 1 and Android TV in phase 6, both flagged above with their mitigations.

What gets measured. Capture baseline numbers before phase 1 (per-container idle RSS, image sizes, indexer scan wall time, API p95s from Grafana) so the end-state comparison in 7.3 is real data, not vibes.
