# Unified Frontend — Setup Guide

Self-hosted single-pane-of-glass for the minime media stack. A fully native media server for
browsing and playback, integrated with the old request app (requests) and UMT (downloads), with its own
SQLite-backed auth. No the old media server dependency.

---

## Prerequisites

- Docker + Docker Compose (running `compose_default` network alongside existing stack)
- the download client already running (inside the gluetun netns)
- Caddy reverse proxy already running — the only thing at the edge

There is **no WAF** and nothing is internet-exposed; BunkerWeb was part of the pre-wipe stack and
is not in the rebuilt one. There is also **no node/npm/npx on the host** — see section 7.

---

## 1. Environment variables

There are **two** env files and they are not interchangeable:

| file | used by | in git? |
|---|---|---|
| `app/.env.local` | local/dev only — copy from `app/.env.local.example` | no (gitignored) |
| `/home/joe/docker/unified-media/.env` | **production** — compose reads it via `env_file`, and substitutes `NEXT_PUBLIC_APP_URL` as a build arg | no (outside the repo) |

For a production deploy, the file you edit is `/home/joe/docker/unified-media/.env`. For dev:

```bash
cp /home/joe/unified-media/app/.env.local.example \
   /home/joe/unified-media/app/.env.local
```

Required variables:

| Variable | Where to find it |
|---|---|
| `QBIT_URL` | `http://qbittorrent:8080` |
| `QBIT_USERNAME` | UMT web UI credentials |
| `QBIT_PASSWORD` | UMT web UI credentials |
| `NEXT_PUBLIC_APP_URL` | `https://<app-host>` (production) |
| `ADMIN_USERNAME` | Choose a username for the admin account |
| `ADMIN_PASSWORD` | Must meet password policy (see below) |
| `DB_PATH` | `/data/unified.db` (production), `./unified.db` (dev) |

### Password policy

Admin password must satisfy all of:
- 8–64 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one special character (`!@#$%^&*` etc.)
- No three or more identical characters in a row
- Does not contain "password", "unified", or your username
- Not a common password (admin, root, 123456, etc.)

---

## 2. Build and run with Compose

**Do not `docker build -t unified-frontend:latest .` by hand.** Compose owns the build; a hand-built
tag produces an image the running container never picks up. The live setup is:

| thing | value |
|---|---|
| compose project | `unified-media` |
| compose file | `/home/joe/docker/unified-media/docker-compose.yml` |
| image produced | `unified-media-unified-frontend` |
| build context | `/home/joe/unified-media/app` |

The compose file already exists on this machine; it is reproduced here only for a from-scratch
rebuild. The parts that are easy to get wrong and are all load-bearing: `build.args` (Next inlines
`NEXT_PUBLIC_*` and bakes the CSP at **build** time), `group_add` + `devices` (VAAPI and
`/srv/media` access), the external `gluetun_default` network (so `qbittorrent` resolves by name),
and a **node**-based healthcheck — the image has no `wget` or `curl`.

```yaml
services:
  unified-frontend:
    build:
      context: /home/joe/unified-media/app
      dockerfile: Dockerfile
      args:
        NEXT_PUBLIC_APP_URL: ${NEXT_PUBLIC_APP_URL}
    container_name: unified-frontend
    restart: unless-stopped
    env_file:
      - .env                      # /home/joe/docker/unified-media/.env — NOT app/.env.local
    environment:
      - NODE_ENV=production
      - DB_PATH=/data/unified.db
    group_add: ["1000", "990"]    # joe (for /srv/media), render (for /dev/dri)
    devices:
      - /dev/dri:/dev/dri
    ports:
      - "3001:3001"
    volumes:
      - unified-db:/data
      - transcode:/transcode
      - /srv/media:/srv/media
    mem_limit: 1g
    healthcheck:
      test: ['CMD', 'node', '-e', "require('http').get('http://localhost:3001/api/health',r=>process.exit(r.statusCode<400?0:1)).on('error',()=>process.exit(1))"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    networks: [default, gluetun_default]

networks:
  gluetun_default:
    external: true

volumes:
  unified-db:
  transcode:
```

The app Dockerfile is multi-stage, `output: 'standalone'`. Build and start from the compose file's
own directory so the project name and `.env` are picked up:

```bash
cd /home/joe/docker/unified-media
docker compose build --no-cache unified-frontend
docker compose up -d --force-recreate unified-frontend
```

Watch the logs for the seed message:

```
[seed] Admin account created. Username: admin
```

If you see `[seed] ADMIN_USERNAME and ADMIN_PASSWORD are required`, the env vars are missing.

---

## 3. Caddy configuration

The app handles its own auth — no `forward_auth` / external auth gateway needed.

Run the update script to replace the Caddyfile block. It edits
`/home/joe/docker/caddy/Caddyfile` in place (override with `CADDYFILE=...`) and is a no-op if the
block already matches:

```bash
python3 /home/joe/unified-media/scripts/update-caddyfile.py
```

Verify the new block looks like:

```caddyfile
<app-host> {
    import lab_common
    encode zstd gzip

    handle /api/party/ws* {
        reverse_proxy unified-frontend:3002
    }
    handle {
        reverse_proxy unified-frontend:3001
    }
}
```

Apply it — **`caddy reload` alone is not enough**:

```bash
docker exec caddy grep party/ws /etc/caddy/Caddyfile     # confirm the container SEES the change
cd /home/joe/docker/caddy && docker compose up -d caddy   # recreate if it does not
```

The Caddyfile is a single-file bind mount and Docker binds single files by inode. Any editor that
writes a temp file and renames it swaps the inode and silently detaches the mount, after which
`caddy reload` re-reads the stale file, reports success, and changes nothing. Hit for real
2026-08-11.

---

## 4. First login

1. Navigate to `https://<app-host>`
2. Log in with the `ADMIN_USERNAME` / `ADMIN_PASSWORD` you set in
   `/home/joe/docker/unified-media/.env` (section 1)
3. Go to `/admin/invites` to create invite codes for other users

---

## 5. Adding users

1. Admin goes to `/admin/invites` → Create an invite code
2. Copy the link: `https://<app-host>/invite/{code}`
3. Send it to the user
4. User visits the link, fills in username and password, account is created

Invite codes can be set with a max-use count and expiry date.

---

## 6. Development

⚠️ **There is no node, npm or npx on this host**, so there is no local dev-server workflow.
Run tooling through a container instead:

```bash
docker run --rm -v /home/joe/unified-media/app:/app -w /app node:24-slim \
  sh -c 'node_modules/.bin/tsc --noEmit'
docker run --rm -v /home/joe/unified-media/app:/app -w /app node:24-slim \
  sh -c 'node_modules/.bin/vitest run'
```

To exercise the running app, drive the deployed container with
`.claude/skills/run-unified-frontend/` — `./run.sh <flow>` for browser checks, `./api.sh <path>`
for data checks (~60x faster, no browser).

---

## 7. Video Player Features

### Quality Selection

The gear/settings icon in the video controls opens a quality dropdown. Available options depend on
the video's native resolution — no upscaling is offered.

| Option | Description |
|---|---|
| Direct Play | Serves the original file with no transcoding (default when codec is supported) |
| Auto | HLS stream with adaptive bitrate (default fallback) |
| 1080p / 720p / 480p / 360p / 240p | Fixed-bitrate HLS renditions, only shown when below native resolution |

On load, if the screen resolution is significantly smaller than the video's native resolution, the
player auto-selects a lower quality tier. The user can override at any time via the dropdown.

---

### Player Tools Panel

The sliders button in the video controls opens a four-tab tools panel.

**Playback tab**

- Speed: 0.25x to 4x
- A/B loop: set in and out points to loop a segment
- Frame step: advance or rewind one frame at a time
- Aspect ratio: override the auto-detected ratio (see below)
- Jump to time: enter a timestamp to seek directly

**Video tab**

Brightness, contrast, saturation, and hue controls applied via CSS filter. Changes are
non-destructive and reset on next load.

**Audio tab**

Powered by the Web Audio API, initialized on first use to avoid autoplay restrictions.

- 10-band equalizer with presets: Flat, Rock, Pop, Jazz, Classical, Bass, Treble, Vocal
- Compressor toggle
- Volume boost: up to 200% of native volume
- Stereo pan

**Info tab**

- Bookmarks: saved to `localStorage` per media item, with named timestamp entries
- Chapter navigation: chapter list pulled from the media item metadata
- Snapshot: downloads the current video frame as a PNG file

---

### Aspect Ratio

The player detects the native video dimensions on load and sets the aspect ratio automatically.
To override, use Playback tab → Aspect Ratio in the tools panel.

---

## 8. Upgrading

1. Pull or copy new source
2. Rebuild + restart, from the compose file's directory:
   ```bash
   cd /home/joe/docker/unified-media
   docker compose build --no-cache unified-frontend
   docker compose up -d --force-recreate unified-frontend
   ```
3. Migrations run automatically on startup — no manual SQL needed

The `unified-db` volume persists across rebuilds. Never remove it without a backup:

```bash
docker run --rm -v unified-db:/data -v $(pwd):/backup alpine \
  tar czf /backup/unified-db-$(date +%Y%m%d).tar.gz /data
```
