# Rust Conversion Baseline (captured before Phase 1)

Captured 2026-07-15, before any Rust service exists, so Phase 7.3's before/after comparison has real
numbers. Re-run `docker stats --no-stream` for the same containers if this goes stale before Phase 7.

## Idle RSS (docker stats --no-stream)

| Container | Mem usage | CPU % |
| --- | --- | --- |
| unified-frontend | 110.2MiB / 2GiB | 0.02% |
| prowlarr | 190.2MiB / 14.84GiB | 0.10% |
| sonarr | 185.8MiB / 14.84GiB | 0.06% |
| radarr | 171MiB / 14.84GiB | 0.08% |
| bazarr | 155.6MiB / 14.84GiB | 0.24% |
| qbittorrent | 8.93MiB / 1GiB | 0.06% |
| seerr | 161.7MiB / 14.84GiB | 0.00% |

## Image sizes

- `compose-unified-frontend:latest` — 1.14GB
- `unified-frontend:latest` (stale bare-build tag, not what's deployed) — 1.18GB

## Known gaps (capture before Phase 1 cutover, not deferred to 7.3)

- **Indexer scan wall time** — not yet captured. Needs an authenticated hit against
  `/api/search` or `/api/torznab/search` timed end-to-end. Do this in the Phase 1 kickoff session
  before um-indexer exists, using real admin creds.
- **API p95s** — not available from Grafana. `unified-frontend` has no `prom-client` / `/metrics`
  export today (confirmed via grep, no hits). This is itself a gap the Rust services close (every
  Rust service ships tracing + `/metrics` from day one per the ground rules). Without a pre-existing
  histogram there is no p95 baseline to diff against later — note this honestly in 7.3 rather than
  fabricating one.
