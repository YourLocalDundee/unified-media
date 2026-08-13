---
name: run-unified-frontend
description: Drive and verify the running unified-frontend web app in a real browser — log in, click through a flow, check what actually rendered, capture console errors, screenshot on failure. Use when asked to test the UI, reproduce a UI bug, confirm a deployed change works in the browser, or check whether a page renders correctly.
---

Drives the **deployed** unified-frontend container in a real Chromium via Playwright. Rewritten
2026-08-13 for the rebuilt minime server; the previous version targeted the pre-wipe machine and
every path in it was dead.

## The one thing to know first

**There is no Node on this host.** Not node, not npm, not npx. Everything runs inside a pinned
Playwright container. Do not try to `npm install` or `npx playwright` on minime — it will fail,
and installing Node just to run browser tests is not worth it.

## Run a flow

```bash
cd /home/joe/unified-media/.claude/skills/run-unified-frontend
./run.sh flows/smoke.flow
```

or inline, without creating a file:

```bash
./run.sh - <<'EOF'
nav /library
snapshot
expect-no-errors
EOF
```

One invocation runs the **whole flow** and prints one compact line per step. That is the entire
interface — there is no REPL, no tmux session, no `send-keys`/`sleep`/`capture-pane` cycle.

Output looks like:

```
01 ok   nav http://localhost:3001/login
02 ok   login (as admin)
03 ok   wait-for text=Dashboard
04 ok   snapshot body
- navigation:
  - link "Dashboard"
  - link "Browse"
  ...
05 ok   expect-no-errors

FLOW OK (5 steps)
```

Exit code is 0 if every step passed, 1 if any step failed.

## Why it is built this way

The old version was a line-at-a-time REPL under tmux that screenshotted after every action and
had the model look at each image. That is ~3 tool calls and ~1500 tokens **per step**. Two changes
fixed it:

**Assert on the accessibility tree, not on pixels.** `snapshot` prints a compact text tree of what
rendered — roles, names, structure. That *is* "did it render correctly", it costs ~100 tokens
instead of ~1500, and unlike an image it diffs cleanly between runs so you can see exactly what
changed.

**Screenshots only when something is already known to be wrong.** A failing step automatically
captures one and prints the host path alongside the ARIA tree at the point of failure. Otherwise
you only get a screenshot if you ask with `shot`.

## Flow commands

| command | what it does |
|---|---|
| `nav <url-or-path>` | navigate; bare paths resolve against the base URL |
| `login` | read creds from the env file *inside* the process and submit — see below |
| `click <selector>` | Playwright selector, e.g. `text=Requests` or `#submit` |
| `fill <selector> <text…>` | non-credential fields only |
| `press <key>` | e.g. `Enter` |
| `wait-for <selector>` | or `wait-for text=<substring>` |
| `snapshot [selector]` | ARIA tree of the page or a subtree — **the default check** |
| `text [selector]` | textContent, whitespace-collapsed, first 400 chars |
| `expect <substring>` | fail unless the substring is visible |
| `expect-no-errors` | fail if any console/page errors were captured |
| `eval <js>` | `page.evaluate`, prints JSON |
| `shot [name]` | explicit screenshot → `screenshots/<name>.png` |

Lines starting with `#` are comments. Blank lines are ignored.

## Logging in — never type the password

Use the `login` command. It reads `ADMIN_USERNAME`/`ADMIN_PASSWORD` from
`/home/joe/docker/unified-media/.env` (mounted read-only into the container) inside the driver
process and prints only the username.

Never write `fill #password <literal>` into a flow. The rule predates this rewrite and still
holds: anything that passes through a shell command line or a tmux pane ends up in logs and
transcripts in plaintext. Claude Code's own permission classifier blocks it as credential
materialization. This is also why there is no `--password` flag and never should be.

## What it targets

`http://localhost:3001` — the **deployed** `unified-frontend` container, which publishes 3001 on
the host. `run.sh` uses `--network host`, so there is no container-IP lookup or compose-network
juggling.

There is deliberately no dev-server mode. Running `npm run dev` would need Node on the host, which
does not exist here. Override the target if you need to:

```bash
DRIVE_BASE_URL=https://<app-host> ./run.sh flows/smoke.flow
```

Note that going through the Caddy hostname exercises TLS and the proxy too, which is useful for
confirming an edge change but slower and noisier for plain UI work.

## Version pinning — read before bumping anything

The `playwright` package in `node_modules` **must** match the browser build baked into the Docker
image, or Chromium will not launch. Both are pinned to **1.50.0**. Bump them together or not at
all:

```bash
docker pull mcr.microsoft.com/playwright:v<NEW>-noble
# then reinstall the matching package, using the image itself since there is no host node:
docker run --rm -v "$PWD":/w -w /w -u "$(id -u):$(id -g)" \
  -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 -e npm_config_cache=/w/.npm \
  mcr.microsoft.com/playwright:v<NEW>-noble \
  npm install playwright@<NEW>
```

⚠️ **`mcr.microsoft.com/playwright:latest` is a lie.** It currently resolves to **v1.46.1**, which
predates `ariaSnapshot()` (added in 1.49) — the command this whole skill is built on. Always use
an explicit `v<X.Y.Z>-noble` tag.

## Gotchas

- **A snapshot taken immediately after `nav` used to come back empty.** `nav` only waits for
  `domcontentloaded`, so the markup exists but React has not hydrated and nothing has an
  accessible role yet — which reads as "the page rendered nothing", a lie. `snapshot` now waits
  for `load` and then polls briefly for a non-empty tree. If you genuinely get
  `(empty — nothing with an accessible role rendered)`, that is a real finding.
- **Expected console noise is filtered** so `expect-no-errors` stays meaningful: the download
  client's 401 (unreachable from this network context), hydration warnings from the client-only
  theme toggle, and the React DevTools banner. The filter list is at the top of `drive.mjs` —
  extend it rather than abandoning the check.
- **Screenshots print host paths, not container paths.** The driver runs with the skill dir
  mounted at `/w`; paths are translated back before printing so you can actually open them.
- **`screenshots/` and `node_modules/` are gitignored.** Do not commit either.

## Files

| file | purpose |
|---|---|
| `run.sh` | wrapper — starts the pinned container, mounts the skill dir + env file, sets the base URL |
| `drive.mjs` | the flow runner itself |
| `flows/smoke.flow` | login → dashboard → render check → no console errors |
| `node_modules/` | playwright 1.50.0, installed via the image (gitignored) |

## Related

- `.claude/skills/test-unified-android/` — the Capacitor Android wrapper on an emulator. **Not yet
  rebuilt; its paths are still pre-wipe and it will not run as written.**
- `.claude/skills/deploy-unified-frontend/` — rebuild/redeploy the container. **Same staleness
  problem.**
