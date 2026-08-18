#!/usr/bin/env bash
# scripts/release.sh <version> [pr-number]
#
#   ./scripts/release.sh 0.31.0 33     # merge PR #33, then release
#   ./scripts/release.sh 0.31.0        # main is already at the commit to tag
#
# Automates docs/RELEASING.md's tail, which is the part that keeps going
# wrong: v0.28.0, v0.28.1, v0.29.0 and v0.30.0 all ended up tagged and
# image-built with NO GitHub release object, because the tag push publishes
# the image and the release therefore feels finished before the release page
# exists. This script does not let you stop half way.
#
# It used to say `gh pr merge` and `gh release create` were refused by Claude
# Code's permission classifier, so an assistant could prepare a release but
# never perform one. A 2026-08-12 note declared that dead, on the evidence
# that `gh release create --help` and `gh pr merge --help` both resolve and
# that PR #132 was opened with `gh pr create`.
#
# RE-EXAMINED 2026-08-18 (v0.108.0): that evidence does not support that
# conclusion. `--help` resolving proves the subcommand exists, not that the
# classifier permits the real invocation, and `gh pr create` being allowed
# says nothing about `gh pr merge` — creating a PR is reversible and merging
# is not, which is exactly the distinction such a classifier draws. So the
# 2026-08-12 claim is unproven rather than proven false, and v0.108.0's plan
# reports the refusal as back.
#
# Deliberately NOT re-tested here: the only honest test is a real merge of a
# real PR, which is not something to spend an open PR on to satisfy a comment.
# Whoever runs a release, run it with this script — the reason to use it is
# that it refuses to stop half way. If `gh pr merge` is refused, a human runs
# that one step; record what actually happened here rather than generalising
# from `--help`.
#
# The tag is the LAST step, and it is cut only after main's own CI for the
# exact commit being tagged comes back green.
set -euo pipefail

VERSION="${1:?usage: release.sh <version> [pr-number]}"
PR="${2:-}"
TAG="v${VERSION}"

cd "$(dirname "$0")/.."

if [ -n "$PR" ]; then
  echo "==> Merging PR #${PR}"
  gh pr merge "$PR" --merge
fi

echo "==> Fast-forwarding local main"
git checkout main
git pull origin main

SHA="$(git rev-parse HEAD)"

# Wait for the run belonging to THIS commit. An earlier version of this
# script took `gh run list --limit 1` a second after the merge, which
# returns whatever run already existed — so `gh run watch` exited
# immediately and v0.30.1 was tagged without main's CI ever being checked.
# It passed, but only by luck. Poll until the run for $SHA appears.
echo "==> Waiting for main CI on ${SHA:0:7}"
RUN_ID=""
for _ in $(seq 1 30); do
  RUN_ID="$(gh run list --branch main --json databaseId,headSha \
    --jq "[.[] | select(.headSha==\"$SHA\")][0].databaseId")"
  [ -n "$RUN_ID" ] && [ "$RUN_ID" != "null" ] && break
  sleep 10
done
if [ -z "$RUN_ID" ] || [ "$RUN_ID" = "null" ]; then
  echo "No CI run found for ${SHA:0:7} after 5 minutes — check manually." >&2
  exit 1
fi
gh run watch "$RUN_ID" --exit-status

VERSION_IN_PKG="$(node -p "require('./package.json').version")"
if [ "$VERSION_IN_PKG" != "$VERSION" ]; then
  echo "package.json says ${VERSION_IN_PKG}, you asked for ${VERSION}." >&2
  exit 1
fi

echo "==> Tagging ${TAG}"
git tag -a "$TAG" -m "$(awk -v t="^## ${TAG//./\\.} " \
  '$0 ~ t {sub(/^## /, ""); print; exit}' CHANGELOG.md)"
git push origin "$TAG"

echo "==> Creating the GitHub release object"
NOTES="$(mktemp)"
awk -v start="^## ${TAG//./\\.} " '
  $0 ~ start {f=1; next}
  /^## v/ {f=0}
  f
' CHANGELOG.md > "$NOTES"
if [ ! -s "$NOTES" ]; then
  echo "No CHANGELOG section found for ${TAG}." >&2
  exit 1
fi
gh release create "$TAG" \
  --title "$(awk -v t="^## ${TAG//./\\.} " \
    '$0 ~ t {sub(/^## /, ""); print; exit}' CHANGELOG.md)" \
  --notes-file "$NOTES"

echo
echo "Done. Watchtower pulls the new image within ~5 minutes."
echo "Do NOT manually pull or restart the app container."
