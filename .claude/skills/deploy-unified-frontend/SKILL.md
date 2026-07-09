---
name: deploy-unified-frontend
description: Rebuild and redeploy the unified-frontend container, then drive/verify the deployed app. Use when asked to deploy, rebuild the image, ship merged changes to the running container, or test against the live deployed container (not a dev server). Covers the compose build/recreate dance, health-wait, the two-interface container-IP trap, and the loopback-forwarder pattern for browser-driving the deployed app past the edge's rate-limit/CSRF.
---

Deploys the Next.js app that runs at `unified.minijoe.dev`. The image is built and run by
Docker Compose (project **`compose`**) from `/opt/docker/compose/docker-compose.yml`; the app's
build context is `/home/minijoe/dev/unified-frontend/app`. Container name: `unified-frontend`,
listens on `:3001` (app) and `:3002` (party-play WebSocket), neither published to the host.

## Preflight (do this before building)

Docs (CLAUDE.md, docs/, CHANGELOG) are NOT in the build context (`app/`) — changing them needs no
rebuild. Only `app/**` changes require a deploy.

```bash
cd /home/minijoe/dev/unified-frontend/app
npm run type-check && npm run lint && npm run test   # the Docker build runs next build (which lints); catch failures here first
```
- If a feature added an env var (e.g. VAPID, SMTP), add it to `app/.env.local` first — the container
  reads it via `env_file`. A new npm dep must be in `package.json` + `package-lock.json` (the build
  runs `npm ci`); `npm install <dep>` in `app/` locally so the lockfile updates.
- Commit + push `main` before deploying so the deployed image matches origin.

## Build + redeploy

Always `--no-cache` (CLAUDE.md §8 mandate — avoids stale-layer/typo images), and always pass the
project name + config so it targets the existing `compose-unified-frontend` image, not a stray one:

```bash
CF=/opt/docker/compose/docker-compose.yml
docker compose -f "$CF" -p compose --project-directory /opt/docker/compose build --no-cache unified-frontend
docker compose -f "$CF" -p compose --project-directory /opt/docker/compose up -d --force-recreate unified-frontend
```
Run the build in the background (it takes 1–2 min) and wait for the completion notification rather
than polling. Then wait for health:

```bash
for i in $(seq 1 40); do
  s=$(docker inspect unified-frontend --format '{{.State.Health.Status}}' 2>/dev/null)
  [ "$s" = "healthy" ] && { echo "healthy after $((i*3))s"; break; }
  sleep 3
done
```
The DB persists across recreate (volume `unified-db:/data`), so sessions + data survive.

Confirm the edge is serving:
```bash
curl -s --max-time 8 https://unified.minijoe.dev/api/health -o /dev/null -w "edge: %{http_code}\n"   # expect 200
```

## Driving / verifying the DEPLOYED container (not a dev server)

The container ports aren't published, and hitting the real edge (`unified.minijoe.dev`) in a headless
browser trips BunkerWeb rate-limiting on the burst of JS chunks (429 → React never hydrates). So
forward loopback ports straight to the container and drive `http://localhost:3001` — a "secure
context" (Secure cookies work) whose Origin `http://localhost:3001` is in the app's CSRF allowlist.

1. Get the container IP — **it now has two interfaces**, so take the first:
```bash
IP=$(docker inspect unified-frontend --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' | awk '{print $1}')
```
2. Start forwarders as **persistent background tasks** (a plain `&`/`disown` gets reaped when the
   foreground shell returns; use the tool's background mode). App on 3001; party WS on 3002:
```bash
# fwd.cjs: a tiny TCP proxy — args: <remote-host> <local-port> <remote-port>
node .claude/skills/deploy-unified-frontend/fwd.cjs "$IP" 3001 3001    # run in background
node .claude/skills/deploy-unified-frontend/fwd.cjs "$IP" 3002 3002    # run in background (only needed for party-play WS)
```
   (The party-play client connects WS directly to `ws://localhost:3002` in dev/localhost mode — see
   `src/lib/party/socket-url.ts` — so 3002 must be forwarded for watch-together tests. CSP already
   allows `ws://localhost:3002`.)
3. Drive with the `run-unified-frontend` skill's Playwright driver against `http://localhost:3001`
   (`login` reads admin creds from `app/.env.local`). For a **non-admin** view, register a throwaway
   user via `POST /api/auth/register` (open enrollment, instant activation when
   `EMAIL_VERIFICATION_REQUIRED` is unset), test, then delete it from the DB. For **party-play**,
   run two driver instances (two tmux sessions → two browsers) as host + guest.
4. Curl-based API checks work too: `curl -c jar -X POST .../api/auth/login -H 'Origin: http://localhost:3001' ...`
   then reuse the jar. Behind the plain-TCP forwarder the app sees http, so the session cookie isn't
   marked Secure and curl will send it back.

Stop forwarders/drivers when done (`kill $(pgrep -f fwd.cjs)`; `tmux kill-session`). A `kill` here
often reports a benign non-zero exit — verify with `pgrep -f fwd.cjs` instead of trusting the code.

## Verifying a specific feature landed in the image
```bash
docker exec unified-frontend sh -c 'ls -d /app/.next/server/app/<route> 2>/dev/null; grep -rl "<symbol>" /app/.next/server | head -1'
# migrations: query the live DB (see the unified-db-query pattern), e.g. confirm a new table/column exists
```

## Gotchas
- **Never** `docker build -t unified-frontend` — compose uses `compose-unified-frontend:latest`; a
  bare build produces an image the container never picks up.
- The container IP can change on recreate — re-derive it (and restart forwarders) after every deploy.
- Rebuild only after `app/**` changes; docs-only merges deploy nothing.
