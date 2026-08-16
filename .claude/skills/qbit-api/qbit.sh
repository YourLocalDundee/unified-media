#!/usr/bin/env bash
# Run qbit.cjs against the download client. THERE IS NO NODE ON THIS HOST, so everything runs
# inside a container -- node:24-slim, which is already pulled (it is the app image's base).
#
#   ./qbit.sh list
#   ./qbit.sh raw GET /api/v2/app/version
#   ./qbit.sh add '<magnet>' --category movies
#
# It joins `gluetun_default` on purpose. The client lives in gluetun's network namespace and its
# WebUI is published on <lan-ip>:8090, but DO NOT use that: qBittorrent 5.2 validates the Host
# header and answers a bare 401 -- indistinguishable from a wrong password -- when addressed that
# way. Inside the network, gluetun:8080 (exactly what UMT_URL holds) authenticates fine.
#
# Credentials are mounted read-only and read INSIDE the container; they are never passed as an
# argument and never printed.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="${QBIT_IMAGE:-node:24-slim}"
ENV_FILE="${QBIT_ENV_FILE:-/home/joe/docker/unified-media/.env}"

if [ ! -r "$ENV_FILE" ]; then
  echo "cannot read env file: $ENV_FILE" >&2
  exit 2
fi

exec docker run --rm -i \
  --network gluetun_default \
  -u "$(id -u):$(id -g)" \
  -v "$HERE":/w \
  -v "$ENV_FILE":/env/app.env:ro \
  -w /w \
  -e QBIT_ENV_FILE=/env/app.env \
  -e HOME=/tmp \
  "$IMAGE" node qbit.cjs "$@"
