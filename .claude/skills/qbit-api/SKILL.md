---
name: qbit-api
description: Authenticate to a qBittorrent WebUI and list/add/delete torrents or hit any raw API endpoint, without opening a browser. Use whenever you need to inspect or change qBittorrent's torrent queue directly — e.g. checking what UMT (unified-frontend's download client) actually holds, cleaning up a torrent by hash, or verifying a credential/instance change took effect. Defaults to the same instance unified-frontend itself talks to (UMT_* in app/.env.local); pass explicit connection flags to reach a different instance.
---

`qbit.cjs` runs on the **host**, not inside any container — qBittorrent is host-networked
(`network_mode: host` in compose), so it's reachable directly at `192.168.0.50:<port>` from
wherever this session runs. No `docker exec`/`docker cp` involved, unlike the
`unified-db-query` skill.

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
node qbit.cjs login                                    # just test auth
node qbit.cjs list                                     # hash | category | progress | state | name
node qbit.cjs delete <hash...> [--files]               # --files also deletes data on disk
node qbit.cjs add <magnet-or-url> [--category X]
node qbit.cjs raw <METHOD> <api-path> [formBody]       # escape hatch for anything else
```

Flags can appear anywhere in the command (before or after the subcommand).

Examples:
```bash
node qbit.cjs list
node qbit.cjs raw GET /api/v2/app/version
node qbit.cjs delete 0f8478bf303bbe0e4c5bf159bbdefc823211af30 --files
node qbit.cjs --host 192.168.0.50 --port 8080 --user minijoe --pass '...' list   # the OTHER instance
```

## Which instance it talks to

Connection resolution, first fully-specified source wins:

1. `--host` / `--port` / `--user` / `--pass` flags
2. `QBIT_HOST` / `QBIT_PORT` / `QBIT_USER` / `QBIT_PASS` env vars
3. **Default** — parses `UMT_URL` / `UMT_USERNAME` / `UMT_PASSWORD` straight out of
   `app/.env.local`, i.e. whatever instance unified-frontend itself is configured to use right
   now. As of 2026-07-20 that's the dedicated `qbittorrent-umt` instance on `:8082` — reading
   the env file live means this stays correct if that ever changes again, with zero edits here.

There is a second, separate qBittorrent instance on this stack (`qbittorrent`, `:8080` —
the original shared instance, still used by anything else on minime that talks to
qBittorrent directly). Reach it with explicit `--host`/`--port`/`--user`/`--pass`.

## Gotchas

- `list`'s `category` column reflects whatever the torrent was tagged with by whatever added
  it — including categories left over from a now-removed app (e.g. an old `radarr`-tagged
  entry can persist in qBittorrent after the Radarr container itself is gone). That's normal
  qBittorrent behavior, not a bug in this tool — don't assume the tagging app is still running.
- `delete` without `--files` removes the queue entry only; the downloaded data stays on disk.
  Confirm which one you actually want before running it — there's no undo.
- Test read-only first (`list`, `raw GET ...`) when you're not sure a connection override is
  right; a wrong `--port` against a live instance still returns clean errors, but there's no
  reason to guess against a mutating call.
