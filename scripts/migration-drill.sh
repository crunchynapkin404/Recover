#!/usr/bin/env bash
# Migration drill: proves the drizzle migration chain applies cleanly, in
# two complementary ways, both against scratch Postgres containers this
# script creates and destroys itself. NEVER touches the live DB. Must be
# run from the repo root (it resolves relative paths — drizzle/*.sql,
# .env):
#   scripts/migration-drill.sh
# Exit 0 = PASS. Exit 1 = the first failed check, named on stderr.
#
#   Phase A — restore a REAL nightly pg_dump (from the backups volume:
#   real production data shape, real row counts) into a scratch DB, then
#   run `npm run db:migrate` against it. What this step actually exercises
#   is dump-timing-dependent, not a fixed property of this script: it
#   depends on how the newest nightly dump's schema state compares to the
#   latest migration on disk at the moment the drill runs.
#     - If the dump predates the latest migration(s) — taken before those
#       migrations existed — migrate genuinely APPLIES them against real
#       restored production data. This is the strongest coverage the
#       drill can offer: a real dump plus real pending migrations on top,
#       which is the exact real-world upgrade scenario.
#     - If the dump is already at the latest migration — nothing new has
#       shipped since the last nightly dump — migrate is a clean no-op.
#       That's still a genuine, valuable assertion (restoring a real dump
#       and running migrate against it does not error).
#   Either way, this makes the drill a permanent regression guard: any
#   migration that lands between now and the next nightly dump will be
#   exercised, by this exact script, against real production data shape
#   before it ships. That's what catches the classic "works against an
#   empty dev DB, breaks against a populated table" migration bug (e.g. a
#   new NOT NULL column with no default on a table that already has rows).
#
#   Phase B — run the FULL migration chain (0000 .. latest) from a
#   completely empty scratch DB. This proves the chain as a whole applies
#   cleanly end-to-end, independent of any dump's starting point — and
#   independent of whichever of the two Phase A cases above applies today.
#
# Neither phase proves "an OLD dump (several versions back) upgrades to
# the current schema under real data," because only the newest nightly
# dump is available here — older nightlies age out per the backup
# volume's retention window (see scripts/backup.sh) — so there's no
# guarantee a dump sitting on some much older schema exists to restore.
# See docs/UPGRADING.md for the honest compatibility statement this
# implies (a dump restores cleanly into the app version that made it;
# upgrading to a newer version means restore + migrate, which this drill
# is what proves works).
#
# ── Isolation, the single most important property of this script ────────
# Same non-negotiable isolation as scripts/export-import-drill.sh (which
# was independently verified safe by a reviewer who ran it and diffed the
# real DB before/after). This script:
#   - unsets DATABASE_URL/DATABASE_DRIVER from the inherited environment
#     immediately below, before doing anything else;
#   - never sources .env or reads it for connection info (only a
#     read-only string-equality safety check against it, see below);
#   - starts its own postgres:16-alpine scratch containers, bound to
#     127.0.0.1 on Docker-assigned random host ports (never a fixed or
#     guessable port, and never 5433 or 5434 — the old-retired and real
#     dev DB ports);
#   - builds each scratch DATABASE_URL itself from that container's own
#     randomly assigned port and a throwaway user/password that exist
#     only in that container's lifetime;
#   - explicitly refuses to proceed if a scratch URL is ever, by some
#     accident, identical to .env's real DATABASE_URL;
#   - tears every container down (`docker rm -f`) in a trap on EXIT,
#     success or failure.
set -euo pipefail

# Defense in depth: even though this script never reads .env, make sure
# nothing in the calling shell's environment leaks into the child
# processes below (npm run db:migrate).
unset DATABASE_URL DATABASE_DRIVER

VOLUME="${RECOVER_BACKUP_VOLUME:-recover_recover-backups}"
RUN_ID="$$"
CONTAINERS=()

fail() {
  echo "drill: FAIL — $*" >&2
  exit 1
}

cleanup() {
  local c
  for c in "${CONTAINERS[@]}"; do
    docker rm -f "$c" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

# Highest migration present right now — never hardcoded, since task order
# on this branch can still shift the count.
LATEST_SQL=$(ls drizzle/*.sql | sort | tail -n 1)
[ -n "$LATEST_SQL" ] || fail "no migration files found in drizzle/"
LATEST_TAG=$(basename "$LATEST_SQL" .sql)
EXPECTED_COUNT=$(ls drizzle/*.sql | wc -l | tr -d ' ')
LATEST_HASH=$(sha256sum "$LATEST_SQL" | cut -d' ' -f1)
echo "drill: latest migration on disk is $LATEST_TAG ($EXPECTED_COUNT files total)"

# Starts a scratch postgres:16-alpine container, waits for it to be ready,
# discovers its Docker-assigned host port, refuses known-real ports, and
# prints (to stdout, for capture) the scratch DATABASE_URL. Registers the
# container name for cleanup is the CALLER's job (done *before* invoking
# this, so a mid-startup failure still gets torn down — see call sites).
start_scratch_pg() {
  local name="$1"
  shift
  docker run -d --name "$name" \
    -e POSTGRES_USER=recover -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=recover \
    -p 127.0.0.1::5432 \
    "$@" \
    postgres:16-alpine >/dev/null || fail "could not start scratch postgres container $name"

  local ready=false
  for _ in $(seq 1 30); do
    if docker exec "$name" pg_isready -U recover -d recover >/dev/null 2>&1; then
      ready=true
      break
    fi
    sleep 1
  done
  $ready || fail "scratch postgres $name not ready after 30s"

  local port
  port=$(docker port "$name" 5432/tcp | head -n1 | cut -d: -f2)
  [ -n "$port" ] || fail "could not discover $name's mapped host port"
  [ "$port" != "5433" ] || fail "$name landed on port 5433 (old retired dev DB) — aborting"
  [ "$port" != "5434" ] || fail "$name landed on port 5434 (real dev DB, recover-db-1) — aborting"

  local url="postgres://recover:drill@127.0.0.1:${port}/recover"
  if [ -f .env ]; then
    local real_url
    real_url=$(grep -E '^DATABASE_URL=' .env | head -n1 | cut -d= -f2-)
    if [ -n "$real_url" ] && [ "$real_url" = "$url" ]; then
      fail "$name's scratch DATABASE_URL is identical to .env's DATABASE_URL — refusing to proceed"
    fi
  fi
  echo "$url"
}

# Asserts container $1's database has every migration on disk applied:
# both the row count in drizzle's own tracking table AND the exact sha256
# hash of the latest migration file's contents (drizzle-kit hashes the
# raw file, unsplit, per node_modules/drizzle-orm/pg-core/dialect.cjs).
assert_migrated_to_latest() {
  local name="$1"
  local count
  count=$(docker exec "$name" psql -U recover -d recover -tA \
    -c 'SELECT count(*) FROM drizzle."__drizzle_migrations"') ||
    fail "$name: could not read drizzle.__drizzle_migrations"
  [ "$count" -eq "$EXPECTED_COUNT" ] ||
    fail "$name: expected $EXPECTED_COUNT applied migrations, found $count"
  local hash_hit
  hash_hit=$(docker exec "$name" psql -U recover -d recover -tA \
    -c "SELECT count(*) FROM drizzle.\"__drizzle_migrations\" WHERE hash = '$LATEST_HASH'")
  [ "$hash_hit" = "1" ] ||
    fail "$name: latest migration $LATEST_TAG's hash not found in applied-migrations table"
  echo "drill: $name is at $count/$EXPECTED_COUNT migrations, latest = $LATEST_TAG"
}

# ── Phase A: restore a real dump, then migrate ──────────────────────────
NAME_A="recover-migration-drill-a-${RUN_ID}"
CONTAINERS+=("$NAME_A")
echo "drill: [phase A] starting scratch postgres for real-dump restore ($NAME_A)"
URL_A=$(start_scratch_pg "$NAME_A" -v "$VOLUME":/backups:ro)
echo "drill: [phase A] scratch DATABASE_URL is $URL_A"

LATEST_DUMP=$(docker exec "$NAME_A" sh -c 'ls /backups/recover-*.dump 2>/dev/null | sort | tail -n 1')
[ -n "$LATEST_DUMP" ] || fail "no recover-*.dump found in volume $VOLUME"
echo "drill: [phase A] restoring $LATEST_DUMP"
docker exec "$NAME_A" pg_restore -U recover -d recover --no-owner "$LATEST_DUMP" ||
  fail "[phase A] pg_restore exited non-zero"

echo "drill: [phase A] running db:migrate against the restored real dump"
DATABASE_URL="$URL_A" npm run db:migrate ||
  fail "[phase A] migrations failed against the restored real dump"
assert_migrated_to_latest "$NAME_A"
echo "drill: [phase A] PASS — $LATEST_DUMP restored and migrated cleanly to $LATEST_TAG"

# ── Phase B: full chain, from empty ─────────────────────────────────────
NAME_B="recover-migration-drill-b-${RUN_ID}"
CONTAINERS+=("$NAME_B")
echo "drill: [phase B] starting scratch postgres for full-chain-from-empty ($NAME_B)"
URL_B=$(start_scratch_pg "$NAME_B")
echo "drill: [phase B] scratch DATABASE_URL is $URL_B"

echo "drill: [phase B] running db:migrate (0000 .. $LATEST_TAG) against an empty DB"
DATABASE_URL="$URL_B" npm run db:migrate ||
  fail "[phase B] migration chain failed against an empty DB"
assert_migrated_to_latest "$NAME_B"
echo "drill: [phase B] PASS — full chain 0000..$LATEST_TAG applies cleanly to an empty DB"

echo "drill: PASS — migration chain verified against a real dump (phase A) and from empty (phase B); both scratch containers torn down"
