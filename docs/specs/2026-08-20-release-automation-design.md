# Release path and CI/CD automation — design

Written 2026-08-20, from `docs/2026-08-20-release-automation-handoff.md`.
Every claim about current behaviour below was checked against the file that
implements it, not against prose describing it.

## The four asks

1. Make the release instructions clean and clear; delete what is stale rather
   than annotate it.
2. One full release path, dev → prod, stated once.
3. All CI/CD in GitHub Actions, including Playwright.
4. Automate it end to end, so an agent can close out a roadmap item.

## Two facts that shape everything

**The repository is public and has no self-hosted runner.** `gh repo view`
says `visibility=PUBLIC`; `gh api …/actions/runners` says `total_count: 0`.
Devbox (10.0.10.50) is the only machine that can reach prod (10.0.10.100), so
ask 3 cannot be satisfied by hosted runners alone, and satisfying it with a
naive self-hosted runner would give any fork-PR author code execution on a box
with SSH to production.

**`docs/RELEASING.md` contradicts itself.** Lines 3-6 state that pushing any
`v*` tag builds and publishes the image. Step 14 spends fourteen lines
explaining that this is false and was the v0.105.1 defect, and
`tests/release-gate.test.ts` pins it as false. The handoff also describes the
file as having 14 steps; it has 15. The first ask is not cosmetic — the
document's opening claim is the exact belief that caused today's sequencing
bug.

## Decisions

| #   | Decision                                                                                     | Why                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Self-hosted **ephemeral** runner on devbox, label `devbox`, **never serving `pull_request`** | The only way ask 3 is literally true. Dispatch and base-repo tag pushes cannot be triggered by a fork, which is GitHub's own documented mitigation.                                   |
| D2  | Composed workflows, one dispatch each — not one orchestrator                                 | Every failure on record is a sequence abandoned partway. A path re-entered at the failed step beats one that must restart, because restarting is what nobody does.                    |
| D3  | The human gate is a **typed input naming the capture run**, not a click                      | Clicking approve is reflex; naming the run you reviewed is a deliberate act. `0 confirmed` on 108 PNGs is the exact state both of v0.114.0's worst defects hid behind.                |
| D4  | `scripts/release.sh` is **deleted**, not renamed or guarded                                  | Once the tail is a workflow that cannot skip its own steps, a local script that merges, tags and publishes is a second path to the same place. Two paths is how today's bug happened. |
| D5  | The surface ceiling is **written by a run**, never typed from prose                          | The handoff's own rule: point at the run, not at a figure. This roadmap has been wrong about counts in both directions.                                                               |
| D6  | Capture jobs **seed the owner they sign in as**, in the same job                             | Removes ambient state. Directly closes the 2026-08-14 defect where seeding the wrong user voided every reading taken before 2026-08-16.                                               |

## The release path as it will be

One path, one row per step, and every row names what runs it.

| #   | Step                                                                   | Runs where  | Entry point                      |
| --- | ---------------------------------------------------------------------- | ----------- | -------------------------------- |
| 1   | Branch, implement test-first, bump version, CHANGELOG, ROADMAP         | human/agent | —                                |
| 2   | Gates: lint, typecheck, migrate, test, format:check, build, docker     | hosted      | `ci.yml` (automatic on PR)       |
| 3   | Surface capture + axe ratchet                                          | hosted      | `surfaces.yml` (automatic on PR) |
| 4   | Merge to `main`, main CI green                                         | hosted      | `ci.yml`                         |
| 5   | Classify migrations additive/destructive, state it in the notes        | human/agent | —                                |
| 6   | Cut `vX.Y.Z-rc.N`, build both arches, publish by digest                | hosted      | `release-rc.yml` → `release.yml` |
| 7   | Soak: stack up on RC tag, health, drills, capture against the RC image | **devbox**  | `soak.yml`                       |
| 8   | **Open the pictures.**                                                 | human       | —                                |
| 9   | Promote the soaked digest to `:latest`                                 | hosted      | `promote.yml` + `capture_run`    |
| 10  | Verify prod actually landed on that digest                             | **devbox**  | `finish-release.yml`             |
| 11  | Tag `vX.Y.Z`, create the release page from the CHANGELOG               | **devbox**  | `finish-release.yml`             |

Steps 10 and 11 are one workflow because separating them is what produced six
half-releases. Step 8 is the only step with no entry point, and that is the
point of it.

## Workflows

### `ci.yml` — modified

One change: **`BETTER_AUTH_SECRET` becomes ≥32 characters.** It is
`ci-only-secret` (14) today and gets away with it only because vitest never
runs the instrumentation hook. Every new job below boots the real app, where
`src/lib/env-validation.ts` throws. Fixing it in `ci.yml` too keeps one value
correct everywhere rather than one correct and one lucky.

### `surfaces.yml` — new, hosted

This is ask 3. `CONTRIBUTING.md` lists three blockers; this workflow closes all
three.

- **Seeded database** — postgres service, `npm run db:seed`, then
  `SEED_DEMO=1 DEMO_EMAIL=$OWNER_EMAIL` for `seed-demo.ts` and
  `seed-two-race.ts`. Onto the owner, per D6. CONTRIBUTING notes the run's
  real-token create/revoke is _safer_ against a throwaway CI database than a
  dev one.
- **Running server** — `next build && next start` on :3200, with matching
  `BETTER_AUTH_URL`/`TRUSTED_ORIGINS` and a readiness poll.
- **Ratchet** — see below.

Triggers on `pull_request`, on `push` to `main`, and on `workflow_dispatch`.
The push-to-`main` run matters: it is the only capture taken against the exact
commit an RC is cut from, and step 7's soak cannot cover the three
preview-state surfaces.

Chromium comes from `npm run dev:browser-setup` (`playwright-core` is an
exact-pinned devDependency since v0.104.0), cached by revision key.

**Two capture jobs, deliberately.** `previewStateFrom`
(`src/lib/today/state.ts:99`) returns `null` when `NODE_ENV === "production"`,
so a production `next start` cannot render `today`, `today-post-session` or
`today-evening` in their preview states — it silently renders whatever the
clock says. That is the `assertOnSurface` trap in a different costume: a
different page filed under the surface's name. So:

- `capture` — production build, every surface except those three.
- `capture-preview-states` — `next dev`, exactly those three, with longer
  navigation budgets because lazy compilation trips `networkidle`.

Both publish `.screenshots/` as artifacts. A cheaper single job would capture
the wrong page for three surfaces and report success.

### The ratchet

Modelled on `tests/type-scale-guard.test.ts`'s `OFFENDER_CEILINGS`, which this
repo already trusts: a committed ceiling per metric, a `RATCHET_SLACK`, failure
on a **rise** rather than on non-zero, lowering routine and raising requiring a
reason in the commit message.

Two metrics, and only one gates, matching `scripts/lib/axe-report.ts`:

- `confirmed` — axe computed a failure. **Gates.**
- `indeterminate` — axe could not compute an answer (text over composited
  gradients). **Tracked, never gates.** On this app's four gradient surfaces it
  can never resolve, so gating it makes zero permanently unreachable.

**The initial ceiling is written by the first green run of `surfaces.yml`, not
typed from any document.** The recorded baseline is 398 confirmed nodes
(2026-08-11); the handoff reports 0 confirmed on 2026-08-20. Both are prose.
The run decides.

### `release-rc.yml` — new, hosted

`workflow_dispatch(version, rc)`. Asserts `package.json` matches `version`,
asserts a CHANGELOG section exists, asserts main's CI is green for the exact
SHA, then tags `vX.Y.Z-rc.N` and pushes. `release.yml` fires on that tag
unchanged.

Existing `release.yml` is not touched. It works, `tests/release-gate.test.ts`
pins its trigger, and the safest thing to do with it is nothing.

### `soak.yml` — new, **devbox**

`workflow_dispatch(rc_tag)`. Mechanises RELEASING.md step 11's seven boxes:

- pin the RC tag, bring up `recover-rc` (:3100)
- `curl localhost:3100/api/health` → `status: ok`, `db: up`
- container health → `healthy`
- `migration-drill.sh`, `restore-drill.sh`
- seed the owner onto the RC database, capture against :3100
- publish the capture artifact and print its run URL

The three preview-state surfaces are **not** captured here — the RC image is
production, so `?state=` is refused. `surfaces.yml`'s preview job covers
them on the push-to-`main` run for the commit being tagged.

### `promote.yml` — modified

Adds a third required input, `capture_run`: the run ID of the `soak.yml` run
whose artifact was reviewed. Before promoting, the workflow asserts that run
exists, concluded `success`, was for **this** `rc_tag`, and produced a capture
artifact.

It cannot verify a person looked at the PNGs. It can verify the thing they
claim to have looked at is real and matches what is being promoted, which
closes the fabrication gap without pretending to read minds. The remaining gap
is a human who types a real run ID without opening it, and that is a decision
by a person rather than an accident by a pipeline — which is the distinction
worth preserving.

### `finish-release.yml` — new, **devbox**

`workflow_dispatch(version)`. Runs `live-verify-deploy.sh <promoted digest>`
first — if prod is not on the digest, nothing is tagged. Then tags `vX.Y.Z`,
then creates the release object from the CHANGELOG section.

This replaces `scripts/release.sh` entirely, and disposes of both defects
`docs/2026-08-18-phase-2-close-handoff.md` logged against it without fixing
either: it prints a deploy claim it does not perform (now it verifies the
deploy first), and it runs `git checkout main && git pull` in your working tree
(now it runs on a clean checkout).

## The runner, and the rule that keeps it safe

Ephemeral, label `devbox`, repo-scoped, running as a user that can reach the
soak stack and `ssh PROD`.

**The rule: no workflow may pair a self-hosted runner with a `pull_request`
trigger.** This is the whole safety story on a public repo, and per this
repository's own established practice — the `:latest` flavor, the `v*-rc.*`
trigger — a written rule that nothing enforces is a rule broken by accident.

So `tests/release-gate.test.ts` grows two cases:

1. No workflow file combines `runs-on:` containing `self-hosted` with an `on:`
   block containing `pull_request` or `pull_request_target`.
2. No file under `scripts/` both pushes a `v` tag and calls `gh release create`
   — the local tag-and-publish path stays deleted.

## The doc truth pass

`docs/RELEASING.md` is rewritten, not annotated.

- **Delete the opening contradiction** (lines 3-6). It is false and it is the
  belief that caused today's bug.
- **The procedure becomes the 11-row table above**, each row naming its entry
  point. Short enough to follow without reading 338 lines.
- **Rationale moves next to its mechanism.** The v0.9.1, v0.63.0, v0.105.1 and
  v0.28-v0.30 incidents are already narrated in the workflow files that
  implement the guards. RELEASING.md keeps a short "why each gate exists"
  appendix and stops re-telling them inline, where they bury the steps.
- **The stale port advice goes.** It already carries its own correction; the
  correction is the only part that is true.
- `CONTRIBUTING.md`'s "Can this run in CI?" section is updated — after
  `surfaces.yml` the answer is yes, and the three blockers are closed rather
  than merely re-listed.

## What this deliberately does not do

- **It does not make the capture meaningful.** Step 8 has no entry point on
  purpose. Two of v0.114.0's four worst defects were invisible to 2,854 tests
  and to a clean axe report: the lost taper lived where two separately-clean
  tasks met, and the merged bridge was found by opening a screenshot. A
  pipeline cannot find either.
- **It does not move `live-verify-deploy.sh` to a hosted runner.** GitHub's
  runners cannot reach prod. This is irreducible, and D1 is what lets it run in
  Actions at all.
- **It does not touch `release.yml`'s build or `promote.yml`'s retag.** Both
  work and both are pinned by tests.

## Sequencing

**Phase 1 — no runner needed.** `ci.yml` secret fix; `surfaces.yml` with both
capture jobs; the ratchet, ceiling written by its first run; `CONTRIBUTING.md`
update. Delivers ask 3's hard half and is independently useful.

**Phase 2 — docs.** RELEASING.md rewrite. Delivers asks 1 and 2. Independent
of phase 1; ordered second only because phase 3 must not automate a path that
is not yet stated correctly.

**Phase 3 — the runner and the tail.** Register the runner; `release-rc.yml`,
`soak.yml`, `promote.yml`'s gate, `finish-release.yml`; delete
`scripts/release.sh`; both guard tests. Delivers ask 4.

Phase 3's first use is a real release, and it should be treated as the test it
is — the same sentence RELEASING.md already applies to rollback.

## Loose ends this design inherits

- **PR #165** merges first; it is bookkeeping prod already reflects.
- `scripts/repair-plan-sport.ts` refusing two-race plans is out of scope and
  names its own reason.
- The RC soak stack is left running on `0.114.0-rc.1`. `soak.yml` must bring up
  a stack that may already exist, so it tears down first rather than assuming a
  clean box.
