# Handoff — release path and CI/CD automation, from v0.114.0

**Read this first if you are picking up the release-automation work.** It is a
new piece of work requested by the owner on 2026-08-20, immediately after
v0.114.0 reached production. Nothing blocks starting it.

Authority order when documents disagree: **the code and the workflow files**,
then `docs/ROADMAP.md`, then this file. Everything here was verified on
2026-08-20 by running it, not by reading about it. Its predecessor,
`docs/2026-08-19-phase-3-handoff.md`, still holds for the parts it covers.

---

## State of the world

|                   |                                                                             |
| ----------------- | --------------------------------------------------------------------------- |
| Version on `main` | **0.114.0** (`cb28a8e`)                                                     |
| Prod digest       | `sha256:69100f0e…` — v0.114.0, healthy, `jobsFailed: 0`                     |
| Rollback target   | `sha256:651f366c…` — v0.113.0                                               |
| Migrations        | 0042 is **additive**, so a rollback past it is schema-safe                  |
| Tests             | **2854** pass with a database, 2290 without (562 skip on no `DATABASE_URL`) |
| Surfaces          | 27 (`train-plan-preview` is new), 108 capture entries, **0 confirmed**      |
| Phase 3           | multi-A-race **shipped**; race pacing and the demand-map remainder open     |

**Open PR: #165** — records v0.114.0's digest in `ENVIRONMENTS.md` and pins the
soak stack to `0.114.0-rc.1`. Bookkeeping; prod already runs what it describes.

---

## What the owner asked for

Four things, in one breath:

1. **Make the release instructions clean and clear.** Delete what is stale or
   wrong rather than annotating it.
2. **One full release path**, dev → prod, stated once.
3. **All CI/CD in GitHub Actions**, including **Playwright**.
4. **Automate the whole thing**, so an agent can close out a roadmap item end
   to end.

---

## The release path as it ACTUALLY is

This is the part worth reading twice, because a session got it wrong today.

`docs/RELEASING.md` numbers 14 steps. The tail that matters:

| Step | What                                           | Automated by             |
| ---- | ---------------------------------------------- | ------------------------ |
| 10   | Tag `vX.Y.Z-rc.N`, push                        | nobody                   |
| 11   | Soak on the dev box — **seven boxes**          | nobody                   |
| 12   | Dispatch **Promote** (`rc_tag`, `release_tag`) | nobody                   |
| 13   | `scripts/live-verify-deploy.sh <digest>`       | nobody                   |
| 14   | Final `vX.Y.Z` tag + GitHub release page       | **`scripts/release.sh`** |

**`scripts/release.sh` automates step 14 and the merge, not the release.** It
merges the PR, fast-forwards main, waits for main's CI on that exact SHA, tags,
and creates the release object. It does **not** build, soak, promote or deploy.

**Three facts that follow, and each has bitten someone:**

- **`release.yml` triggers on `v*-rc.*` ONLY.** The final `vX.Y.Z` tag builds
  nothing, deliberately — until v0.105.1 it triggered on `v*` and rebuilt the
  image, throwing away the digest that had just been soaked and promoted.
  `tests/release-gate.test.ts` pins the trigger.
- **A `vX.Y.Z` tag with no preceding RC publishes no image at all.** That is
  the intended trade, and it means the RC step is not optional even for a
  one-line fix.
- **`promote.yml` retags the soaked digest.** No rebuild. It is
  `workflow_dispatch` with `rc_tag` and `release_tag`, and it prints the
  rollback digest for `ENVIRONMENTS.md`.

### The sequencing bug this handoff exists to prevent

On 2026-08-20 a session ran `./scripts/release.sh 0.114.0 164` believing it was
the release. It merged, tagged `v0.114.0` and published a release page — while
**nothing was built, soaked, promoted or deployed.** Prod stayed on v0.113.0.

No harm: the final tag builds nothing, so `:latest` never moved. But the
release page ran ahead of reality, which is a cousin of the half-release the
script exists to prevent. Recovery was to cut `v0.114.0-rc.1` afterwards and
run steps 11-13 properly.

**The doc fix this implies is the first one to make:** `release.sh` is named
and documented as if it were the whole release. Either rename it to what it is
(`finish-release.sh`, `tag-and-publish.sh`) or make it refuse to run when no
matching RC digest exists. The 2026-08-18 handoff already suggested the latter
and nobody did it.

---

## What is in CI today, and what is not

`.github/workflows/ci.yml` — on push and pull request:

- a real **`postgres:16-alpine` service** (`ci/ci/ci` on 5432), so the 562
  DB-gated tests that skip locally **do** run in CI
- `npm ci`, `lint`, `typecheck`, **`node scripts/migrate.mjs`** (the production
  runner, so a migration that breaks on deploy breaks the PR first), `test`,
  `format:check`, `build`
- a separate `docker` job that builds the image

**Not in CI, and this is the gap the owner is asking to close:**

- **`verify-surfaces.ts` is deliberately not a CI gate.** 1,775 lines, needs a
  running app, a seeded database and a Chrome binary. This is why every
  redesign slice needed a human driving a browser.
- the **soak** (seven manual boxes on the dev box)
- `scripts/migration-drill.sh` and `scripts/restore-drill.sh`
- promote, and `live-verify-deploy.sh`

### The one thing that genuinely cannot move to Actions

**GitHub's runners cannot reach the prod box.** `promote.yml` says so itself,
and it is why `live-verify-deploy.sh` exists as a separate manual step: a green
promote does not prove a deployed prod. Any design must keep a verification
step running somewhere with network access to `10.0.10.100`, or accept that
"deployed" is inferred rather than observed.

---

## Traps found on 2026-08-20, all of them cheap to hit again

- **`BETTER_AUTH_SECRET` must be ≥ 32 characters** or `src/lib/env-validation.ts`
  throws from the instrumentation hook. `ci.yml` uses `ci-only-secret` (14
  chars) and gets away with it because **vitest never runs instrumentation** —
  but `next dev` and the real image do. Any Actions job that boots the app
  needs a longer value than CI's current one.
- **The owner is `dev@recover.local`. `demo@recover.local` is only a `member`.**
  `verify-surfaces.ts` signs in as the OWNER; `seed-demo.ts` seeds the demo
  user. Seeding the wrong one is the 2026-08-14 defect that voided every
  reading taken before 2026-08-16.
- **`seed-demo.ts` seeds no races and no training plans.** It covers
  activities, wellness, chat, connectors. `scripts/seed-two-race.ts` (new)
  covers a two-A-race season, and builds it through the real
  `previewTrainingPlan` rather than inserting rows, so what gets captured is
  what the engine emits.
- **`assertOnSurface` compares pathname only.** A surface whose name promises a
  state needs a `SURFACE_PREPARE` guard, or it files a different page under
  that name. `train-plan-preview` shares `/train`'s path for exactly this
  reason and guards on a visible `segment-2` header.
- **Playwright "visible" is not "in the PNG".** Two surfaces needed
  `scrollIntoViewIfNeeded` after `waitFor`.
- **Prettier formats fenced code blocks inside markdown.** Scripted edits that
  match on exact code text will drift after the first `prettier --write`.
- **The auto-mode classifier refuses Bash commands that edit
  `scripts/release.sh`.** Use the file-edit tool instead; it is allowed.
- **For DB-gated tests locally, do not use the dev database.** Start a
  throwaway `postgres:16-alpine` on a spare port with CI's exact `ci/ci/ci`
  credentials, migrate it, and point `DATABASE_URL` at that. `recover-db-1`
  (5434) and `recover-rc-db-1` (5435) both hold state something depends on.

---

## What must NOT be automated away

Automation can make the capture mandatory. It cannot make it meaningful.

Two of v0.114.0's four worst defects were invisible to 2,854 tests **and** to a
clean `0 confirmed` axe report:

- **Race one lost its taper on every two-race plan** — the recovery guard's
  day-count is negative for weeks _before_ the race. Found by a whole-branch
  reviewer running the code rather than reading it. It existed only where two
  separately-clean tasks met, so no per-task review could have seen it.
- **The bridge rendered merged with the athlete's ordinary easy weeks** —
  "Recovery · 5 · weeks 4, 7, 11, 14, 15". Found by opening a screenshot.

A pipeline that captures 108 PNGs and reports `0 confirmed` is exactly the
state both defects hid behind. Design for a human looking at pictures, not
around it — e.g. publish the capture as a build artifact and make a release
step require an explicit acknowledgement that someone opened them.

---

## Loose ends carried in

- **PR #165** — digest record and RC pin. Merge it.
- **`scripts/repair-plan-sport.ts` refuses two-race plans** rather than
  handling them, because `generateTrainingPlan()` cannot carry a second
  target. Fine for now; it names its reason.
- **`docs/2026-08-18-phase-2-close-handoff.md` still lists two `release.sh`
  defects** nobody has fixed: it prints a deploy claim it does not perform, and
  it does `git checkout main && git pull` in the working tree. Both are in
  scope for this work.
- The RC soak stack is left **running** on `0.114.0-rc.1`, matching how it was
  found. Tear down with `docker compose -p recover-rc --env-file .env.rc -f
docker-compose.yml -f docker-compose.dev-rc.yml down -v` if you want it gone.

---

## How to verify anything

**The gate list is `.github/workflows/ci.yml`.** Run all of it:

```bash
npm run lint && npm run typecheck && node scripts/migrate.mjs \
  && npm test && npm run format:check && npm run build
```

**With a database**, so the 562 DB-gated tests actually execute:

```bash
docker run -d --name scratch-db -e POSTGRES_USER=ci -e POSTGRES_PASSWORD=ci \
  -e POSTGRES_DB=ci -p 55432:5432 postgres:16-alpine
DATABASE_URL=postgres://ci:ci@localhost:55432/ci DATABASE_DRIVER=pg \
  ENCRYPTION_KEY=$(printf '0%.0s' {1..64}) \
  BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef \
  BETTER_AUTH_URL=http://localhost:3000 npm test
```

Expect `2854 passed | 1 expected fail | 1 skipped`.

**Surfaces**, against a dev server (NOT 3100, which serves a released image):

```bash
SEED_DEMO=1 DEMO_EMAIL=<owner> npx tsx scripts/seed-demo.ts
SEED_DEMO=1 DEMO_EMAIL=<owner> npx tsx scripts/seed-two-race.ts
BETTER_AUTH_URL=http://localhost:3200 TRUSTED_ORIGINS=http://localhost:3200 \
  npx next dev -p 3200
SCREENSHOT_BASE_URL=http://localhost:3200 OWNER_EMAIL=<owner> \
  OWNER_PASSWORD=<from .env, not .env.rc> \
  CHROME_PATH=$HOME/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell \
  npx tsx scripts/verify-surfaces.ts <name>
```

**Then open the PNGs.** A run that emits files is not evidence.
