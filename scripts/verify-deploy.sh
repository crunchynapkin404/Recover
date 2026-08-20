#!/usr/bin/env bash
# Confirms prod is actually running the digest that was promoted.
#
# promote.yml runs on GitHub's runners, which cannot reach the prod box — so it
# can go green while prod sits on the old image: watchtower wedged, poll
# misconfigured, pull failing. Nothing else would say so.
#
# This is the closing step of a release, and the first thing that would have
# caught 2026-08-07, recorded in docker-compose.yml's own comments, when the app
# was healthy on its IP while the Cloudflare tunnel served 502s.
#
# TRACKED, and therefore carries NO host defaults. This repository is public.
# The hosts live in scripts/live-verify-deploy.sh — untracked
# (.gitignore: scripts/live-*.sh) — which is a thin wrapper around this file,
# and in the PROD_HOST/PROD_URL repository secrets that finish-release.yml
# passes. Splitting it this way is what lets a workflow checkout call it at all:
# the old single script could never be checked out, because it was gitignored.
#
# Usage: PROD_HOST=… PROD_URL=… scripts/verify-deploy.sh sha256:<digest>
#        TIMEOUT_S=40 … scripts/verify-deploy.sh sha256:<digest>   # fail fast
set -euo pipefail

WANT="${1:?usage: verify-deploy.sh sha256:<digest>}"
PROD_HOST="${PROD_HOST:?PROD_HOST is required (this script carries no host defaults)}"
PROD_URL="${PROD_URL:?PROD_URL is required (this script carries no host defaults)}"
PROD_CONTAINER="${PROD_CONTAINER:-recover-app-1}"
TIMEOUT_S="${TIMEOUT_S:-420}"

fail() {
  echo "verify: FAIL — $*" >&2
  exit 1
}

echo "verify: waiting for prod to run $WANT (watchtower polls every 300s)"
deadline=$((SECONDS + TIMEOUT_S))
running=""
while [ "$SECONDS" -lt "$deadline" ]; do
  # RepoDigests is a property of the IMAGE, not the container, so the
  # container's image has to be resolved first — inspecting the container for
  # RepoDigests fails with "map has no entry for key".
  running=$(ssh -o BatchMode=yes "$PROD_HOST" \
    "docker image inspect \$(docker inspect $PROD_CONTAINER --format '{{.Image}}') --format '{{index .RepoDigests 0}}'" \
    2>/dev/null | sed 's/.*@//') || true
  [ "$running" = "$WANT" ] && break
  sleep 20
done
[ "$running" = "$WANT" ] || fail "prod is running ${running:-nothing}, expected $WANT"
echo "verify: digest matches"

# "starting" is the healthcheck's start_period (60s, covering boot migrations),
# not a verdict. Treating it as failure made this script fail its own first real
# use: watchtower had deployed the right digest and the container was still
# inside its grace window.
echo "verify: waiting for the healthcheck to resolve"
health_deadline=$((SECONDS + 180))
while [ "$SECONDS" -lt "$health_deadline" ]; do
  state=$(ssh -o BatchMode=yes "$PROD_HOST" \
    "docker inspect $PROD_CONTAINER --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}'")
  [ "$state" != "starting" ] && break
  sleep 10
done

case "$state" in
none)
  echo "verify: WARNING — no healthcheck on this container. Prod's stack file"
  echo "        predates v0.104.0; copy docker-compose.yml's app healthcheck to"
  echo "        /opt/stacks/recover/docker-compose.yml."
  ;;
healthy) echo "verify: container healthy" ;;
*) fail "container health is '$state'" ;;
esac

health=$(curl -fsS --max-time 10 "$PROD_URL/api/health") || fail "/api/health unreachable"
echo "$health" | grep -q '"status":"ok"' || fail "/api/health not ok: $health"
echo "$health" | grep -q '"db":"up"' || fail "database not up: $health"

# backupAgeS is null when the freshness notify never lands. Until v0.104.0 that
# was permanent — src/proxy.ts 307'd /api/internal to /login on every nightly
# run — so a null here after this release means the fix regressed, not that a
# backup is merely overdue.
if echo "$health" | grep -q '"backupAgeS":null'; then
  fail "backupAgeS is null — the backup freshness notify is not landing"
fi

echo "verify: OK — $health"

# Record this as the known-good state, so scripts/live-drift-check.sh has an
# expectation that does NOT come from the registry.
#
# That distinction is the whole point. Comparing prod against `:latest` would
# have called both v0.104.0 failures healthy: a rebuild moved `:latest` and
# prod together, so they agreed with each other while agreeing on the wrong
# image. The expectation has to be an immutable record of what was actually
# soaked, written at the moment a human verified it.
STATE_FILE="${HOME}/.recover-promoted"
printf '%s %s\n' "$WANT" "$(date -Is)" >"$STATE_FILE"
chmod 600 "$STATE_FILE"
echo "verify: recorded as known-good in $STATE_FILE"
