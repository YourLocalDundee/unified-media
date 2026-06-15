# Audit 18 — Deployment / Runtime / Infra, Repo Hygiene, WebSocket Wiring

READ-ONLY cross-cutting pass. Repo: `/home/minijoe/dev/unified-frontend` (branch `feat/party-play`).
Stack: Next.js 16 standalone, React 19, better-sqlite3, node-cron, chokidar, `ws` (party play on dedicated port 3002), Docker behind BunkerWeb + Caddy.

## Summary

The runtime init in `app/src/instrumentation.ts` is correctly guarded against double-registration: every background subsystem (automation cron, subtitle cron, chokidar scanner, party WS server) uses a module-level or `globalThis`-pinned "started" flag, and `register()` only runs in the Node runtime. The party-play WebSocket design (dedicated `ws` server on port 3002 in the same process, `globalThis` store singleton) is sound and matches the documented architecture in CLAUDE.md §16. Repo hygiene is good: `.env.local`, `unified.db`, `tsconfig.tsbuildinfo`, `app-backup-2026-05-26-1127/`, `sources/`, and `node_modules` are all correctly gitignored and NOT tracked.

The serious problems are in the deploy surface, not the application code. (1) The committed Docker healthcheck calls `curl`, which is not installed in the runner image, so the container will report **unhealthy forever**. (2) The committed `caddy.fragment` and `docker-compose.fragment.yml` are **stale** — they have no `/api/party/ws` route and no path to port 3002, so a deploy built from the repo's own reference files has party play broken at the edge (the working config exists only as prose in CLAUDE.md). (3) **No SIGTERM/graceful-shutdown handler exists anywhere** — cron, chokidar, ws sockets, in-flight ffmpeg, and the SQLite handle are all hard-killed on `docker stop`. (4) Transcoding infra is under-provisioned in compose: no `/dev/dri`, no render `group_add`, no `/transcode` volume, `TRANSCODE_CACHE` defaults to ephemeral `/tmp`, and `mem_limit: 512m` is far too low for ffmpeg. (5) CSP `connect-src` hardcodes `wss://unified.minijoe.dev` + `ws://localhost:3002` in `next.config.ts`, so any other deploy hostname is CSP-blocked from connecting the party socket. The 73 MB standalone trace is confirmed but is driven by `@img`/sharp (33 MB) + `next` (16 MB), **not** `transcode.ts` as a sibling audit claimed.

## Counts by severity

| Severity | Count |
|---|---|
| Critical | 2 |
| High | 4 |
| Medium | 6 |
| Low | 5 |
| Info / Positive | 4 |
| **Total** | **21** |

---

## Critical

### A18-C1 — Docker healthcheck calls `curl`, which is not installed in the runner image
- **Severity:** Critical
- **Path:** `app/docker-compose.fragment.yml:17` (healthcheck) + `app/Dockerfile:15-18` (runner apt install)
- **What's wrong:** The compose healthcheck is `test: ['CMD', 'curl', '-f', 'http://localhost:3001/api/health']`. The runner stage is `node:24-slim` and the only apt packages installed are `ffmpeg` and `intel-media-va-driver` (`app/Dockerfile:15-18`). `node:*-slim` does not ship `curl`. The `CMD` exec form does not use a shell, so there is no fallback. Every probe will fail with "executable file not found".
- **Why it matters:** The container start_period is 40s; after that the container is permanently marked `unhealthy`. Anything keying on health (compose `depends_on: condition: service_healthy`, watchtower/monitoring, manual `docker ps` triage) will treat a perfectly working app as broken, and an orchestrator may restart-loop it. The `/api/health` route itself (`app/src/app/api/health/route.ts`) is well written and returns 200/503 correctly — the failure is purely the missing client binary.
- **Suggested fix:** Either add `curl` (or `wget`) to the runner apt install line, or switch the healthcheck to a Node one-liner that needs no extra binary, e.g. `test: ['CMD', 'node', '-e', "fetch('http://localhost:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]`. Prefer the Node form (no image bloat, no new attack surface).

### A18-C2 — Committed Caddy + compose fragments are stale: party-play WebSocket has no edge route or port path
- **Severity:** Critical
- **Path:** `app/caddy.fragment:1-4`, `app/docker-compose.fragment.yml:1-27`
- **What's wrong:** Party play needs the edge to route `wss://.../api/party/ws` to the internal `:3002` WS server (CLAUDE.md §16 shows the required block with `@partyws path /api/party/ws*` → `unified-frontend:3002`). The committed `caddy.fragment` is the old single-line `reverse_proxy unified-frontend:3001` with no `/api/party/ws` matcher and no 3002 upstream. `grep` for `3002|party|ws|Upgrade` across both fragments returns nothing. The compose fragment also publishes no host port and relies on container DNS (fine), but it documents nothing about 3002.
- **Why it matters:** The only record of the working edge config is prose in CLAUDE.md. Anyone re-deriving Caddy from the repo's own reference fragment (or the `scripts/update-caddyfile.py` helper that consumes it) will ship a Caddyfile where `/api/party/ws` falls through to :3001, Next.js destroys the unrecognized upgrade, and party play silently fails in production. The fragments are the source of truth that drift has invalidated.
- **Suggested fix:** Update `app/caddy.fragment` to the two-route block from CLAUDE.md §16 (matcher to `:3002`, default to `:3001`). Add a comment in `docker-compose.fragment.yml` noting both ports are reached over compose DNS. Keep the committed fragments and the live Caddyfile in lockstep so the reference is deployable as-is.

---

## High

### A18-H1 — No graceful shutdown (SIGTERM/SIGINT): cron, chokidar, ws, ffmpeg, and SQLite are hard-killed
- **Severity:** High
- **Path:** `app/src/instrumentation.ts` (no signal handlers); confirmed absent across `app/src/lib/party/server.ts`, `app/src/lib/automation/scheduler.ts`, `app/src/lib/subtitle/scheduler.ts`, `app/src/lib/media-server/scanner.ts`
- **What's wrong:** `grep -rn "SIGTERM|SIGINT|process.on"` over the init modules finds nothing. On `docker stop` (SIGTERM, then SIGKILL after the grace period) nothing closes the chokidar watcher, stops the cron jobs, drains the `ws` server, kills the in-flight ffmpeg children that `transcode.ts` tracks in its `activeJobs` registry (`app/src/lib/media-server/transcode.ts:87`), or runs a final party checkpoint / `db.close()`. Compounding it, none of the subsystems are even reachable from a handler today: the four automation crons and two subtitle crons discard their `cron.schedule(...)` return handles (no variable capture, so no `.stop()` target — `scheduler.ts:32,44,54,60`, `subtitle/scheduler.ts:19,30`), and the chokidar `watcher` is a module-private `let` with no exported close (`scanner.ts:16`).
- **Why it matters:** Party position is only checkpointed to SQLite on a throttle (`CHECKPOINT_THROTTLE_MS = 12s`) and on pause/seek/join — a stop mid-playback loses up to ~12s of position and connected clients get a hard socket reset instead of a clean `party_ended`/close. ffmpeg children are tracked in `activeJobs` but nothing iterates and kills them on shutdown, so a `docker stop` during a transcode can orphan ffmpeg until SIGKILL. better-sqlite3 in WAL mode is crash-safe so DB corruption is unlikely, but a clean `db.close()` would checkpoint the WAL. No active socket draining means the 30s grace logic never runs on intentional restarts.
- **Suggested fix:** Add a `SIGTERM`/`SIGINT` handler (in `instrumentation.ts` or a small `lib/shutdown.ts`) that: stops the cron tasks, `await watcher.close()`, closes the WS server and terminates live sockets with code 1001, iterates `activeJobs` to kill tracked ffmpeg children, runs one forced party checkpoint, then `db.close()` and `process.exit(0)`. This first requires light refactors to make the subsystems reachable: capture each `cron.schedule` handle into an exported array, and export the `watcher` (or a `closeWatcher()`) from `scanner.ts`.

### A18-H2 — Transcoding infra not provisioned in compose: no /dev/dri, no render group, no /transcode volume, ephemeral cache
- **Severity:** High
- **Path:** `app/docker-compose.fragment.yml:13-15` (volumes/mem) vs `app/src/lib/media-server/transcode.ts:7-12, 56-60` and `app/Dockerfile:24-33`
- **What's wrong:** `transcode.ts` Tier C does full VAAPI (`h264_vaapi`) against `VAAPI_DEVICE` default `/dev/dri/renderD128` and its header documents the device must be bind-mounted with the process in group 990 (render). The compose fragment mounts only `unified-db:/data` — no `devices: [/dev/dri]`, no `group_add: ['990']`/`render`. The Dockerfile declares `VOLUME ["/data","/transcode"]` and creates `/transcode`, but compose mounts nothing there, and `TRANSCODE_CACHE` defaults to `/tmp/transcode` (the code comment explicitly says set it to a named volume in production). `mem_limit: 512m` is well below what an ffmpeg HLS transcode needs.
- **Why it matters:** As shipped from compose, Tier C (HEVC/VP9/AV1 → HLS, the path party play uses for non-h264 audio switching) will fail to open the VAAPI device and exit non-zero (the code says there is no CPU fallback). Even Tier A/B remux output lands in `/tmp` inside the container, lost on restart and counted against the 512 MB limit, so the LRU cap and `/transcode` volume are both inoperative. ffmpeg under a 512 MB cgroup can OOM-kill the whole Node process mid-transcode.
- **Suggested fix:** In the compose fragment add `devices: ['/dev/dri/renderD128:/dev/dri/renderD128']`, `group_add: ['990']` (confirm the host render gid), mount a named volume at `/transcode`, set `TRANSCODE_CACHE=/transcode` in `environment:`, and raise `mem_limit` (or drop it) to allow ffmpeg headroom. Verify the host's `/dev/dri` render group id before pinning 990.

### A18-H3 — CSP connect-src hardcodes the production WS origin; non-default hostnames are blocked
- **Severity:** High
- **Path:** `app/next.config.ts:39`
- **What's wrong:** `connect-src 'self' http://ip-api.com wss://unified.minijoe.dev ws://localhost:3002`. The party socket URL is computed at runtime per environment (`app/src/lib/party/socket-url.ts`) and the WS-origin allowlist is env-driven (`allowedWsOrigins()` reads `NEXT_PUBLIC_APP_URL`), but the browser-enforced CSP that must *permit* the connection is a static literal. `ws://localhost:3002` is a dev-only value baked into the production header.
- **Why it matters:** Any deployment that is not literally `unified.minijoe.dev` (rename, staging host, second instance, IP access) will have the WS handshake blocked by CSP before it leaves the browser — party play breaks with an opaque console error and no server-side trace. The leftover `ws://localhost:3002` also slightly widens prod CSP for no production benefit. It is also a single-source-of-truth violation against `NEXT_PUBLIC_APP_URL`.
- **Suggested fix:** Build `connect-src` from `process.env.NEXT_PUBLIC_APP_URL` inside `next.config.ts` (derive the `wss://<host>` and, in dev only, the `ws://<host>:3002`). Gate the localhost entry on `NODE_ENV !== 'production'`. Keep it consistent with `allowedWsOrigins()` and `getPartySocketUrl()`.

### A18-H4 — `.env.local.example` is stale/misleading vs the real env contract (download-client keys, AUTH_SECRET)
- **Severity:** High
- **Path:** `app/.env.local.example` (keys `QBIT_URL`/`QBIT_USERNAME`/`QBIT_PASSWORD`, `AUTH_SECRET`) vs `app/.env.local` + CLAUDE.md §3/§8 (`UMT_URL`/`UMT_USERNAME`/`UMT_PASSWORD`, no `AUTH_SECRET`)
- **What's wrong:** The committed example advertises `QBIT_*` for the download client and an `AUTH_SECRET`. The actual runtime contract (per the live `.env.local` key set and CLAUDE.md) is `UMT_*` for the download client (read by `src/lib/download-client/config.ts`), plus `DOWNLOAD_CLIENT`, and there is no `AUTH_SECRET` in use (sessions are random IDs, not signed). The example also omits the *arr keys (`SONARR_*`, `RADARR_*`, `PROWLARR_*`, `BAZARR_*`), `SMTP_*`, and `EMAIL_VERIFICATION_REQUIRED` that the real config carries.
- **Why it matters:** `.env.local.example` is the onboarding contract. A fresh deploy that copies it will set `QBIT_*`, which nothing reads, leaving the download client unconfigured (`DOWNLOAD_CLIENT` defaults to `umt` and looks for `UMT_*`), and will set a no-op `AUTH_SECRET`. Misconfiguration is silent until torrent operations fail.
- **Suggested fix:** Regenerate `.env.local.example` from the documented variable set (CLAUDE.md §8 "Running locally" + §14 independence build env table): rename `QBIT_*` → `UMT_*`, add `DOWNLOAD_CLIENT`, drop `AUTH_SECRET`, and include the *arr, SMTP, and verification keys with placeholder values. Do not commit any real values.

---

## Medium

### A18-M1 — `.dockerignore` is minimal; local DB and tsbuildinfo enter the build context
- **Severity:** Medium
- **Path:** `app/.dockerignore` (4 lines: `node_modules`, `.next`, `.env*.local`, `npm-debug.log*`)
- **What's wrong:** The build context is `app/` (per compose `context: .../app`). `.dockerignore` excludes `node_modules`, `.next`, and `.env*.local`, but NOT `unified.db` (local 0-byte stray, but in dev it holds real auth data), `tsconfig.tsbuildinfo` (212 KB), `.git` is not in this context anyway, or backup dirs. `COPY . .` in the builder stage (`app/Dockerfile:6`) copies all of these into the build layer.
- **Why it matters:** A populated local `unified.db` (with password hashes, sessions, audit log) would be copied into an intermediate image layer and could leak via image history even though the multi-stage runner discards it. `tsbuildinfo` and other cruft bloat context upload and layer cache invalidation. `.env.local` is excluded (good) but the DB is the bigger data-leak risk.
- **Suggested fix:** Expand `app/.dockerignore` to also exclude `*.db`, `*.db-shm`, `*.db-wal`, `tsconfig.tsbuildinfo`, `.git`, `Dockerfile`, `*.md`, and any `app-backup-*`. Mirror the repo `.gitignore` ignore set.

### A18-M2 — better-sqlite3 native module: build deps present, but no verification it loads in the slim runner
- **Severity:** Medium
- **Path:** `app/Dockerfile:3` (builder installs `python3 make g++`), `:10` (runner `node:24-slim`), `app/next.config.ts:5` (`serverExternalPackages: ['better-sqlite3']`)
- **What's wrong:** The builder installs glibc toolchain and `npm ci` compiles/fetches the better-sqlite3 prebuilt; the standalone trace correctly carries `node_modules/better-sqlite3` (2.2 MB confirmed in `app/.next/standalone/node_modules/better-sqlite3`). Both stages are `node:24-slim` (same glibc, good — Alpine/musl would break it, per CLAUDE.md). The risk is only that the native `.node` binary is built against the builder's exact glibc and copied wholesale; there is no smoke test that `require('better-sqlite3')` succeeds in the runner.
- **Why it matters:** If the two `node:24-slim` base digests ever drift (e.g. builder cached older), an ABI mismatch surfaces only at first `getDb()` call — which happens during instrumentation seed and on the health route. It would manifest as a runtime crash, not a build failure.
- **Suggested fix:** Pin the base image by digest (`node:24-slim@sha256:...`) so builder and runner are byte-identical, and/or add a build-time `RUN node -e "require('better-sqlite3')"` smoke step in the runner stage. Low effort, removes a class of "works on my build" failures.

### A18-M3 — Standalone image carries 33 MB of `@img`/sharp platform binaries; sibling audit's transcode.ts attribution is wrong
- **Severity:** Medium
- **Path:** `app/.next/standalone/node_modules/@img` (33 MB), `.../next` (16 MB); total standalone 73 MB
- **What's wrong:** `du` of the standalone tree shows the 73 MB is dominated by `@img` (sharp's per-arch libvips binaries, 33 MB) and `next` (16 MB), with better-sqlite3 at 2.2 MB and sharp wrapper 380 KB. `transcode.ts` uses `child_process.spawn(ffmpeg)` and contributes essentially nothing to the trace (ffmpeg comes from apt, not bundled — confirmed no `ffmpeg*` under standalone). The sibling audit's claim that transcode.ts produces a 73 MB trace is a misattribution.
- **Why it matters:** Cold-start and image size are driven by sharp's multi-platform binaries pulled in by `next/image` optimization, not by the media-server code. Optimizing the wrong thing wastes effort; the real lever is sharp platform pruning. Cold start itself is fine (no heavy top-level work in instrumentation; all subsystem modules are dynamically imported).
- **Suggested fix:** If image size matters, constrain sharp to the deployment arch (e.g. `npm_config_platform`/`--cpu`/`--os` install flags, or `sharp` `libvipsVersion` pinning) so only one `@img/sharp-linuxXXX` binary ships. Otherwise accept it. Correct the cross-audit note: the trace is sharp + next, not transcode.

### A18-M4 — Party WS server binds 0.0.0.0:3002 with no container-level network isolation note
- **Severity:** Medium
- **Path:** `app/src/lib/party/server.ts:1271` (`httpServer.listen(PARTY_WS_PORT, '0.0.0.0')`), `app/docker-compose.fragment.yml` (no port publish — good)
- **What's wrong:** The WS server listens on all interfaces inside the container. The compose fragment does not publish 3002 to the host (correct — Caddy reaches it by container DNS), so it is only exposed on the compose bridge network. That is acceptable, but there is no comment/guard ensuring 3002 is never accidentally published, and any other container on `compose_default` can reach `unified-frontend:3002` directly, bypassing Caddy's `/api/party/ws` path matcher and Origin checks at the edge (the server still enforces session + Origin allowlist itself, which mitigates this).
- **Why it matters:** Defense-in-depth: the only thing keeping 3002 internal is the absence of a port mapping. A future `ports:` addition for debugging would expose the raw WS server. The app-level auth (`lookupPartySession`, `allowedWsOrigins`) is solid, so this is hardening, not an open hole.
- **Suggested fix:** Add a comment in the compose fragment that 3002 must never be published; optionally bind to the container's bridge IP only if discoverable. Keep the existing in-app Origin + session checks (they are the real control).

### A18-M5 — Health/liveness only; no readiness signal for the WS subsystem or schedulers
- **Severity:** Medium
- **Path:** `app/src/app/api/health/route.ts`
- **What's wrong:** `/api/health` checks SQLite and the first `MEDIA_ROOTS` path. It does not report whether the party WS server bound 3002, whether schedulers started, or whether the chokidar watcher attached. `initPartyServer()` is wrapped in try/catch in instrumentation and only `console.warn`s on failure (`app/src/instrumentation.ts:34-39`), so a failed WS bind (e.g. port already taken by a stray worker) is invisible to health.
- **Why it matters:** The container can be "healthy" while party play is dead because the WS server failed to bind. Operators get no signal until a user reports broken sync.
- **Suggested fix:** Extend the health payload with a `party: bool` derived from `getRuntime() !== undefined && rt.http.listening`, and optionally `scheduler`/`watcher` booleans. Keep liveness 200 even if party is down (it is non-fatal), but surface the degraded subsystem in the body.

### A18-M6 — Multiple Next workers would split party state and double-register crons; single-instance assumption is undocumented in deploy files
- **Severity:** Medium
- **Path:** `app/src/lib/party/in-memory-store.ts:1-12` (single-instance store), `app/src/instrumentation.ts` (per-worker `register()`), `app/docker-compose.fragment.yml` (single container — implicit)
- **What's wrong:** `register()` runs once per worker process. The cron/subtitle guards are module-level `let started` (per-process), and the party guard is `globalThis`-pinned (also per-process). The in-memory party store and `partyEvents` emitter are `globalThis` singletons — correct for one process, but if Next standalone is ever run with multiple workers/cluster, or the service is scaled to >1 replica, each process gets its own party store (split-brain) and each registers its own cron jobs (duplicate grabs/auto-deletes). The store header explicitly flags this as the horizontal-scale boundary, but nothing in the compose/deploy files pins replicas=1 or warns against cluster mode.
- **Why it matters:** A well-meaning `deploy.replicas: 2` or enabling Node cluster would duplicate every cron tick (double torrent grabs, double auto-deletes against the same rows) and shatter party sync. The safety depends entirely on running exactly one single-threaded process, which is an undocumented invariant in the deploy artifacts.
- **Suggested fix:** Document the single-instance invariant in the compose fragment (comment + explicit `deploy: { replicas: 1 }` if swarm, or a note for standalone). For crons specifically, consider a DB-backed advisory lock so a second process cannot double-fire even by accident.

---

## Low

### A18-L1 — Stray 0-byte `app/unified.db` in the working tree (untracked but confusing)
- **Severity:** Low
- **Path:** `app/unified.db` (0 bytes, present in working tree, NOT git-tracked)
- **What's wrong:** A 0-byte `unified.db` sits in `app/`. It is correctly gitignored (`*.db`) and not tracked, but in dev `DB_PATH` defaults to `process.cwd()/unified.db` (`app/src/lib/db/index.ts:21`), so this stray file is what `npm run dev` opens. A 0-byte file is a valid empty SQLite DB that migrations will populate, but its presence is easy to mistake for committed data.
- **Why it matters:** Cosmetic/operational confusion only; no leak (untracked, ignored). It also enters the Docker build context (see A18-M1).
- **Suggested fix:** Delete the stray `app/unified.db` from the working tree; it is recreated on demand. Add `*.db` to `.dockerignore` (A18-M1).

### A18-L2 — `app-backup-2026-05-26-1127/` left in the repo root
- **Severity:** Low
- **Path:** `app-backup-2026-05-26-1127/` (repo root, NOT git-tracked, ignored via `app-backup-*`)
- **What's wrong:** A full dated backup copy of `app/` from 2026-05-26 sits at the repo root. It is correctly ignored and untracked, but it is a stale full source tree (and may contain its own `.env.local` / node_modules) consuming disk and confusing greps/tooling that don't honor `.gitignore`.
- **Why it matters:** Hygiene and accidental-include risk: tools that scan the filesystem (not git) may pick up stale code or secrets from the backup. No git-level leak.
- **Suggested fix:** Move backups outside the repo tree (e.g. `~/backups/`) or delete after confirming they are not needed. Keep the `app-backup-*` ignore rule.

### A18-L3 — `tsconfig.tsbuildinfo` (212 KB) present in working tree
- **Severity:** Low
- **Path:** `app/tsconfig.tsbuildinfo` (212 KB, NOT tracked, ignored)
- **What's wrong:** Incremental TS build cache present in `app/`. Correctly ignored (repo `.gitignore:33` and root `*.tsbuildinfo`), not tracked. Only relevant because it is not in `.dockerignore` (A18-M1).
- **Why it matters:** Negligible; build-context bloat only.
- **Suggested fix:** Add to `.dockerignore`; otherwise leave it (regenerated by `tsc`).

### A18-L4 — Image `next.config.ts` remotePatterns pin a hardcoded LAN IP for Jellyfin images
- **Severity:** Low
- **Path:** `app/next.config.ts:8-13` (`hostname: '192.168.0.50', port: '8096'`)
- **What's wrong:** `next/image` `remotePatterns` hardcodes `http://192.168.0.50:8096/Items/**`. This matches the documented Jellyfin host-network IP, so it works for this deployment, but it is environment-specific config living in source rather than env.
- **Why it matters:** A deployment with a different Jellyfin host (or container-name access) silently fails image optimization (Next blocks unconfigured remote hosts with a 400). Tightly coupled to one homelab. Low impact since the app is single-homelab.
- **Suggested fix:** Acceptable for a single-host homelab; if portability is wanted, drive the allowed image host from `JELLYFIN_URL`'s host at build time. Note `media-src`/`img-src` CSP would also need to match.

### A18-L5 — Caddy idle-timeout exception for `/api/party/ws` intentionally deferred (documented backlog item)
- **Severity:** Low
- **Path:** CLAUDE.md §16 "Deploy and the mandated edge test" / `PARTY_PLAY_AUDIT.md` L5; `app/caddy.fragment`
- **What's wrong:** There is no explicit reverse-proxy read/idle timeout for the party WS path, and no BunkerWeb idle-reap exception for `/api/party/ws`. The design relies on the 5s app heartbeat + 20s ws ping to stay under typical 60s idle reapers. This is a knowingly deferred item pending the mandated off-tailnet cellular idle test.
- **Why it matters:** If BunkerWeb (or any upstream) reaps idle upgrades aggressively (<25s), the socket could drop despite the keepalives; the client reconnect logic recovers, but with a visible blip. Already tracked, not a regression.
- **Suggested fix:** Run the §16 mandated cellular idle test; if reaping is observed, add the per-domain WebSocket idle exception for `/api/party/ws` in the edge compose (confirm the exact BunkerWeb variable against the running config first, per the BunkerWeb project lesson).

---

## Info / Positive

### A18-I1 — Runtime init is correctly single-shot and Node-runtime-gated (POSITIVE)
- **Severity:** Info
- **Path:** `app/src/instrumentation.ts:5-40`, guards in `scheduler.ts:24`, `subtitle/scheduler.ts:12`, `party/server.ts:122-132,1129-1132`, `scanner.ts` watcher-private
- **What's right:** `register()` is gated on `NEXT_RUNTIME === 'nodejs'` (never runs in Edge). Required env (`ADMIN_USERNAME`/`ADMIN_PASSWORD`) is validated with a hard `process.exit(1)` on miss; Jellyfin vars warn-only. Every subsystem has a re-entrancy guard: automation/subtitle use module-level `started`; party uses a `globalThis['__partyServerStarted']` flag (survives module re-eval under HMR/double-import); the party `ended` listener does `removeAllListeners` before re-binding (M4). Subsystem modules are dynamically `import()`ed so a heavy module never loads at top-level — good for cold start. Failures in party/indexer init are caught and downgraded to warnings (non-fatal), which is the right posture for optional subsystems.

### A18-I2 — Repo hygiene is clean: secrets, DB, build cache, backups, and sources all untracked (POSITIVE)
- **Severity:** Info
- **Path:** root `.gitignore`, `app/.gitignore`; verified via `git ls-files`
- **What's right:** `git ls-files --error-unmatch` confirms `app/.env.local`, `app/unified.db`, and `app/tsconfig.tsbuildinfo` are NOT tracked. `git ls-files | grep` returns 0 hits for `app-backup`, `sources/`, `node_modules`, and `.next/`. The ignore rules at both root and `app/` correctly cover `.env*.local`, `*.db`/`-shm`/`-wal`, `app-backup-*`, `sources/`, `node_modules`, `.next`, and `*.tsbuildinfo`. No secret values are committed.

### A18-I3 — Dockerfile multi-stage is correct for Next standalone + native modules + ffmpeg (POSITIVE)
- **Severity:** Info
- **Path:** `app/Dockerfile`
- **What's right:** Proper builder→runner split; builder installs `python3 make g++` for better-sqlite3 native compile; both stages `node:24-slim` (glibc, not Alpine/musl — matches CLAUDE.md requirement); runner installs `ffmpeg` + `intel-media-va-driver` and sets `LIBVA_DRIVER_NAME=iHD` for headless VAAPI; runs as non-root `nextjs:nodejs` (uid/gid 1001); copies only `.next/standalone`, `.next/static`, `public` with correct ownership; `NEXT_TELEMETRY_DISABLED=1`; `CMD ["node","server.js"]` (standalone entry). `output: 'standalone'` and `serverExternalPackages: ['better-sqlite3']` are set in `next.config.ts`. ffmpeg is NOT bundled in the trace (comes from apt) — correct.

### A18-I4 — Party WS upgrade auth + per-message membership checks are robust (POSITIVE)
- **Severity:** Info
- **Path:** `app/src/lib/party/server.ts:1157-1209` (upgrade), `:628-731` (per-message), `app/src/lib/party/session.ts`, `constants.ts:94-105`
- **What's right:** The upgrade handler validates path, checks the `Origin` against an env-derived allowlist (missing Origin = non-browser allowed), parses + resolves the `unified-session` cookie to a live identity (active user, unexpired, not `force_pw_change`), and caps sockets-per-user before completing the handshake. Every non-join message re-checks live membership on that exact socket (`isLiveMemberOnSocket`), with the durable DB check only at the `join` claim step. Periodic session re-validation (`SESSION_RECHECK_INTERVAL_MS`) folds into the ping sweep and closes revoked/expired sessions mid-connection. Inbound fields are validated and rate-limited per type. This matches the hardened state described in CLAUDE.md §16 / PARTY_PLAY_AUDIT.md and is appropriate for a publicly reachable WS endpoint.
