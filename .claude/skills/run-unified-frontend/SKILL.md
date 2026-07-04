---
name: run-unified-frontend
description: Build, run, and drive unified-frontend (the Next.js media web app). Use when asked to start unified-frontend, run its tests/lint/build, take a screenshot of its UI, log in, or click through a flow in the running app.
---

unified-frontend is a Next.js 16 App Router web app (SQLite-backed auth, no external chromium-cli
available in this environment) driven via a small Playwright-based REPL,
`.claude/skills/run-unified-frontend/driver.mjs`, run under tmux. All paths below are relative to
the repo root (`/home/minijoe/dev/unified-frontend/`); the app itself lives in `app/`.

## Prerequisites

No system packages were needed — headless Chromium launched successfully in this container with
no `xvfb`, no `--with-deps`, and no missing `.so` errors. Only the Playwright **browser binary**
needs downloading once (shared across projects, cached in `~/.cache/ms-playwright`, ~300MB):

```bash
cd /home/minijoe/dev/unified-frontend/.claude/skills/run-unified-frontend
npm install               # installs this skill's own local playwright — NOT added to app/'s deps
npx playwright install chromium
```

The driver has its own `package.json` in this directory (`playwright` only) so the app's own
`app/package.json` stays free of test-tooling dependencies. Node ESM resolves bare imports by
walking up from the *importing file's* directory, not `cwd` — so the driver's `node_modules` must
live next to `driver.mjs`, not in `app/` or the repo root.

## Setup

The app needs `app/.env.local` populated (Seerr/TMDB/UMT/qBittorrent/*arr keys, `ADMIN_USERNAME` /
`ADMIN_PASSWORD`, `DB_PATH`) — see `CLAUDE.md` §8 in the repo root for the full key list. If it's
already present (normal for this dev checkout), nothing else to configure.

```bash
cd /home/minijoe/dev/unified-frontend/app
npm install
```

## Build

No separate build step for local dev (`npm run dev` compiles on demand via Turbopack). For a
production-shaped build: `npm run build` (verified — succeeds, ~50 routes compiled).

## Run (agent path)

1. Start the dev server in the background and wait for it to actually serve:

```bash
cd /home/minijoe/dev/unified-frontend/app
nohup npm run dev > /tmp/unified-frontend-dev.log 2>&1 &
disown
timeout 30 bash -c 'until curl -sf http://localhost:3001 >/dev/null; do sleep 1; done'
```

2. Launch the driver under tmux and drive it by piping commands via `send-keys`, reading results
   via `capture-pane`:

```bash
cd /home/minijoe/dev/unified-frontend/.claude/skills/run-unified-frontend
tmux new-session -d -s rundriver -x 220 -y 50 "node driver.mjs"
sleep 1   # driver prints nothing until its first command — no ready-marker to poll for

tmux send-keys -t rundriver "nav http://localhost:3001/login" Enter
sleep 2
tmux send-keys -t rundriver "login" Enter          # see "Logging in" below — do NOT type credentials
sleep 2
tmux send-keys -t rundriver "wait-for text=Dashboard" Enter
sleep 1
tmux send-keys -t rundriver "screenshot dashboard" Enter
sleep 1
tmux capture-pane -t rundriver -p
```

Screenshots land in `driver-screenshots/<name>.png` inside this skill directory (absolute:
`/home/minijoe/dev/unified-frontend/.claude/skills/run-unified-frontend/driver-screenshots/`).

Stop cleanly when done:

```bash
tmux send-keys -t rundriver "quit" Enter
tmux kill-session -t rundriver
pkill -f "next dev --port 3001"
```

### Driver commands

| command | what it does |
|---|---|
| `nav <url>` | navigate, waits for `domcontentloaded` |
| `login` | fills `#username`/`#password` from `app/.env.local`'s `ADMIN_USERNAME`/`ADMIN_PASSWORD` and clicks Sign In — see below, never type credentials directly |
| `wait-for text=<substr>` | wait for visible text (also accepts a bare CSS selector) |
| `click <css-selector>` | e.g. `click text=Requests` |
| `fill <css-selector> <text...>` | fill a non-credential field |
| `press <key>` | e.g. `press Enter` |
| `screenshot [name]` | full-page PNG to `driver-screenshots/` |
| `text [css-selector]` | first 500 chars of textContent (default `body`) |
| `eval <js-expression>` | `page.evaluate(...)`, prints JSON |
| `console` | dumps captured browser console errors + pageerrors |
| `quit` | closes the browser and exits |

### Logging in — never type the password via `send-keys`

Anything sent through `tmux send-keys` is echoed into the pane by the pty and is then readable via
`tmux capture-pane` — i.e. it lands in plaintext in whatever log/transcript captures that output.
**Claude Code's own auto-mode permission classifier blocks this** (hit it directly while building
this skill: "Credential Materialization... Typing the plaintext admin password into a tmux pane").
Use the driver's built-in `login` command instead — it reads `ADMIN_USERNAME`/`ADMIN_PASSWORD`
straight from `app/.env.local` inside the driver process and never prints the password, so nothing
credential-shaped ever reaches the pane.

## Run (human path)

```bash
cd /home/minijoe/dev/unified-frontend/app
npm run dev   # http://localhost:3001, Ctrl-C to stop
```

## Test

```bash
cd /home/minijoe/dev/unified-frontend/app
npm run lint         # eslint — verified clean
npm run type-check   # tsc --noEmit — verified clean
npm run test         # vitest run — verified: 1 file, 6 tests pass
```

---

## Gotchas

- **No xvfb / `--with-deps` needed.** This container already has whatever shared libs headless
  Chromium wants — `chromium.launch({ args: ['--no-sandbox'] })` worked on the first try. Don't
  reach for `xvfb-run` or `sudo apt-get install` preemptively; there's no passwordless sudo here
  anyway, so it's a dead end if you don't need it (and you don't).
- **The driver needs its own `node_modules`, not the app's.** Node's ESM resolver walks up from
  the *importing file's* directory, not `cwd` — a driver living in `.claude/skills/…/driver.mjs`
  cannot see `app/node_modules/playwright` no matter what directory you `cd` into first. Hence the
  skill-local `package.json` here.
- **`qBittorrent`/UMT is unreachable from this container** (real creds in `.env.local` point at a
  LAN host) — the dashboard correctly shows "UMT unavailable" and you'll see a real
  `Failed to load resource: 401` in `console` output for it. That's expected, not a driver bug —
  don't chase it.
- **Two benign Next.js dev-mode console entries** show up on every page: an `eval()` React
  dev-mode warning, and a hydration mismatch on `<html data-theme="dark">` vs `data-theme="light"`
  (a client-only theme toggle reading `localStorage`/system preference after SSR). Both are
  cosmetic dev-mode noise, not real bugs — don't treat them as failures when checking `console`.
- **The driver prints nothing until its first command completes** — there's no startup banner or
  ready-marker to poll for after `tmux new-session`. A short fixed `sleep 1` before the first
  `send-keys` is fine; after that, each command's `OK .../ERR ...` line is the marker.

## Troubleshooting

- **`Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'playwright'`** when running the driver: you
  ran it from somewhere other than this skill directory, or skipped `npm install` here. Run
  `cd .claude/skills/run-unified-frontend && npm install` (not `app/`, not the repo root).
- **`tmux capture-pane` shows stale output right after `send-keys`**: the command (nav/login/etc.)
  hadn't finished yet. Re-run `capture-pane` after a short sleep instead of assuming the first
  read is final — these are real network/render waits, not instant.
- **Permission denial mentioning "Credential Materialization" or similar when using `send-keys`**:
  you (or the agent) tried to type a secret directly into the pane. Use the `login` driver command
  instead of `fill #password <literal>`.
