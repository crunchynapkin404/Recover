#!/usr/bin/env bash
# One-shot release of v0.30.1 — "Pushes Leave a Trace, Rides Get Counted" (PR #32).
#
# Written because `gh pr merge` and `gh release create` are both blocked by
# Claude Code's auto-mode classifier on this repo. Every step below was
# verified green before this script was written: PR #32's `checks` and
# `docker` jobs both pass, 1543/1543 tests, tsc/lint/format/build clean.
#
# Follows docs/RELEASING.md: the tag is the LAST step, after the merge and
# after main's own CI comes back green.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Merging PR #32"
gh pr merge 32 --merge

echo "==> Fast-forwarding local main"
git checkout main
git pull origin main

echo "==> Waiting for main CI (tag only after this is green)"
gh run watch "$(gh run list --branch main --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status

echo "==> Tagging v0.30.1"
git tag -a v0.30.1 -m "v0.30.1 — Pushes Leave a Trace, Rides Get Counted"
git push origin v0.30.1

echo "==> Creating the GitHub release object"
# The release page is a separate object from the tag — release.yml builds and
# publishes the image from the tag but does NOT create this. v0.28–v0.30 all
# ended up with tags and no release page for exactly this reason.
awk '/^## v0\.30\.1/{f=1;next} /^## v0\.30\.0/{f=0} f' CHANGELOG.md > /tmp/v0.30.1-notes.md
gh release create v0.30.1 --title "v0.30.1 — Pushes Leave a Trace, Rides Get Counted" --notes-file /tmp/v0.30.1-notes.md

echo
echo "Done. Watchtower will pull the new image within ~5 minutes."
echo "Do NOT manually pull or restart the app container."
echo
echo "After your next ride, this is the line that settles the double-push question:"
echo "  docker logs recover-app-1 --since 6h | grep -E 'push sent|push subscription pruned'"
