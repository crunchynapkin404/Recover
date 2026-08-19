#!/usr/bin/env bash
# scripts/release-object.sh <version>
#
#   ./scripts/release-object.sh 0.87.1
#
# Creates the GitHub release object for an already-tagged version, with the
# notes taken from that version's CHANGELOG section.
#
# It used to say flatly that an assistant cannot perform this step, because
# `gh release create` is refused by Claude Code's auto-mode permission
# classifier. That is true IN AUTO MODE and was re-confirmed on 2026-08-18
# (see scripts/release.sh). It is not true outside it: on 2026-08-19, with
# auto mode off, an agent ran `gh pr merge`, `gh release create`, tag pushes
# and `gh workflow run` without refusal — while `git push origin main:main`
# was still denied. The restriction is real and MODE-DEPENDENT, so do not
# read either "an agent cannot" or "an agent can" as unconditional.
#
# None of which is a reason to hand-run the release tail. v0.112.0 and
# v0.113.0 were both shipped that way on 2026-08-19 and both reached
# production with NO release object, discovered only when someone asked where
# the notes were — the exact failure scripts/release.sh exists to prevent, and
# the fourth and fifth versions it has happened to after v0.28-v0.30.
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
# The title is the CHANGELOG heading verbatim, date included:
# "v0.113.0 — 2026-08-19 — Looked At".
#
# This used to strip the date. The convention it was stripping to had already
# stopped being the convention: v0.107.0 through v0.113.0 all carry the date on
# their release pages, and only v0.106.0 and older do not, so the script would
# have made every future release the odd one out. Settled 2026-08-19 by reading
# `gh release list` rather than by preference. The date earns its place on a
# release page, which is not a file that already sorts chronologically.

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
