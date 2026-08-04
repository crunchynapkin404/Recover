# v0.40 — Tests That Bind in CI

## The gap

`.github/workflows/ci.yml` runs `npm test` with no `DATABASE_URL`. The env block
that supplies one is scoped to the `npm run build` step alone, and the workflow
declares no Postgres service. Every suite behind `describe.skipIf(!hasDb)`
therefore skips on every pull request, and has for the project's whole history.

Measured, not estimated — the same suite run twice, once with the database and
once without:

|                              | Test files                 | Tests                        |
| ---------------------------- | -------------------------- | ---------------------------- |
| CI today (no `DATABASE_URL`) | 172 passed, **71 skipped** | 1320 passed, **405 skipped** |
| With a Postgres service      | 243 passed, 0 skipped      | 1725 passed, 0 skipped       |

**405 tests — 23% of the suite — have never run on a pull request.** They are
not incidental: they cover the importer, the scheduler, the week planner, the
sync connectors, and the export round trip. A green CI on this project has never
meant more than 77% of the suite — and the missing 23% is the database-backed
part, which is where this project's defects have actually lived.

## What the investigation actually found

The roadmap entry for this item predicted the opposite of what is true. It said
the blast radius was unknown, that some suites reach the real network, and to
"expect the triage, not the config, to be the work." That was wrong, and the
correction matters because it changes the size of this release.

Running the whole suite against a scratch Postgres — fresh container, migrations
applied, nothing else — produces **243 files and 1725 tests passing, zero
failures, in 76.7 seconds**. There is no archaeology. Turning the database on
costs **+18 seconds** (59s → 77s) and reveals no hidden breakage.

The tests pass against an _empty_ database because they seed everything they
need. That is a stronger position than running against the dev database, where a
passing test may be leaning on data it did not create.

### The one real hazard, which is not the one that was predicted

No test makes a real outbound HTTP call today — and that isn't incidental.
`runActivityPolls` (`src/lib/sync/activity-poll.ts`) only runs when
`providerPassesEnabled()` is true, and that predicate is
`!process.env.VITEST` (`src/lib/sync/scheduler.ts:37-39`) — a deliberate
guard added after a prior release let an unbounded tick pass bill a real LLM
ride review into the owner's own thread. `runIntervalsSync`
(`src/lib/sync/intervals-sync.ts`) is reachable only through the tick's
`defaultProcessor`, and every test caller of `runSchedulerTick` passes a
stub processor instead — `tests/scheduler.test.ts`,
`tests/scheduler-housekeeping-guard.test.ts`, `tests/describe-hook.test.ts`,
`tests/morning-hook.test.ts`. `tests/scheduler.test.ts` does seed an
**active** `intervals_icu` connection, but the tick block it runs never
touches that user — the connection lives under a different seeded user than
the one whose jobs the tick claims.

The real hazard sits one level further in: the tick's post-job hooks —
`runAutoDescribeStrava`, `generateWeeklyReview`, `runRaceDebriefs`,
`runDebriefLifecycle` (`src/lib/sync/scheduler.ts:345-420`) — are **not**
behind `providerPassesEnabled()`. They run with real imports inside
`try/catch`, which is exactly the shape of the incident above: nothing stops
one of them reaching a real provider except that no test currently exercises
a branch that would call out. `vitest.config.ts` has no `setupFiles`, no
`vi.mock` of the network, no `nock`, no `msw` — those hooks have no guard of
their own to fall back on.

That is a guarantee for the paths a prior release deliberately closed, and no
guarantee at all for the paths it left open. This release adds the missing
one.

## Design

### 1. A Postgres service on the `checks` job

`postgres:16-alpine`, matching the live database, the export/import drill, and
the backup sidecar. Standard health-check options so the job waits for readiness
rather than racing it.

The dummy env block currently scoped to the `npm run build` step moves to job
level, so `npm test` sees the same values. They stay dummies — an all-zeros
`ENCRYPTION_KEY` and a literal `ci-only-secret` — for the ordinary reason that a
public repository's workflow file must never carry a real secret, not because
they provide any safety of their own. They do not: what stops a seeded token
from decrypting is its format, independent of the key.

### 2. Migrations via the production runner

The migrate step runs **`node scripts/migrate.mjs`**, not `npm run db:migrate`.

`scripts/migrate.mjs` is the runner that executes on every real deploy —
`Dockerfile:42` → `docker-entrypoint.sh` runs it before `exec node server.js`. It
is plain JS using only `drizzle-orm` and `pg`, with no drizzle-kit and no tsx,
precisely so it can run inside the standalone image. Using it in CI means a
migration that would fail on deploy fails the pull request first.

`npm run db:migrate` invokes drizzle-kit, a devDependency that never runs in
production. Exercising it here would test a code path nothing depends on while
leaving the one that matters unexercised.

### 3. A network guard

A new vitest `setupFiles` entry replaces `globalThis.fetch` with a function that
throws, naming the URL that was requested. `vitest.config.ts` has no `setupFiles`
today, so this is purely additive.

It should pass on its first run without changing a single test: 17 test files
mention `fetch`, but only six replace the global themselves with
`vi.stubGlobal("fetch", …)` — `src/lib/connectors/strava.test.ts`,
`src/lib/connectors/intervals.test.ts`,
`src/lib/connectors/intervals-request.test.ts`,
`src/lib/connectors/google-calendar.test.ts`, `tests/strava.test.ts`,
`tests/strava-describer.test.ts`. In those six the guard is silently inert —
harmless, since they are deliberately mocking the network on purpose — but it
means the guard's real coverage is 239 files, not all of them. Everywhere
else, fetch only ever reaches code under test through an injected parameter
(e.g. `src/lib/webhooks/dispatch.test.ts`, which passes `fetcher` as an
argument), so the global stays the guard's to enforce. If the guard does trip
a test, that test was reaching the network and the finding is the point.

The guard must name the offending URL in its error. A bare "network disabled"
sends the next person hunting through 243 files.

## Verification

Three claims, each demonstrated rather than asserted:

1. **The suite passes against a fresh migrated Postgres.** Already demonstrated
   during design: 243 files, 1725 tests, 0 failures. Re-run on the branch.
2. **The guard is not vacuous.** A throwaway test calling `fetch("https://example.com")`
   must fail with the guard's error, naming that URL. Watched failing, then
   deleted — a guard never seen failing is decoration.
3. **The gate genuinely binds.** Deliberately break one DB-gated test, push, and
   confirm the pull request goes **red**. Then revert. The entire premise of this
   release is that a green check has been meaningless for 405 tests; shipping it
   on the assumption that the new check is meaningful would repeat the mistake in
   a new place.

Step 3 is the one that cannot be skipped. Steps 1 and 2 prove the tests run; only
step 3 proves CI _fails_ when they fail.

## Out of scope, stated deliberately

- **No test rewrites.** The suite passes as-is.
- **The 88 `describe.skipIf(!hasDb)` guards stay.** They stop triggering in CI
  because the database now exists. Removing them would break the suite for anyone
  running it on a machine without Postgres, which is a real workflow.
- **No change to `fileParallelism: false`.** Suites share one database and tick
  the same `sync_jobs` queue; parallel files would steal each other's jobs. 77
  seconds does not justify touching that.
- **No performance work.** +18s is not a problem to solve.
- **No branch protection.** Making CI _block_ a merge rather than merely report is
  a repository setting, not a code change, and is the user's call.

## Risks

The honest one: this makes CI meaningfully stricter, and the first pull requests
after it lands may surface flakiness that 405 never-executed tests have been
hiding. Serial execution against a shared database is exactly where order
dependence and leaked state live. That is the release working as intended, but it
should be expected rather than treated as a regression in whatever PR happens to
hit it first.

Second, smaller: the guard replaces a global. If a future test legitimately needs
`fetch` — against a local fixture server, say — it will need an explicit opt-out.
Adding that mechanism now would be speculative; the guard's error message should
be clear enough that the need is obvious when it arises.
