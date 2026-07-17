# Releasing

The tag is the last step, never the first. Pushing any `v*` tag builds and
publishes the Docker image from exactly that commit (`release.yml`), and
watchtower-equipped servers will run it — so whatever the tag points at _is_
the release, regardless of what the changelog next to it claims.

Born from v0.9.1: a work-in-progress commit was tagged and released before
the implementation landed. The release shipped its own tests without the
code they tested, and the published image missed half the fixes the release
notes promised.

## Checklist

1. **Branch from `main`** — `vX.Y.Z-patch` or a feature worktree branch.
2. **Implement test-first.** New behavior gets a failing test before code.
3. **In the same branch, before merging:**
   - [ ] bump `version` in `package.json` (it drifts otherwise — v0.9.0
         shipped while `package.json` still said `0.8.0`)
   - [ ] add the `CHANGELOG.md` entry (`## vX.Y.Z — date — Name`)
   - [ ] update `docs/ROADMAP.md` (tick what shipped, renumber if needed)
4. **Everything green locally:** `npm test`, `npm run lint`,
   `npm run typecheck`, `npm run build`. A red or incomplete branch is not
   taggable — there is no "placeholder" release.
5. **Merge to `main`** (PR or fast-forward) and verify `main` is green.
6. **Only now, tag the merge commit** — annotated, on `main`:
   `git tag -a vX.Y.Z -m "vX.Y.Z — Name" && git push origin vX.Y.Z`
7. **Watch the release build** (`gh run watch`) — the image publish is part
   of the release, not an afterthought.
8. **Release notes = the CHANGELOG section**, not the auto-generated PR
   list: `gh release edit vX.Y.Z --notes-file <extract>`.
9. **Refresh the server** (watchtower profile pulls automatically;
   otherwise pull + restart) and spot-check the shipped fix in the app.

## Never

- Tag before the implementation is merged — the image builds from the tag.
- Move a published tag without deliberately re-triggering the image build
  and re-publishing the release (deleting a tag drafts its release).
- Ship tests without their implementation "to be completed after".
