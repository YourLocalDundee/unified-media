#!/usr/bin/env bash
# No-browser fast path. Authenticates against the app's own API and makes requests with the
# session cookie. Runs curl on the host — no docker, no chromium.
#
#   ./api.sh /api/auth/me
#   ./api.sh /api/media/items?limit=5
#   ./api.sh -X POST /api/admin/scan
#
# ~10ms per call versus ~1.9s for a browser flow, because it skips the container, the browser
# launch, and hydration entirely.
#
# USE THIS WHEN the question is about DATA — does the API return the right rows, did the scan
# run, is this item marked watched. Use ./run.sh (real browser) when the question is about
# RENDERING or client behaviour. This app is client-rendered: fetching a PAGE over HTTP returns
# a 13KB shell of script tags with none of the visible text in it, so HTTP cannot answer "did it
# render correctly". API routes are server-rendered and return real JSON, so it answers data
# questions perfectly.
set -euo pipefail

# The app runs under Next basePath /unified, and this talks to it DIRECTLY — so it does not
# get Caddy's /api/* -> /unified/api/* rewrite and must carry the prefix itself.
BASE="${DRIVE_BASE_URL:-http://localhost:3001/unified}"

# No Origin header is sent on purpose. localhost is no longer in the CSRF allowlist (it was
# removed when the app went public), and verifyOrigin() allows a request with no Origin at
# all — which is what a non-browser client like curl should look like anyway.
ENV_FILE="${DRIVE_ENV_FILE:-/home/joe/docker/unified-media/.env}"
JAR="${DRIVE_COOKIE_JAR:-/tmp/unified-api-cookies-$UID}"

if [ $# -eq 0 ]; then
  echo "usage: $0 [curl-opts…] <path>    e.g. $0 /api/auth/me" >&2
  exit 2
fi

# Credentials are read straight into curl's stdin, never into a variable that could be echoed,
# never onto a command line where they would land in ps output or shell history.
login() {
  local user pass
  user="$(grep -m1 '^ADMIN_USERNAME=' "$ENV_FILE" | cut -d= -f2-)"
  pass="$(grep -m1 '^ADMIN_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
  [ -n "$pass" ] || { echo "ADMIN_PASSWORD not found in $ENV_FILE" >&2; exit 1; }
  # --data @- keeps the password off the argv list.
  printf '{"username":%s,"password":%s}' \
    "$(printf '%s' "$user" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
    "$(printf '%s' "$pass" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
  | curl -sS -o /dev/null -c "$JAR" -H 'Content-Type: application/json' \
      --data @- "$BASE/api/auth/login"
  chmod 600 "$JAR"
}

# Reuse the existing session if it is still valid; only log in when it is not. Saves a round trip
# on every call after the first.
if [ ! -f "$JAR" ] || ! curl -sS -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE/api/auth/me" | grep -q '^200$'; then
  login
fi

# Last argument is the path; anything before it is passed through to curl untouched, so
# `-X POST`, `-H …`, `--data …` all work.
args=("$@")
path="${args[-1]}"
unset 'args[-1]'
case "$path" in
  http://*|https://*) url="$path" ;;
  /*) url="$BASE$path" ;;
  *) url="$BASE/$path" ;;
esac

exec curl -sS -b "$JAR" -c "$JAR" "${args[@]}" "$url"
