# Authentik Setup for unified-frontend

Target: `https://unified.minijoe.dev` protected by Authentik forward_auth via the embedded outpost.
Estimated time: under 5 minutes.

---

## Step 1 — Create a Proxy Provider

1. Go to `https://auth.minijoe.dev` and log in as admin.
2. Navigate to **Admin Interface** (top-right gear icon) → **Applications** → **Providers** → **Create**.
3. Select **Proxy Provider** and click **Next**.
4. Fill in:
   - **Name:** `unified-frontend`
   - **Authorization flow:** select the existing implicit/authorization flow (the same one used by seerr, jellyfin, etc.)
   - **Mode:** `Forward auth (single application)`
   - **External host:** `https://unified.minijoe.dev`
   - **Internal host:** leave blank (Caddy handles routing, not Authentik)
5. Click **Finish**.

---

## Step 2 — Create an Application

1. Navigate to **Applications** → **Applications** → **Create**.
2. Fill in:
   - **Name:** `unified-frontend`
   - **Slug:** `unified-frontend`
   - **Provider:** select `unified-frontend` (the provider you just created)
   - **Launch URL:** `https://unified.minijoe.dev`
   - **Icon:** optional
3. Click **Create**.

---

## Step 3 — Add to the Embedded Outpost

1. Navigate to **Applications** → **Outposts**.
2. Find the **authentik Embedded Outpost** — this is the same outpost used by seerr, jellyfin, pihole, and grafana. You can confirm by editing the seerr application and checking which outpost it references.
3. Click **Edit** on the embedded outpost.
4. In the **Applications** multi-select, add `unified-frontend` to the selected list.
5. Click **Update**.

---

## Step 4 — Reload Authentik and Verify

```bash
# Restart authentik-server and worker so the outpost picks up the new provider immediately.
# Both are required (Lesson #43 — worker triggers the outpost reload Celery task).
cd /opt/docker/compose && docker compose restart authentik-server authentik-worker && sleep 45

# Test that forward_auth is working.
# Expected: 302 redirect to auth.minijoe.dev (not a 404, 502, or direct hit).
curl -I https://unified.minijoe.dev
```

If you get a 302 to `auth.minijoe.dev`, Authentik is working correctly.

---

## Known gotchas

- The embedded outpost picks up config changes within ~30s on its own, but restarting authentik-server forces an immediate reload. If the first restart cycle doesn't take, run it a second time.
- If you get a 404 at `https://unified.minijoe.dev` after setup, check BunkerWeb first. The domain needs a `SERVER_NAME` entry in the edge compose and a matching `_REVERSE_PROXY_HOST` — the WAF may not have `unified.minijoe.dev` configured yet (see BunkerWeb domain setup in the main CLAUDE.md Pattern A checklist).
- The Caddy block uses `forward_auth` which means Authentik redirects unauthenticated users to the login page. Authenticated users pass through with `X-Authentik-*` headers injected, which the unified-frontend app can read for user identity.
- `editByNameType` silently no-ops for non-existent DNS records. If the Porkbun DDNS script has been run but `unified.minijoe.dev` doesn't resolve yet, the A record may not exist in Porkbun. Create it manually in the Porkbun DNS dashboard first (point it at your current public IP), then the DDNS script will manage it going forward.
