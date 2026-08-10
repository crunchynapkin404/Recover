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
   - [ ] complete the feature's UI/UX pass where applicable:
         labels and discoverability, empty/loading/error states, focus and
         contrast, and a quick shipped-surface sanity check in the page where
         the feature actually lives
4. **Everything green locally — all five, and this is the whole list:**
   `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`,
   `npm run format:check`. A red or incomplete branch is not taggable —
   there is no "placeholder" release.

   Do not reconstruct this list from memory; CI runs all five and a release
   is only as green as the check nobody ran. Two have been learned the hard
   way: **`build`** is the only one that catches a sync export added to a
   `"use server"` file, and **`format:check`** runs prettier over the whole
   repo — v0.87.0's CI failed on one reflowed JSX line because the branch had
   only ever run prettier against the files it edited.

   **What CI actually is, because guessing at it has now cost more than one
   release.** `.github/workflows/ci.yml` runs a `postgres:16-alpine` service
   and sets `DATABASE_URL` and `DATABASE_DRIVER=pg`, so **every DB-gated
   test runs in CI** — 2163 tests, zero skipped, as of 2026-08-10. This has
   been true since 2026-08-04 (`62c3ab2`). Two consequences worth stating,
   because the opposite was believed and written down for six days:

   - A `describe.skipIf(!hasDb)` block is **not** dead weight in CI, and a
     test behind one **is** a real guard there. It exists so the suite still
     runs on a machine without a database.
   - A local run with `DATABASE_URL` unset is **not** "the CI condition". It
     is a useful second run — it proves the suite survives without a
     database, which is how a contributor first meets it — but a mutation
     that survives it has not been proven unguarded. Check `ci.yml`, not
     your memory of it.

   **Locally, `npm test` skips the DB suites — and says so quietly.**
   `vitest.config.ts` loads no dotenv, so `.env` does not reach the test
   process and every `describe.skipIf(!hasDb)` block sits out. The run still
   ends green; the skip count is the only tell. To run what CI runs:

   ```bash
   set -a; . ./.env; set +a; npx vitest run
   ```

   This is the mechanism behind v0.87.0's false finding — the reviewer's
   local run looked normal and was missing whole suites. **When a mutation
   survives, check the skip count before concluding anything**; a mutation
   cannot be killed by a test that never ran. Port 5435 is the dev database
   and is safe. Port 5434 is live production — never point tests at it.

5. **Mutation-check every test that guards a bound.** Break the thing the
   test names, confirm a test fails, revert. A test that has never been seen
   to fail is not evidence — it is a claim.

   This is not ceremony. Across v0.87–v0.92 it caught something reading the
   test could not, **three times**, and each was invisible to review:

   - **v0.89.0** — a `sleepDebtFrom` fixture set the athlete's sleep need to
     a value that happened to equal `DEFAULT_SLEEP_NEED_SECS`, so an owner
     ignoring the preference **entirely** passed every test.
   - **v0.90.0** — hardcoding `stale: false` in `get_power_curve` passed
     every assertion, because on a fresh-cache hit `stale` genuinely is
     `false`. The flag could have been dead and no test would have known.
   - **v0.92.0** — removing `metrics.ts` from a guard's allowlist passed,
     because the detector could not see a `Map.get(k)?.ctl` indirection.

   The recurring cause is a fixture that **cannot distinguish** the two
   things the test exists to tell apart. When the point is "X is used rather
   than Y", X and Y must differ in the fixture, and the assertion must land
   on a value only X produces.

   **A surviving mutation is a finding, not a nuisance.** Fix the test, and
   say so in the release notes — that sentence is worth more than the feature
   description around it.

6. **Assert wiring at the surface, not at the component.** A component test
   proves the component renders what it is handed. It cannot prove the page,
   the coach context or the MCP tool hands it the right thing.

   v0.88.0 found a branch nothing had ever exercised — an athlete-set FTP
   reaching `medium` confidence — because every existing test seeded athletes
   with no set anchors. It was found _by mutation_, not by reading:
   retargeting a rule to `"Bike"` killed one test where it should have killed
   two.

   Prefer a test that runs the real path end to end. `tests/curve-tools.test.ts`
   is the pattern: seed the database so the real cache short-circuits, then
   call the tool. Mocking the owner module would have proved nothing about
   the read path.

   Where a surface genuinely cannot be tested — the Train page has no test
   file and this repo has no page-level render harness — **say so in the
   release notes** rather than implying coverage. v0.92.0 shipped two
   unguarded Train-page migrations and stated it plainly.

7. **Write release notes from the diff, not from the plan.** The plan says
   what was intended; the diff says what shipped, and they diverge — usually
   because the work found something the plan did not predict.

   Every release from v0.87 to v0.92 had a headline the plan did not contain.
   v0.88.0 set out to add surface assertions and instead found a triathlete
   being told to fix something with no fix. v0.92.0 set out to build a guard
   and found a plan's starting load was a hardcoded guess for manual-only
   athletes.

   State plainly what an athlete will and will not notice. "No athlete sees a
   different number after this release" (v0.89.0) is a real and useful
   sentence; implying a fix where there was only a drift guard is not.

8. **Merge to `main`** (PR or fast-forward) and verify `main` is green.
9. **Only now, tag the merge commit** — annotated, on `main`:
   `git tag -a vX.Y.Z -m "vX.Y.Z — Name" && git push origin vX.Y.Z`
10. **Watch the release build** (`gh run watch`) — the image publish is part
    of the release, not an afterthought. `release.yml` runs three jobs: amd64
    and arm64 build natively in parallel (`ubuntu-24.04` /
    `ubuntu-24.04-arm`, no QEMU), then a `merge` job combines both digests
    into one multi-arch manifest under the real tags. The version/`latest`
    tags don't exist until `merge` finishes — a green `build` matrix alone
    isn't a shipped release yet.
11. **Release notes = the CHANGELOG section**, not the auto-generated PR
    list. `./scripts/release-object.sh <version>` extracts the section and
    creates the release object; the tag alone does not make one, and release
    pages lagged tags for the whole v0.28–v0.30 run because of it.
12. **Refresh the server** (watchtower profile pulls automatically;
    otherwise pull + restart) and spot-check the shipped fix in the app.

## Never

- Tag before the implementation is merged — the image builds from the tag.
- Move a published tag without deliberately re-triggering the image build
  and re-publishing the release (deleting a tag drafts its release).
- Ship tests without their implementation "to be completed after".
