---
name: deploy-unified-frontend
description: Rebuild and redeploy the unified-frontend container, then drive/verify the deployed app. Use when asked to deploy, rebuild the image, ship merged changes to the running container, or test against the live deployed container (not a dev server). Covers the compose build/recreate dance, health-wait, and how to drive the deployed app in a browser.
---

Deploys the Next.js app that runs at `<app-host>`.

Rewritten **2026-08-16** for the rebuilt minime server. The previous version had been mechanically
"repointed" on 2026-08-13 without being run, and several of its core facts were wrong — see
"What changed and why" at the bottom if you are wondering where the loopback-forwarder dance went.

## The one thing to know first

**There is no Node on this host.** Not node, not npm, not npx. Every build/test/lint step below
runs inside a container. Do not try to `npm ci` or `npx` anything on minime directly — it will
fail, and installing Node here just to run a type-check is not worth it.

## The compose facts, verified

| thing | value |
|---|---|
| compose project | **`unified-media`** |
| compose file | `/home/joe/docker/unified-media/docker-compose.yml` |
| image it produces | **`unified-media-unified-frontend`** |
| container name | `unified-frontend` |
| build context | `/home/joe/unified-media/app` |
| runtime env / secrets | `/home/joe/docker/unified-media/.env` |
| published port | **`3001` → host `0.0.0.0:3001`** |
| party-play WS port | `3002`, **not** published |
| networks | `unified-media_default` + `gluetun_default` (external) |

Run compose from its own directory so the project name and `.env` are picked up automatically.
**Never** pass `-p compose` or `--project-directory /home/joe/docker` — that builds an image called
`compose-unified-frontend`, which nothing ever runs. (The old version of this skill said to do
exactly that, while also warning against the identical trap under Gotchas.)

## Preflight (before building)

Docs (`CLAUDE.md`, `docs/`, `CHANGELOG.md`) are **not** in the build context (`app/`) — changing
them needs no rebuild. Only `app/**` changes require a deploy.

```bash
cd /home/joe/unified-media
docker run --rm -u "$(id -u):$(id -g)" \
  -v /home/joe/unified-media/app:/app -w /app -e HOME=/tmp \
  node:24-slim sh -c 'npm run type-check && npm run lint && npm run test'
```
`node:24-slim` is already pulled (it is the app image's own base). The mount reuses the repo's
existing `app/node_modules`, so this needs no install and takes seconds. Verified 2026-08-16:
`tsc --noEmit` clean, **69 tests in 9 files** green.

- If a feature added an env var (VAPID, SMTP, …), add it to `/home/joe/docker/unified-media/.env`
  first — the container reads it via `env_file`. Note this is **not** `app/.env.local`; that file
  does not exist on this machine, and anything still telling you to read it is stale.
- `NEXT_PUBLIC_APP_URL` is a **build arg**, not just runtime: `next.config.ts` bakes it into the
  CSP and Next inlines `NEXT_PUBLIC_*` into the client bundle at build time. Changing it requires a
  rebuild, not a restart.
- A new npm dep must land in `package.json` + `package-lock.json` (the image build runs `npm ci`).
  Install it in the same container pattern above, not on the host.
- Commit + push `main` before deploying, so the deployed image matches origin.

## Build + redeploy

Always `--no-cache` (CLAUDE.md §8 mandate — avoids stale-layer images):

```bash
cd /home/joe/docker/unified-media
docker compose build --no-cache unified-frontend
docker compose up -d --force-recreate unified-frontend
```
Run the build in the background (1–2 min) and wait for the completion notification rather than
polling. Then wait for health:

```bash
for i in $(seq 1 40); do
  s=$(docker inspect unified-frontend --format '{{.State.Health.Status}}' 2>/dev/null)
  [ "$s" = "healthy" ] && { echo "healthy after $((i*3))s"; break; }
  sleep 3
done
```
The DB persists across recreate (volume `unified-db:/data`), so sessions and data survive.

Confirm the app and then the edge:
```bash
curl -s --max-time 8 http://localhost:3001/api/health -o /dev/null -w "app:  %{http_code}\n"
curl -s --max-time 8 --resolve <app-host>:443:<lan-ip> \
  https://<app-host>/api/health -o /dev/null -w "edge: %{http_code}\n"
```
The `--resolve` is not optional from the host: `*.<internal-domain>` resolves **only** through
Pi-hole, and the host resolver deliberately never points at Pi-hole (standing rule — that
misconfiguration caused the original outage). Without it you get exit code 6, not a real failure.

## Driving / verifying the DEPLOYED container

Port 3001 is published straight to the host, so there is nothing to set up:

```bash
cd /home/joe/unified-media/.claude/skills/run-unified-frontend
./api.sh /api/auth/me                 # data questions — ~31ms
./run.sh flows/smoke.flow             # did it render — ~1.9s
```
Use `run-unified-frontend`; do not reinvent a driver here. `http://localhost:3001` is a secure
context (Secure cookies work) and its Origin is in the app's CSRF allowlist.

For a **non-admin** view, register a throwaway user via `POST /api/auth/register` (open enrollment,
instant activation while `EMAIL_VERIFICATION_REQUIRED` is unset), test, then delete it from the DB
with `unified-db-query`.

**Party-play is the one case that still needs a forwarder**, because 3002 is not published and the
client connects direct to `ws://localhost:3002` in localhost mode (`src/lib/party/socket-url.ts`;
CSP already allows it). `fwd.cjs` is a 10-line TCP proxy — run it in a container, since there is no
host Node:

```bash
IP=$(docker inspect unified-frontend --format '{{index .NetworkSettings.Networks "unified-media_default" "IPAddress"}}')
docker run --rm --name fwd3002 --network host \
  -v /home/joe/unified-media/.claude/skills/deploy-unified-frontend:/w -w /w \
  node:24-slim node fwd.cjs "$IP" 3002 3002      # run in background
```
Name the network explicitly with `index` — the network key contains a `-`, so the dotted form
`{{.NetworkSettings.Networks.unified-media_default.IPAddress}}` dies with
`template parsing error: bad character U+002D`. And do not fall back to the old
`{{range}}…{{end}} | awk '{print $1}'` trick: the container is on **two** networks and that
silently returned whichever key sorted first (`gluetun_default`). Re-derive `$IP` after every
recreate; it changes.

Verified 2026-08-16: forwarder up, `curl http://localhost:3002/api/party/ws` → **426 Upgrade
Required**, which is the correct answer for a WS endpoint over plain HTTP.

Stop it with `docker kill fwd3002`.

## Verifying a specific feature landed in the image
```bash
docker exec unified-frontend sh -c 'ls -d /app/.next/server/app/<route> 2>/dev/null; grep -rl "<symbol>" /app/.next/server | head -1'
# migrations: query the live DB with the unified-db-query skill, e.g. confirm a new table/column exists
```

## Gotchas
- **Never** `docker build -t unified-frontend`, and never override the compose project name —
  either way you get an image the running container never picks up.
- Rebuild only after `app/**` changes; docs-only merges deploy nothing.
- The container IP changes on recreate. The published port 3001 does not — prefer it.

## What changed and why (2026-08-16)

Everything below was wrong in the previous version and is now corrected against the live host:

1. **`-p compose --project-directory /home/joe/docker`** → the real project is `unified-media`.
   As written, the build produced `compose-unified-frontend` and deployed nothing.
2. **Host `npm run type-check && npm run lint && npm run test`** → there is no npm on this host.
   Now containerized, and actually run.
3. **`node .claude/skills/…/fwd.cjs` on the host** → no host Node. Containerized.
4. **The whole loopback-forwarder section for port 3001** → obsolete. It existed because hitting
   the edge in a headless browser tripped **BunkerWeb** rate-limiting on the burst of JS chunks.
   There is no BunkerWeb on the rebuilt server — Caddy is the edge and has no rate limiting — and
   3001 is published to the host anyway. Kept only for 3002/party-play.
5. **`app/.env.local`** → does not exist here; secrets are in `/home/joe/docker/unified-media/.env`.
6. **Container-IP-by-first-network** → ambiguous across two networks; now named explicitly.

**Not verified end to end:** the `--no-cache` build + `--force-recreate` itself was not run, because
it takes the media app down briefly and that is the user's call to make, not a test to run
unprompted. Every other step above was executed against the live host.
