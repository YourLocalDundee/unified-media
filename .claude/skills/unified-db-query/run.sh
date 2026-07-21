#!/bin/bash
# run.sh — run an ad-hoc script or one-off SQL against the LIVE unified-frontend container.
#
# Usage:
#   run.sh path/to/script.cjs [args...]    copy a prewritten script into the container and run it,
#                                            forwarding any extra args as argv to the script
#   run.sh --sql "SELECT * FROM users"      one-off query or mutation against /data/unified.db,
#                                            JSON-printed (SELECT rows, or the mutation's info
#                                            object for INSERT/UPDATE/DELETE)
#
# Why this exists instead of `docker exec unified-frontend node -e '...'`:
#   - The container's package.json sets "type": "module", so a plain .js file is parsed as ESM
#     and a top-level require() throws ("require is not defined in ES module scope"). Scripts
#     must have a .cjs extension.
#   - Node's module resolution walks up from the *importing file's own directory*, not cwd — a
#     script placed anywhere other than /app/ (e.g. /tmp) cannot find better-sqlite3 and the
#     app's other deps. Everything must land under /app/ inside the container.
#   - docker cp writes as root regardless of the container's runtime user, so cleanup
#     (`rm /app/whatever.cjs` run AS the container) can fail with Permission Denied — that's
#     expected and harmless; the file is wiped on the next image rebuild, don't fight it.
#
# Override the container name via UNIFIED_CONTAINER if you're pointed at a differently-named
# deployment (defaults to the standard `unified-frontend`).
set -euo pipefail

CONTAINER="${UNIFIED_CONTAINER:-unified-frontend}"

usage() {
  echo "usage: $0 <script.cjs> | --sql \"<SQL statement>\"" >&2
  exit 1
}

if [[ $# -lt 1 ]]; then usage; fi

if [[ "$1" == "--sql" ]]; then
  [[ $# -ge 2 ]] || usage
  SQL="$2"
  TMP_LOCAL="$(mktemp /tmp/unified-db-query-XXXXXX.cjs)"
  trap 'rm -f "$TMP_LOCAL"' EXIT
  cat > "$TMP_LOCAL" <<'EOF'
const Database = require('better-sqlite3')
const db = new Database('/data/unified.db')
const sql = process.env.UNIFIED_DB_SQL
const stmt = db.prepare(sql)
const result = stmt.reader ? stmt.all() : stmt.run()
console.log(JSON.stringify(result, null, 1))
EOF
  # mktemp defaults to mode 600 (owner-only) — docker cp preserves that, and the container
  # runs as a non-root user, so an unreadable copy fails with EACCES on require(). Widen it.
  chmod 644 "$TMP_LOCAL"
  NAME="$(basename "$TMP_LOCAL")"
  docker cp "$TMP_LOCAL" "$CONTAINER:/app/$NAME" >/dev/null
  docker exec -e "UNIFIED_DB_SQL=$SQL" "$CONTAINER" node "/app/$NAME"
  exit 0
fi

SCRIPT="$1"
shift
NAME="$(basename "$SCRIPT")"
if [[ "$NAME" != *.cjs ]]; then
  echo "error: script must have a .cjs extension (see comment at top of this file for why)" >&2
  exit 1
fi
docker cp "$SCRIPT" "$CONTAINER:/app/$NAME" >/dev/null
# docker cp preserves the source file's mode; if it's owner-only (e.g. 600), the container's
# non-root runtime user can't read it and require() fails with EACCES. Widen it after copy
# (chmod on the source could surprise the caller if it's a real file they own elsewhere).
docker exec --user root "$CONTAINER" chmod 644 "/app/$NAME"
docker exec "$CONTAINER" node "/app/$NAME" "$@"
