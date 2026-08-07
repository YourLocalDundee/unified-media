---
name: unified-db-query
description: Query or mutate the LIVE unified-frontend container's SQLite database, or make an authenticated request against its running API (including polling a background job to completion). Use whenever you need to inspect/fix data in the deployed app's unified.db, or call an admin-only API route without a browser (trigger a scan, check /api/auth/me, patch a profile field, etc.) — as opposed to editing the app's source code, which is a normal file edit + the deploy-unified-frontend skill.
---

Two small tools, both invoked via `run.sh` in this directory. Neither needs the dev server —
they talk to whatever `unified-frontend` container is actually running in production
(`/opt/docker/compose/docker-compose.yml`), same DB (`unified-db` volume → `/data/unified.db`
inside the container) and same live app the real users hit.

## Why this exists (read once)

A plain `docker exec unified-frontend node -e '...'` fails in two specific ways here:

1. **The container's `package.json` sets `"type": "module"`.** A one-off script with a `.js`
   extension is parsed as ESM, and a top-level `require(...)` throws `require is not defined
   in ES module scope`. Every script this tool touches must be `.cjs`.
2. **Node's module resolution walks up from the *importing file's own directory*, not `cwd`.**
   A script sitting in `/tmp` cannot `require('better-sqlite3')` — that package only resolves
   from inside `/app`, where the app's own `node_modules` lives. Everything must land under
   `/app/` inside the container, not `/tmp`.

`run.sh` handles both automatically (copies to `/app/`, always as `.cjs`), plus a third gotcha
it took a live failure to find: `docker cp` preserves the source file's permission bits, and a
`mktemp`-created temp file defaults to `600` (owner/root-only) — the container's runtime user
is non-root, so an unwidened copy fails `require()` with `EACCES`. `run.sh` always
`chmod 644`s the in-container copy after `docker cp`, before running it.

## 1. Query or mutate the database — `run.sh --sql`

```bash
./run.sh --sql "SELECT id, username, role, display_name FROM users"
./run.sh --sql "UPDATE users SET display_name = 'Joseph' WHERE id = 'gbuUbvF1'"
```

Prints JSON: an array of rows for a `SELECT` (detected via `better-sqlite3`'s
`statement.reader` boolean — true for anything that returns rows), or the mutation's info
object (`{changes, lastInsertRowid}`) for `INSERT`/`UPDATE`/`DELETE`. Opens the DB **writable**
(not `readonly`), so both directions work through the same flag.

For anything beyond a single statement — a transaction, a loop over rows, reading a file (e.g.
deleting stale `.srt` files alongside a DB row), or reusing the same query shape repeatedly —
write a real script instead (below); `--sql` is for one-liners.

## 2. Run a prewritten script — `run.sh path/to/script.cjs [args...]`

```bash
./run.sh ./my-backfill.cjs
./run.sh ./my-backfill.cjs --dry-run     # extra args are forwarded to the script's argv
```

Inside the script, `require('better-sqlite3')` and open `/data/unified.db` directly (same
path used by `--sql` above). Write the script locally with the `Write` tool (not `mktemp`,
so it isn't born with restrictive permissions — though `run.sh` re-widens it either way),
give it a `.cjs` extension, then hand the path to `run.sh`.

**Always dry-run a mutation first when you're not 100% sure of the blast radius**: `SELECT`
the rows you're about to touch and print them before the `UPDATE`/`DELETE` pass, same as you
would with any other production data change. `better-sqlite3` has no undo.

## 3. Authenticated API requests — `authed-request.cjs` (run via `run.sh`)

Logs in as the app's own admin and hits any route on the live app (`localhost:3001` inside
the container — this is the same origin the real edge proxies to). Credentials are **never**
hardcoded: `ADMIN_USERNAME`/`ADMIN_PASSWORD` are already in this container's process
environment (compose's `env_file` loaded `app/.env.local` at container start, and `docker
exec` inherits the container's env — verified live 2026-07-21), so the script keeps working
across credential rotations with zero edits.

```bash
./run.sh authed-request.cjs GET /api/auth/me
./run.sh authed-request.cjs POST /api/media/scan --wait-job
./run.sh authed-request.cjs POST /api/subtitle/download --wait-job
./run.sh authed-request.cjs PATCH /api/auth/profile/display-name '{"displayName":"Joseph"}'
```

`--wait-job` polls a `{jobId}` response against `GET /api/jobs/:id` every second (up to 5 min)
and prints the final `result`/`error` — use it for any of the enqueue-a-background-job routes
(media scan, subtitle download/scan, etc.) that return `202` immediately and finish async.
Without `--wait-job` you just get the immediate response (fine for `GET`s and routes that
don't enqueue a job, e.g. profile PATCHes).

## Cleanup

Scripts land at `/app/<name>.cjs` inside the container (never `/tmp` — see above). The
container's own non-root user can create/read them fine but often can't delete them
afterward (they land owned by root via `docker cp`):

```bash
docker exec --user root unified-frontend rm -f /app/<name>.cjs
```

This is optional housekeeping, not a correctness issue — leftover `.cjs` files at `/app/` are
inert and vanish on the next image rebuild regardless.

## When NOT to use this

- Changing actual app behavior (routes, components, business logic) is a normal source edit
  in `app/src/...` + the `deploy-unified-frontend` skill to ship it — not a live DB patch.
  Treat a live mutation here as a data fix or an investigation, not a substitute for fixing
  the code path that produced bad data in the first place (fix both when a bug caused it).
- Don't reach for `--sql` for anything with more than one logical step — write a script; it's
  the same `run.sh` call either way, and a script is far easier to review before running.
