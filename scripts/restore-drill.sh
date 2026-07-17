#!/usr/bin/env bash
# Restore drill: prove the latest nightly dump restores into a clean
# Postgres, unattended. Run from anywhere on the host:
#   scripts/restore-drill.sh
# Exit 0 = PASS. Exit 1 = the first failed check, named on stderr.
set -euo pipefail

VOLUME="${RECOVER_BACKUP_VOLUME:-recover_recover-backups}"
NAME="recover-restore-drill-$$"

fail() {
  echo "drill: FAIL — $*" >&2
  exit 1
}

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "drill: starting scratch postgres ($NAME)"
docker run -d --name "$NAME" \
  -e POSTGRES_USER=recover -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=recover \
  -v "$VOLUME":/backups:ro \
  postgres:16-alpine >/dev/null

ready=false
for _ in $(seq 1 30); do
  if docker exec "$NAME" pg_isready -U recover -d recover >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
$ready || fail "scratch postgres not ready after 30s"

LATEST=$(docker exec "$NAME" sh -c 'ls /backups/recover-*.dump 2>/dev/null | sort | tail -n 1')
[ -n "$LATEST" ] || fail "no recover-*.dump found in volume $VOLUME"
echo "drill: restoring $LATEST"
docker exec "$NAME" pg_restore -U recover -d recover --no-owner "$LATEST" ||
  fail "pg_restore exited non-zero"

check() { docker exec "$NAME" psql -U recover -d recover -tA -c "$1"; }

for t in users wellness_daily activities daily_metrics; do
  [ "$(check "SELECT to_regclass('public.$t') IS NOT NULL")" = "t" ] ||
    fail "table $t missing after restore"
done
[ "$(check 'SELECT count(*) FROM users')" -ge 1 ] || fail "users table is empty"
[ "$(check 'SELECT count(*) FROM wellness_daily')" -gt 0 ] || fail "wellness_daily is empty"
echo "drill: newest wellness date: $(check 'SELECT max(date) FROM wellness_daily')"
echo "drill: PASS — $LATEST restored into a clean database"
