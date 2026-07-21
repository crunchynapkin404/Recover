#!/usr/bin/env bash
# Export -> wipe -> import round-trip drill: proves importUserData is a
# lossless inverse of exportUserData, unattended, against a scratch
# Postgres container it creates and destroys itself. Run from anywhere on
# the host:
#   scripts/export-import-drill.sh
# Exit 0 = PASS. Exit 1 = the first failed check, named on stderr.
#
# Mirrors scripts/restore-drill.sh's shape (trap-based teardown, scratch
# container lifecycle) but this drill is app-level, not just
# docker-exec/psql: it runs the real exportUserData/importUserData
# TypeScript functions against the scratch DB via scripts/export-import-drill.ts.
#
# ── Isolation, the single most important property of this script ────────
# This NEVER touches the real DATABASE_URL from .env / recover-db-1. It:
#   - unsets DATABASE_URL/DATABASE_DRIVER from the inherited environment
#     immediately below, before doing anything else;
#   - never sources .env or reads it for connection info;
#   - starts its own postgres:16-alpine container, bound to 127.0.0.1 on a
#     Docker-assigned random host port (never a fixed/guessable port, and
#     never 5433 or 5434 — the old-retired and real dev DB ports);
#   - builds DATABASE_URL itself from that container's own randomly
#     assigned port and a throwaway user/password that exist only in this
#     container's lifetime;
#   - is torn down (`docker rm -f`) in a trap on EXIT, success or failure.
set -euo pipefail

# Defense in depth: even though this script never reads .env, make sure
# nothing in the calling shell's environment leaks into the child
# processes below (npm run db:migrate, npx tsx ...).
unset DATABASE_URL DATABASE_DRIVER

NAME="recover-import-drill-$$"

fail() {
  echo "drill: FAIL — $*" >&2
  exit 1
}

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "drill: starting scratch postgres ($NAME)"
# -p 127.0.0.1::5432 (empty host port) => Docker assigns a random free
# host port, bound to loopback only — never 0.0.0.0, never a fixed port
# that could collide with recover-db-1 (5434) or the old retired dev DB
# (5433).
docker run -d --name "$NAME" \
  -e POSTGRES_USER=recover -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=recover \
  -p 127.0.0.1::5432 \
  postgres:16-alpine >/dev/null || fail "could not start scratch postgres container"

ready=false
for _ in $(seq 1 30); do
  if docker exec "$NAME" pg_isready -U recover -d recover >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
$ready || fail "scratch postgres not ready after 30s"

PORT=$(docker port "$NAME" 5432/tcp | head -n1 | cut -d: -f2)
[ -n "$PORT" ] || fail "could not discover scratch postgres's mapped host port"
[ "$PORT" != "5433" ] || fail "scratch postgres landed on port 5433 (old retired dev DB) — aborting"
[ "$PORT" != "5434" ] || fail "scratch postgres landed on port 5434 (real dev DB, recover-db-1) — aborting"

SCRATCH_DATABASE_URL="postgres://recover:drill@127.0.0.1:${PORT}/recover"
echo "drill: scratch DATABASE_URL is 127.0.0.1:${PORT} (container $NAME)"

# Explicit, automated isolation check — not just "by construction": if a
# real .env exists alongside this repo, confirm the scratch URL we just
# built is not, by some accident, identical to it. Read-only string
# comparison; the value is never exported into this process's env.
if [ -f .env ]; then
  REAL_URL=$(grep -E '^DATABASE_URL=' .env | head -n1 | cut -d= -f2-)
  if [ -n "$REAL_URL" ] && [ "$REAL_URL" = "$SCRATCH_DATABASE_URL" ]; then
    fail "scratch DATABASE_URL is identical to .env's DATABASE_URL — refusing to proceed"
  fi
fi

echo "drill: running migrations against scratch DB"
DATABASE_URL="$SCRATCH_DATABASE_URL" npm run db:migrate ||
  fail "migrations failed against scratch DB"

echo "drill: running export -> wipe -> import round trip"
DATABASE_URL="$SCRATCH_DATABASE_URL" DATABASE_DRIVER=pg \
  npx tsx scripts/export-import-drill.ts ||
  fail "export-import-drill.ts reported a failure (see output above)"

echo "drill: PASS — export -> wipe -> import round trip verified against scratch DB, container torn down"
