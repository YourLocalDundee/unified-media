# Unified Frontend — Setup Guide

Self-hosted single-pane-of-glass for the minime media stack. A fully native media server for
browsing and playback, integrated with the old request app (requests) and qBittorrent (downloads), with its own
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

Copy the template and fill in values:

```bash
cp /home/joe/unified-media/app/.env.local.example \
   /home/joe/unified-media/app/.env.local
```

Required variables:

| Variable | Where to find it |
|---|---|
| `a retired env var` | `http://the old request app:5055` (container name on compose_default) |
| `a retired env var` | `/opt/docker/configs/the old request app/settings.json` → `main.apiKey` |
| `QBIT_URL` | `http://qbittorrent:8080` |
| `QBIT_USERNAME` | qBittorrent web UI credentials |
| `QBIT_PASSWORD` | qBittorrent web UI credentials |
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

## 2. Build the Docker image

```bash
cd /home/joe/unified-media/app
docker build -t unified-frontend:latest .
```

The Dockerfile uses multi-stage build: Node 22 Alpine builder → minimal runner.
Output mode is `standalone` — no `node_modules` in the final image.

---

## 3. Add to docker-compose

Add this service to `/home/joe/docker/unified-media/docker-compose.yml`:

```yaml
  unified-frontend:
    image: unified-frontend:latest
    container_name: unified-frontend
    restart: unless-stopped
    env_file:
      - /home/joe/unified-media/app/.env.local
    environment:
      - NODE_ENV=production
      - a retired env var=http://the old request app:5055
      - QBIT_URL=http://qbittorrent:8080
    volumes:
      - unified-db:/data
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3001/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
    labels:
      - "com.centurylinklabs.watchtower.enable=false"

volumes:
  unified-db:
```

Then start it:

```bash
docker compose up -d unified-frontend
```

Watch the logs for the seed message:

```
[seed] Admin account created. Username: admin
```

If you see `[seed] ADMIN_USERNAME and ADMIN_PASSWORD are required`, the env vars are missing.

---

## 4. Caddy configuration

The app handles its own auth — no `forward_auth` / external auth gateway needed.

Run the update script to replace the Caddyfile block:

```bash
python3 /home/joe/unified-media/scripts/update-caddyfile.py
```

Verify the new block looks like:

```caddyfile
<app-host> {
    import compressed
    reverse_proxy unified-frontend:3001
}
```

Apply it — **`caddy reload` alone is not enough**:

```bash
docker exec caddy grep <app-host> /etc/caddy/Caddyfile   # confirm the container SEES the change
docker compose up -d caddy                              # recreate if it does not
```

The Caddyfile is a single-file bind mount and Docker binds single files by inode. Any editor that
writes a temp file and renames it swaps the inode and silently detaches the mount, after which
`caddy reload` re-reads the stale file, reports success, and changes nothing. Hit for real
2026-08-11.

---

## 5. First login

1. Navigate to `https://<app-host>`
2. Log in with `ADMIN_USERNAME` and `ADMIN_PASSWORD` you set in `.env.local`
3. Go to `/admin/invites` to create invite codes for other users

---

## 6. Adding users

1. Admin goes to `/admin/invites` → Create an invite code
2. Copy the link: `https://<app-host>/invite/{code}`
3. Send it to the user
4. User visits the link, fills in username and password, account is created

Invite codes can be set with a max-use count and expiry date.

---

## 7. Development

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

## 8. Video Player Features

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

## 9. Upgrading

1. Pull or copy new source
2. Rebuild: `docker build -t unified-frontend:latest /home/joe/unified-media/app`
3. Restart: `docker compose up -d --force-recreate unified-frontend`
4. Migrations run automatically on startup — no manual SQL needed

The `unified-db` volume persists across rebuilds. Never remove it without a backup:

```bash
docker run --rm -v unified-db:/data -v $(pwd):/backup alpine \
  tar czf /backup/unified-db-$(date +%Y%m%d).tar.gz /data
```
