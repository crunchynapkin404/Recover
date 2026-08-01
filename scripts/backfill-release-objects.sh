#!/usr/bin/env bash
# Backfill the four GitHub release objects whose tags shipped without one.
#
# v0.28.0, v0.28.1, v0.29.0 and v0.30.0 were all tagged, image-built and
# deployed; only the release PAGES are missing, because RELEASING.md's last
# step (gh release create) feels optional once the tag has already published
# the image. Check `gh release list` against `git tag` at the end of every
# release.
#
# Every one takes --latest=false: v0.31.0 is newer than all four and must
# keep the "Latest" badge. Creating them ascending without this flag would
# park the badge mid-sequence.
#
# Body convention (matches every existing release): the CHANGELOG section
# verbatim, minus its own `## ` heading line. Title: the tag annotation
# subject.
set -euo pipefail
cd "$(dirname "$0")/.."

for v in v0.28.0 v0.28.1 v0.29.0 v0.30.0; do
  if gh release view "$v" >/dev/null 2>&1; then
    echo "== $v already has a release object, skipping"
    continue
  fi

  notes=$(mktemp)
  # Print the section for this version, dropping its heading line, stopping
  # at the next `## ` heading. Headings carry the `v` prefix
  # (`## v0.28.0 — 2026-07-29 — The Race Sets the Week`), so $v is used
  # as-is; stripping it matches nothing and the guard below fires.
  awk -v ver="$v" '
    index($0, "## " ver " ") == 1 { found=1; next }
    found && /^## / { exit }
    found { print }
  ' CHANGELOG.md > "$notes"

  if [ ! -s "$notes" ]; then
    echo "!! no CHANGELOG section found for $v — aborting" >&2
    exit 1
  fi

  title=$(git tag -l --format='%(contents:subject)' "$v")
  echo "== creating $v — $title"
  gh release create "$v" \
    --title "$title" \
    --notes-file "$notes" \
    --latest=false
  rm -f "$notes"
done

echo
echo "Done. Verify the gap is closed:"
echo "  gh release list --limit 10"
