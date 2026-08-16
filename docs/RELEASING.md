# Releasing

The tag is the last step, never the first. Pushing any `v*` tag builds and
publishes the Docker image from exactly that commit (`release.yml`) — so
whatever the tag points at _is_ the release, regardless of what the changelog
next to it claims.

Born from v0.9.1: a work-in-progress commit was tagged and released before
the implementation landed. The release shipped its own tests without the
code they tested, and the published image missed half the fixes the release
notes promised.

**What changed in v0.104.0: a tag no longer deploys.** The project runs on two
boxes now (`docs/ENVIRONMENTS.md`), and prod follows exactly one tag —
`:latest`. A `vX.Y.Z-rc.N` pre-release tag publishes a real, CI-verified,
production-identical image **without** moving `:latest`, so it can be run and
soaked on the dev box first. Promotion is a separate, deliberate act that
retags the soaked digest. Nothing reaches the athlete until someone dispatches
the **Promote** workflow.

That matters most for what CI cannot see. `verify-surfaces.ts` is not a CI
gate and is not going to be one soon (`CONTRIBUTING.md` has the four reasons),
so a redesigned surface is only ever checked by a human driving a real browser
— and before this, the first instance running the built image was production's.

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
   cannot be killed by a test that never ran.

   **This command writes real rows to whatever database `.env` names, and
   the port advice that used to sit here is now false.** It read "Port 5435 is
   the dev database and is safe. Port 5434 is live production — never point
   tests at it", which described the old single-box setup. On the dev box
   **5434 is the dev database**, 5435 is the RC soak stack, and production's
   Postgres is on the prod box bound to its own loopback — unreachable from
   here at any port (`docs/ENVIRONMENTS.md`).

   That stale sentence is worth keeping visible because it names the real
   hazard. This exact command is what put `test-coach-inbox-user` and
   `test-coach-inbox-other-user` into **production** on 2026-07-27 — the
   defect `docs/ROADMAP.md` recorded as "something pointed a test run at
   production" and could not explain. Running it on the dev box on 2026-08-16
   reproduced the same seven `*@example.invalid` users, which is how the cause
   was finally identified. What protects you now is topology, not vigilance:
   dev and prod are different machines. Clean up after a run anyway —

   ```sql
   delete from users where email like '%@example.invalid';
   ```

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

9. **Classify this release's migrations.** Look at every new file in
   `drizzle/`:

   - **Additive** — new table, new nullable column, new index. Old code
     ignores what it does not know about, so an image rollback is safe.
   - **Destructive** — a dropped or renamed column, a new `NOT NULL`, a type
     change. Old code queries what is no longer there, so an image rollback
     produces a broken instance and recovery means restoring the nightly
     dump, losing everything since 03:30.

   **State which, in the release notes.** A release carrying a destructive
   migration has no cheap rollback, and that has to be known before it ships
   rather than discovered during an incident.

10. **Tag a release candidate — not a release:**

    ```bash
    git tag vX.Y.Z-rc.1 && git push origin vX.Y.Z-rc.1
    gh run watch   # release.yml: verify → build (amd64 + arm64) → merge
    ```

    `release.yml` demands a green CI run for that exact SHA, builds both
    architectures natively, then combines them into one multi-arch manifest.
    Because `docker/metadata-action`'s `latest` flavor is left at `auto`,
    which excludes pre-releases, this publishes
    `ghcr.io/crunchynapkin404/recover:X.Y.Z-rc.1` and **does not move
    `:latest`** — the only tag prod's watchtower follows. Nothing reaches the
    athlete. `docs/ENVIRONMENTS.md` records the empirical proof of that, and
    `tests/release-gate.test.ts` guards it.

11. **Soak it on the dev box.** Pin the RC tag in
    `docker-compose.dev-rc.yml`, then:

    ```bash
    docker compose -p recover-rc --env-file .env.rc \
      -f docker-compose.yml -f docker-compose.dev-rc.yml up -d db app
    ```

    Then all of it — this is the list, and a skipped box is an unsoaked
    release:

    - [ ] `curl -s localhost:3100/api/health` → `status: ok`, `db: up`
    - [ ] `docker inspect recover-rc-app-1 --format '{{.State.Health.Status}}'`
          → `healthy`
    - [ ] sign in as the seeded owner
    - [ ] the release's surface renders in both themes, both viewports
    - [ ] `SCREENSHOT_BASE_URL=http://localhost:3100 npm run verify:surfaces -- <slice>`
          → zero **confirmed** findings (see the two caveats below)
    - [ ] `RECOVER_BACKUP_VOLUME=recover-dev_backups scripts/migration-drill.sh`
    - [ ] `RECOVER_BACKUP_VOLUME=recover-dev_backups scripts/restore-drill.sh`

### Two caveats about running `verify:surfaces` against the soak stack

Both learned the hard way in v0.105.0, and neither is obvious.

**The Today preview states cannot be captured there.** `?state=` is refused
outright when `NODE_ENV === "production"` (`previewStateFrom` in
`src/lib/today/state.ts`), and the RC image _is_ production — so `today`,
`today-post-session` and `today-evening` all render whichever state the real
clock dictates, and `assertBlockOrder` fails on however many do not match.
Capture those three against a dev server; everything else against the soak
stack, which is the artifact actually shipping.

**The owner must have data.** The script signs in as the owner, because
`/admin` is a captured surface and redirects every other role — but
`scripts/seed-demo.ts` seeds a _separate demo user_ by default, leaving the
owner empty and every capture a picture of an empty account.
`docs/axe-baseline-2026-08-11-seeded.md` measured seeding as +20.7% nodes
overall and +600% on Train, so an empty-owner run is not comparable to the
baseline or to any previous slice. Seed onto the owner itself:

```bash
SEED_DEMO=1 DEMO_EMAIL=<owner email> npm run db:seed-demo
```

12. **Promote the tested digest.** Actions → **Promote** → Run workflow, with
    `rc_tag` = `X.Y.Z-rc.1` and `release_tag` = `X.Y.Z`. It retags that exact
    digest to `:latest` — no rebuild, so prod runs the bytes that were soaked.
    Copy the rollback digest it prints into `docs/ENVIRONMENTS.md`.

13. **Verify it landed:**

    ```bash
    scripts/live-verify-deploy.sh sha256:<promoted digest>
    ```

    The workflow cannot do this itself — GitHub's runners cannot reach the
    prod box, so a green promote does not prove a deployed prod.

14. **Tag the release commit** so the repository and the registry agree:
    `git tag -a vX.Y.Z -m "vX.Y.Z — Name" && git push origin vX.Y.Z`

15. **Release notes = the CHANGELOG section**, not the auto-generated PR
    list. `./scripts/release-object.sh <version>` extracts the section and
    creates the release object; the tag alone does not make one, and release
    pages lagged tags for the whole v0.28–v0.30 run because of it.

## Rolling back

Dispatch **Promote** again with `rc_tag` set to a previous release's tag —
digests and versions are in `docs/ENVIRONMENTS.md`. Watchtower picks it up
within 300s; confirm with `scripts/live-verify-deploy.sh`.

**This restores the code, not the schema.** `drizzle/` is forward-only and
`scripts/migrate.mjs` runs on every container boot, so once a release with a
migration has started on prod the database is permanently ahead of any older
image. Check step 9's classification for the release you are rolling back
_past_:

- Only additive migrations since the target → retag and you are done.
- Any destructive migration since the target → the image rollback alone leaves
  a broken instance. Restore the newest dump into prod's database first,
  accepting the loss back to 03:30, and only then retag.

Rollback is **designed and documented but has never been exercised against
prod**, because proving it means deliberately regressing the athlete's live
instance. Treat the first real use as the test it is.

## Freezing deploys

```bash
ssh PROD 'docker stop recover-watchtower-1'    # stop following :latest
ssh PROD 'docker start recover-watchtower-1'   # resume
```

Do this before any experiment that pushes tags. Prod keeps serving while
frozen; it simply stops picking up new images.

## Never

- Tag before the implementation is merged — the image builds from the tag.
- Move a published tag without deliberately re-triggering the image build
  and re-publishing the release (deleting a tag drafts its release).
- Ship tests without their implementation "to be completed after".
- Promote a digest that was not soaked. The soak is the only step that runs
  the shipped bytes anywhere before the athlete does.
- Write `:latest` by hand, from a workflow or a terminal. `promote.yml` is the
  only thing that may, and `tests/release-gate.test.ts` fails if that stops
  being true — otherwise the gate silently disappears and nobody finds out
  until a release candidate is live.
