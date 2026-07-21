#!/bin/sh
# Nightly pg_dump for Recover. Runs inside the backup sidecar
# (postgres:16-alpine, busybox sh); crond triggers it at 03:30. Connection
# comes from PGHOST/PGUSER/PGPASSWORD/PGDATABASE in the environment.
#
# v0.20: on a successful rotate, notifies the app so /api/health and
# /api/metrics can report backup freshness (BACKUP_NOTIFY_URL/_SECRET below).
# Uses wget, not curl — postgres:16-alpine (busybox) ships wget but not curl.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP="${BACKUP_KEEP:-14}"
case "$KEEP" in
  '' | *[!0-9]*) KEEP=14 ;; # non-numeric → default
esac
[ "$KEEP" -ge 1 ] || KEEP=1 # 0 would delete the dump we just wrote
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="$BACKUP_DIR/recover-$STAMP.dump.tmp"
OUT="$BACKUP_DIR/recover-$STAMP.dump"

# A failed run must leave no .tmp behind (and never touches old dumps —
# rotation only runs after a successful dump below).
trap 'rm -f "$TMP"' EXIT

echo "backup: dumping to $OUT"
pg_dump -Fc -f "$TMP"
mv "$TMP" "$OUT"
echo "backup: wrote $OUT ($(du -h "$OUT" | cut -f1))"

count=$(ls "$BACKUP_DIR"/recover-*.dump | wc -l)
excess=$((count - KEEP))
if [ "$excess" -gt 0 ]; then
  ls "$BACKUP_DIR"/recover-*.dump | sort | head -n "$excess" | while read -r old; do
    echo "backup: rotating out $old"
    rm -f "$old"
  done
fi
echo "backup: done, $(ls "$BACKUP_DIR"/recover-*.dump | wc -l) dump(s) retained (keep $KEEP)"

# Notify the app of the successful rotate so /api/health and /api/metrics
# can report backup freshness. Best-effort: the dump is already safely on
# disk by this point, so a notify failure (app down, bad secret, network
# blip) must not fail the backup job — it only logs.
NOTIFY_URL="${BACKUP_NOTIFY_URL:-http://app:3000/api/internal/backup-complete}"
if [ -n "${BACKUP_NOTIFY_SECRET:-}" ]; then
  if wget -q -O /dev/null -T 5 \
      --header="Authorization: Bearer $BACKUP_NOTIFY_SECRET" \
      --post-data='' \
      "$NOTIFY_URL"; then
    echo "backup: notified $NOTIFY_URL"
  else
    echo "backup: notify to $NOTIFY_URL failed (non-fatal)"
  fi
else
  echo "backup: BACKUP_NOTIFY_SECRET not set, skipping freshness notify"
fi
