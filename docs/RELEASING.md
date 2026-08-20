# Releasing

**The tag is the last step, never the first — and only a `vX.Y.Z-rc.N` tag
builds anything.** `release.yml` triggers on `v*-rc.*` alone, so the final
`vX.Y.Z` tag marks the commit and publishes nothing. Promotion, not tagging, is
what reaches the athlete: prod's watchtower follows `:latest` and only
`:latest`, on a 300s poll, and `promote.yml` is the only thing that may write
it.

Two consequences worth knowing before you start:

- **A `vX.Y.Z` tag with no preceding RC publishes no image at all.** That is
  the intended trade — there is no path to production that has not been soaked
  — but it means the RC step is not optional, even for a one-line fix.
- **Never tag a commit older than v0.105.1.** GitHub runs the workflow file
  from the _tagged ref_, so an older commit resurrects the old `["v*"]` trigger
  and starts a rebuild that would overwrite the promoted digest.
  `finish-release.yml` checks that nothing started, but the cheap fix is not to
  do it.

## The path

One row per step. Every row names what runs it. Nothing in this table is
hand-run.

| #   | Step                                                           | Runs on    | Entry point                    |
| --- | -------------------------------------------------------------- | ---------- | ------------------------------ |
| 1   | Branch, implement test-first, bump version, CHANGELOG, ROADMAP | you        | —                              |
| 2   | lint, typecheck, migrate, test, format:check, build, docker    | hosted     | `ci.yml` — automatic on the PR |
| 3   | Surface capture in a real browser + axe ratchet                | hosted     | `surfaces.yml` — automatic     |
| 4   | Merge to `main`; both workflows green on the merge commit      | hosted     | `ci.yml`, `surfaces.yml`       |
| 5   | Classify this release's migrations, state it in the notes      | you        | —                              |
| 6   | Cut `vX.Y.Z-rc.N`; build amd64 + arm64, publish by digest      | hosted     | **Release RC** → `release.yml` |
| 7   | Soak: RC stack, health, drills, capture the shipping bytes     | **devbox** | **Soak**                       |
| 8   | **Open the pictures.**                                         | **you**    | —                              |
| 9   | Promote the soaked digest to `:latest`                         | hosted     | **Promote**                    |
| 10  | Verify prod runs it, tag `vX.Y.Z`, create the release page     | **devbox** | **Finish Release**             |

Dispatch each from Actions. Steps 6, 7, 9 and 10 take inputs:

```
Release RC      version=0.115.0  rc=1
Soak            rc_tag=0.115.0-rc.1
Promote         rc_tag=0.115.0-rc.1  release_tag=0.115.0  capture_run=<Soak run id>
Finish Release  version=0.115.0
```

**Step 8 is the only step with no entry point, and that is the point of it.**
Two of v0.114.0's four worst defects were invisible to 2,854 tests _and_ to a
clean `0 confirmed` axe report — race one lost its taper on every two-race
plan, and the recovery bridge rendered merged with the athlete's ordinary easy
weeks. One was found by running the code, the other by opening a screenshot. A
pipeline that captures 108 PNGs and reports `0 confirmed` is exactly the state
both of them hid behind.

`Promote` will not run without a `capture_run`, and checks that the run you
named is a passed `Soak` that captured **this** candidate. It cannot check that
you looked.

## Before you cut a candidate

Steps 1 and 5 are yours. They are short, and each one is here because skipping
it cost a release.

1. **Branch from `main`.** Implement test-first; new behavior gets a failing
   test before code.

2. **In the same branch, before merging:** bump `version` in `package.json`
   (v0.9.0 shipped while it still said `0.8.0`), add the `CHANGELOG.md` entry
   (`## vX.Y.Z — date — Name`), update `docs/ROADMAP.md`, and complete the
   feature's UI/UX pass — labels and discoverability, empty/loading/error
   states, focus and contrast.

3. **Mutation-check every test that guards a bound.** Break the thing the test
   names, confirm a test fails, revert. A test that has never been seen to fail
   is not evidence — it is a claim. Across v0.87–v0.92 this caught three things
   reading the test could not, each invisible to review. The recurring cause is
   a fixture that **cannot distinguish** the two things the test exists to tell
   apart: when the point is "X is used rather than Y", X and Y must differ in
   the fixture. **A surviving mutation is a finding** — fix the test and say so
   in the release notes.

4. **Assert wiring at the surface, not at the component.** A component test
   proves the component renders what it is handed; it cannot prove the page or
   the tool hands it the right thing. Prefer a test that runs the real path end
   to end. Where a surface genuinely cannot be tested, **say so in the release
   notes** rather than implying coverage.

5. **Classify this release's migrations.** Look at every new file in `drizzle/`:
   **additive** (new table, new nullable column, new index — old code ignores
   what it does not know about, so an image rollback is safe) or **destructive**
   (a dropped or renamed column, a new `NOT NULL`, a type change — old code
   queries what is no longer there). **State which, in the release notes.** A
   release carrying a destructive migration has no cheap rollback, and that has
   to be known before it ships rather than discovered during an incident.

6. **Write release notes from the diff, not from the plan.** Every release from
   v0.87 to v0.92 had a headline its plan did not contain. State plainly what an
   athlete will and will not notice.

## Running the gates locally

`ci.yml` is the gate list. All of it:

```bash
npm run lint && npm run typecheck && node scripts/migrate.mjs \
  && npm test && npm run format:check && npm run build
```

**`npm test` locally skips the DB suites, and says so only in the skip count.**
`vitest.config.ts` loads no dotenv, so every `describe.skipIf(!hasDb)` block
sits out and the run still ends green. CI runs a `postgres:16-alpine` service
and sets `DATABASE_URL`, so **every DB-gated test runs there**. A local run with
`DATABASE_URL` unset is not "the CI condition": it proves the suite survives
without a database, which is how a contributor first meets it, but a mutation
that survives it has not been proven unguarded. **When a mutation survives,
check the skip count before concluding anything.**

To run what CI runs, use a **throwaway** database — not the dev one:

```bash
docker run -d --name scratch-db -e POSTGRES_USER=ci -e POSTGRES_PASSWORD=ci \
  -e POSTGRES_DB=ci -p 55432:5432 postgres:16-alpine
DATABASE_URL=postgres://ci:ci@localhost:55432/ci DATABASE_DRIVER=pg \
  ENCRYPTION_KEY=$(printf '0%.0s' {1..64}) \
  BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef \
  BETTER_AUTH_URL=http://localhost:3000 npx vitest run
```

**Pointing a test run at a real database writes real rows to it.** That is what
put `test-coach-inbox-user` and `test-coach-inbox-other-user` into
**production** on 2026-07-27 — the defect `docs/ROADMAP.md` recorded as
"something pointed a test run at production" and could not explain. What
protects you now is topology, not vigilance: dev and prod are different
machines (`docs/ENVIRONMENTS.md`). Clean up anyway:

```sql
delete from users where email like '%@example.invalid';
```

`surfaces.yml` is a gate too, and has no one-line local equivalent — it needs a
seeded database, a running server and a Chromium. `CONTRIBUTING.md` has the long
form.

## What the automation needs

Set once, in repository settings:

| Secret              | Used by              | Why                                                                        |
| ------------------- | -------------------- | -------------------------------------------------------------------------- |
| `RELEASE_TAG_TOKEN` | `release-rc.yml`     | A tag pushed with `GITHUB_TOKEN` does not trigger `release.yml`, so the    |
|                     |                      | candidate would never build. Fine-grained PAT, Contents: write, this repo. |
| `PROD_HOST`         | `finish-release.yml` | `scripts/verify-deploy.sh` is tracked and carries no host defaults.        |
| `PROD_URL`          | `finish-release.yml` | Same.                                                                      |

On the devbox runner, `.env.rc` must exist at `~/.recover-ops/env.rc` — it is
gitignored, so it is not in the runner's checkout. See `docs/RUNNER.md`.

## Rolling back

Dispatch **Promote** again with `rc_tag` set to a previous release's tag —
digests and versions are in `docs/ENVIRONMENTS.md`. Watchtower picks it up
within 300s; confirm with `scripts/verify-deploy.sh`.

**This restores the code, not the schema.** `drizzle/` is forward-only and
`scripts/migrate.mjs` runs on every container boot, so once a release with a
migration has started on prod the database is permanently ahead of any older
image. Check the classification for the release you are rolling back _past_:

- Only additive migrations since the target → retag and you are done.
- Any destructive migration since the target → the image rollback alone leaves a
  broken instance. Restore the newest dump into prod's database first, accepting
  the loss back to 03:30, and only then retag.

Rollback is **designed and documented but has never been exercised against
prod**, because proving it means deliberately regressing the athlete's live
instance. Treat the first real use as the test it is.

## Freezing deploys

```bash
ssh PROD 'docker stop recover-watchtower-1'    # stop following :latest
ssh PROD 'docker start recover-watchtower-1'   # resume
```

Do this before any experiment that pushes tags. Prod keeps serving while frozen;
it simply stops picking up new images.

## Why each gate exists

Each of these is enforced by a file, not by this page. The incident that
produced it is narrated in that file.

- **`release.yml` builds pre-release tags only** — until v0.105.1 it triggered
  on `v*`, so the final tag rebuilt the image and moved `:latest` to a fresh
  digest, discarding the one that had just been soaked and promoted. Prod spent
  the night running bytes nothing had ever run, and everything upstream had
  already gone green. Pinned by `tests/release-gate.test.ts`.
- **`release.yml` never forces the `latest` flavor** — the gate is an _absence_:
  pre-releases stay off `:latest` only because `docker/metadata-action`'s flavor
  is left at `auto`. One edit re-arms the straight-to-prod path and no test
  would fail. Pinned by `tests/release-gate.test.ts`.
- **`release.yml` demands a green CI run for the tagged SHA** — v0.63.0 and
  v0.64.0 were both tagged from commits whose CI had already failed, and the
  image published regardless.
- **`promote.yml` retags and never rebuilds** — a rebuilt image is not the
  artifact that was tested, and that is precisely the risk a soak exists to
  eliminate. Pinned by `tests/release-gate.test.ts`.
- **`promote.yml` requires a capture run** — see step 8.
- **`finish-release.yml` verifies the deploy before tagging** — `release.sh`
  claimed a deploy it never performed, and on 2026-08-20 tagged and published a
  release page while nothing had been built, soaked, promoted or deployed.
  Tagging and the release page are in one workflow because six releases shipped
  with a tag and no release page when they were separate steps.
- **No self-hosted runner serves `pull_request`** — this repository is public
  and the devbox runner has SSH to production. Pinned by
  `tests/release-gate.test.ts`.

## Never

- Tag before the implementation is merged — the RC tag builds from the tag.
- Promote a digest that was not soaked. The soak is the only step that runs the
  shipped bytes anywhere before the athlete does.
- Write `:latest` by hand, from a workflow or a terminal. `promote.yml` is the
  only thing that may.
- Hand-run any row of the table above. Every half-release on record —
  v0.28.0, v0.28.1, v0.29.0, v0.30.0, v0.112.0, v0.113.0 — was hand-run. The
  failure mode is a sequence performed step by step by an operator who believes
  it is finished one step early, and that operator's species is not the
  variable.
