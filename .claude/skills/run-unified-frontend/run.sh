#!/usr/bin/env bash
# Run a whole browser flow in one shot and print a compact per-step result.
#
#   ./run.sh flows/smoke.flow          run a flow file
#   ./run.sh -                         read the flow from stdin (heredoc)
#
# Everything runs inside the pinned Playwright image because THERE IS NO NODE ON THIS HOST.
# Do not try to `npm install` or `npx playwright` directly on minime — it will not work, and
# installing node here just to run tests is not worth it.
#
# Image is pinned to v1.50.0 on purpose: the `playwright` package in ./node_modules must match
# the browser build baked into the image, or Chromium won't launch. Bump both together or
# neither. (`mcr.microsoft.com/playwright:latest` is a stale alias for v1.46.1 — too old for
# ariaSnapshot. Don't use it.)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="${DRIVE_IMAGE:-mcr.microsoft.com/playwright:v1.50.0-noble}"

# The deployed unified-frontend container publishes 3001 on the host, so --network host reaches
# it at localhost:3001 with no compose-network juggling and no container-IP lookup.
BASE_URL="${DRIVE_BASE_URL:-http://localhost:3001}"

# Credentials are mounted read-only and read INSIDE the driver process; they are never passed as
# an argument and never printed. See SKILL.md "Logging in".
ENV_FILE="${DRIVE_ENV_FILE:-/home/joe/docker/unified-media/.env}"

if [ ! -r "$ENV_FILE" ]; then
  echo "cannot read env file: $ENV_FILE" >&2
  exit 2
fi

FLOW="${1:-}"
if [ -z "$FLOW" ]; then
  echo "usage: $0 <flow-file>   ('-' to read the flow from stdin)" >&2
  exit 2
fi

DOCKER_ARGS=(
  --rm -i
  --network host
  -u "$(id -u):$(id -g)"
  -v "$HERE":/w
  -v "$ENV_FILE":/env/app.env:ro
  -w /w
  -e "DRIVE_BASE_URL=$BASE_URL"
  -e DRIVE_ENV_FILE=/env/app.env
  -e "DRIVE_HOST_DIR=$HERE"
  -e HOME=/tmp
)

if [ "$FLOW" = "-" ]; then
  exec docker run "${DOCKER_ARGS[@]}" "$IMAGE" node drive.mjs -
else
  # Flow files live under this directory, so they are already inside the mount.
  REL="${FLOW#"$HERE"/}"
  exec docker run "${DOCKER_ARGS[@]}" "$IMAGE" node drive.mjs "$REL"
fi
