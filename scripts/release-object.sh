#!/usr/bin/env bash
# scripts/release-object.sh <version>
#
#   ./scripts/release-object.sh 0.87.1
#
# Creates the GitHub release object for an already-tagged version, with the
# notes taken from that version's CHANGELOG section. This is the one step of
# docs/RELEASING.md an assistant cannot perform: `gh release create` is
# refused by Claude Code's auto-mode permission classifier (see the header of
# scripts/release.sh). Run it yourself.
#
# Generic on purpose -- v0.86 and v0.87 each got a throwaway one-off script
# before this existed.
set -euo pipefail

VERSION="${1:?usage: release-object.sh <version>   e.g. 0.87.1}"
TAG="v${VERSION}"

cd "$(dirname "$0")/.."

if ! git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Tag ${TAG} does not exist. Tag first (docs/RELEASING.md step 6)." >&2
  exit 1
fi

ESC="${VERSION//./\\.}"
TITLE="$(awk -v t="^## v${ESC} " '$0 ~ t {sub(/^## /, ""); print; exit}' CHANGELOG.md)"
if [ -z "$TITLE" ]; then
  echo "No CHANGELOG heading found for ${TAG}." >&2
  exit 1
fi
# Release titles drop the date the CHANGELOG heading carries: "v0.87.1 — Name".
TITLE="$(sed -E 's/ — [0-9]{4}-[0-9]{2}-[0-9]{2} — / — /' <<<"$TITLE")"

NOTES="$(mktemp)"
trap 'rm -f "$NOTES"' EXIT
awk -v start="^## v${ESC} " '
  $0 ~ start {f=1; next}
  /^## v/ {f=0}
  f
' CHANGELOG.md > "$NOTES"

if [ ! -s "$NOTES" ]; then
  echo "No CHANGELOG body found for ${TAG}." >&2
  exit 1
fi

gh release create "$TAG" --title "$TITLE" --notes-file "$NOTES"
echo
echo "Done. Verify with: gh release view ${TAG}"
