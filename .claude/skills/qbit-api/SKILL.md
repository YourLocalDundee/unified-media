---
name: qbit-api
description: Authenticate to a qBittorrent WebUI and list/add/delete torrents or hit any raw API endpoint, without opening a browser. Use whenever you need to inspect or change qBittorrent's torrent queue directly — e.g. checking what UMT (unified-frontend's download client) actually holds, cleaning up a torrent by hash, or verifying a credential/instance change took effect. Defaults to the same instance unified-frontend itself talks to (UMT_* in the deployment .env); pass explicit connection flags to reach a different instance.
---

> **Rebuilt and verified 2026-08-16.** The previous version was written for the pre-wipe server and
> was wrong in three ways that all produced misleading failures. Corrected and run end to end:
> authenticated, listed, and added a real torrent that is downloading now.

**Use `./qbit.sh`, not `node qbit.cjs`** — there is no Node on this host, so everything runs in a
`node:24-slim` container.

The client is **not** host-networked. It runs inside gluetun's network namespace and has no ports
of its own; gluetun publishes the WebUI on `<lan-ip>:8090`.

⚠️ **Do not use that published port.** qBittorrent 5.2 validates the `Host` header and answers a
bare **HTTP 401** when addressed as `<lan-ip>:8090` — indistinguishable from a wrong password,
and it will send you hunting for credentials that were never wrong. `qbit.sh` therefore joins the
`gluetun_default` network and uses **`gluetun:8080`**, exactly the address in `UMT_URL`. (Caddy hits
the same rule and works around it with `header_up Host {upstream_hostport}` on the `<downloads-host>` site.)

## Why this exists (read once)

Every hand-rolled "log into qBittorrent and do one thing" script this session repeated the
same three fiddly bits:
- qBittorrent's login endpoint returns **HTTP 204 on success, not 200** — a status check that
  only accepts 200 silently rejects a correct login.
- The CSRF check requires a `Referer` header that matches the host being addressed
  (`http://<host>:<port>`) — omit it and login/mutating calls fail.
- The session cookie name varies by version (`SID` vs `QBT_SID_<port>` since v5.2) — always
  parse whatever `Set-Cookie` actually sent back rather than assuming a name.

`qbit.cjs` gets all three right once so nothing needs re-deriving next time.

## Usage

```bash
./qbit.sh login                                    # just test auth
./qbit.sh list                                     # hash | category | progress | state | name
./qbit.sh delete <hash...> [--files]               # --files also deletes data on disk
./qbit.sh add <magnet-or-url> [--category X]
./qbit.sh raw <METHOD> <api-path> [formBody]       # escape hatch for anything else
```

Flags can appear anywhere in the command (before or after the subcommand).

Examples:
```bash
./qbit.sh list
./qbit.sh raw GET /api/v2/app/version          # verified: HTTP 200, v5.2.3
./qbit.sh delete 0f8478bf303bbe0e4c5bf159bbdefc823211af30 --files
```

## Which instance it talks to

Connection resolution, first fully-specified source wins:

1. `--host` / `--port` / `--user` / `--pass` flags
2. `QBIT_HOST` / `QBIT_PORT` / `QBIT_USER` / `QBIT_PASS` env vars
3. **Default** — parses `UMT_URL` / `UMT_USERNAME` / `UMT_PASSWORD` out of the deployment env file
   (`QBIT_ENV_FILE`, default **`/home/joe/docker/unified-media/.env`**), i.e. whatever instance
   unified-frontend itself is configured to use. Reading it live means this stays correct if the
   address ever changes, with zero edits here.

⚠️ Note `app/.env.local` — which the old version read — **does not exist on this server**. It is
the dev-only file. Pointing at it yields no credentials at all.

There is only **one** qBittorrent instance on the rebuilt stack. The old note about a separate
`qbittorrent-umt` on `:8082` described the pre-wipe machine and no longer applies.

## Gotchas

- `list`'s `category` column reflects whatever the torrent was tagged with by whatever added
  it — including categories left over from a now-removed app (e.g. an old `the movie automation suite`-tagged
  entry can persist in qBittorrent after the the movie automation suite container itself is gone). That's normal
  qBittorrent behavior, not a bug in this tool — don't assume the tagging app is still running.
- `delete` without `--files` removes the queue entry only; the downloaded data stays on disk.
  Confirm which one you actually want before running it — there's no undo.
- Test read-only first (`list`, `raw GET ...`) when you're not sure a connection override is
  right; a wrong `--port` against a live instance still returns clean errors, but there's no
  reason to guess against a mutating call.
