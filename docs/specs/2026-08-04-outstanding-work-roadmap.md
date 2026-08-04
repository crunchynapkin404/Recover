# Outstanding work, sequenced — 2026-08-04

Everything open against Recover as of `v0.38.0`, put in the order it should be
built. This document exists because the record had drifted: `docs/ROADMAP.md`
carries no section for v0.24 through v0.36, several releases deliberately
deferred work into "its own release" without anywhere to record that, and a
handful of items live only in session memory. The last release in the sequence
below folds this document into `ROADMAP.md` and retires it.

## How this inventory was derived

Each item below was verified against the current tree at `67162f6`, not carried
over from a prior session's notes. Where a memory claimed a defect, the code was
read to confirm it still exists; two claims did not survive that check and are
recorded under "Closed on inspection" rather than scheduled.

## The sequence

### 1. v0.39 — The Importer Carries Everything

`importUserData` silently drops **14 columns across 5 tables**, every one of them
documented in `export-user.ts` as included verbatim. Design:
`docs/specs/2026-08-04-importer-column-parity-design.md`.

First because it is the only item already fully scoped — the column list is
known and exact — and because it closes the deferral v0.38.0 explicitly left for
its own release, plus four further tables that had never been noticed at all.
Its guard is a compile-time mechanism, so it binds in CI without depending on
item 2.

**The follow-up it leaves, deliberately.** A new _column_ is now compile-enforced
end to end. A new _table_ is not: adding one to `UserExport` forces
`exportUserData` to populate it, but nothing forces `import-user.ts` to read it,
so it would be dropped silently with a green typecheck. The guarantee there is
still prose, in the header comments of both files — in a file whose whole thesis
is that prose guarantees do not hold. The spec was scoped to columns and neither
it nor the changelog claims table parity, so this is a genuine gap rather than a
broken promise. A cheap fix exists: a `Record<ImportedTable, true>` witness in
`import-user.ts`. Worth folding into whichever release next touches that file.

### 2. v0.40 — Tests That Bind in CI

`.github/workflows/ci.yml` runs `npm test` with no `DATABASE_URL`; the env block
is scoped to the `npm run build` step alone, and the workflow declares no
Postgres service. Design: `docs/specs/2026-08-04-ci-database-service-design.md`.

Measured by running the suite both ways: **71 test files and 405 tests — 23% of
the suite — skip on every pull request** (243 files / 1725 tests total; 88 files
carry a `describe.skipIf(!hasDb)` guard).

**The "expect triage, not config" prediction was wrong, and is corrected
here.** Run against a fresh migrated Postgres the suite passes completely — 243
files, 1725 tests, zero failures, +18 seconds. There is no hidden breakage. The
one real hazard is different from the predicted one: the tick's post-job
hooks (weekly review, race debriefs, auto-describe) run with real imports
inside `try/catch` and sit outside the guard that already keeps the tick's
provider passes off the network under vitest, so the design adds one.

**The follow-up it leaves, deliberately.** `tests/ci-has-database.test.ts`
gates itself on `process.env.CI === "true"`, which is presence-based one
level up: if `CI` is ever not exactly `"true"`, the anti-skipping guard
skips silently instead of catching the regression it exists for. The
realistic threat is still covered, since `CI` is set by the runner rather
than by anything this workflow file controls. But a strictly stronger and
equally cheap design exists: an _ungated_ test that reads
`.github/workflows/ci.yml` directly and asserts `DATABASE_URL` and
`DATABASE_DRIVER: pg` appear at job level, above `steps:`. That would run on
every machine, in and out of CI, with no environment variable able to
defeat it. Worth folding into whichever release next touches CI; not built
now.

### 3. v0.40.x — The Double Push, Settled

After a ride the athlete receives two byte-identical "Ride synced — how did it
go?" pushes, minutes apart. v0.30.1 shipped the logging to answer it and nobody
has read the logs since. One command decides the release's entire shape:

```sh
docker logs recover-app-1 --since 12h | grep -E 'push sent|push subscription pruned'
```

Two `push sent` lines with the same `activityId` means two real sends and an app
bug. One line means the app sent once and iOS displayed it twice, which is not
ours to fix — in that case this closes as a documented finding and ships
nothing. Sized as a patch on that basis. It is the only defect on this list
reported by a human rather than found by reading code, which is why it precedes
the two larger engineering items.

### 4. v0.41 — One Ride, One Pass

A single ride currently triggers six or more `runDebriefLifecycle` passes:
Strava fires both `create` and `update` webhooks and each schedules its own
intervals catch-up sync, the 15-minute `runActivityPolls` sweeps independently,
the tick claims the strava and intervals_icu jobs and runs the full post-sync
chain for each, and `/api/sync/now` runs a whole unlocked tick on demand. The
tick's `pg_try_advisory_xact_lock` covers only the job claim — not the
processing, and not the housekeeping passes.

Directly after item 3 because the log read may show the fan-out _is_ the
double-push mechanism, in which case these two merge into one release and this
section is where the fix lands.

### 5. v0.42 — Running Volume Is Athlete-Relative

`generateRunningWorkouts` and `generateTriathlonWorkouts` clamp a session's
minutes and then discard the remainder, exactly as cycling did before v0.30.0.
The cycling rule must **not** be ported across: cycling's injury mechanism is
cumulative and already bounded upstream by the ACWR ceiling, whereas running has
a single-session spike mechanism — exceeding your own recent longest run by
10–30% raises injury risk substantially. Running's bound has to be
athlete-relative, derived from that athlete's own recent long run, and it needs
its own spec and its own defence of every constant.

Last of the code work because it is the only feature-sized item here and the
only one whose correct behaviour is still an open question rather than a known
answer.

### 6. v0.42.x — The Record Catches Up

Documentation and hygiene, no production code:

- `ROADMAP.md` sections for v0.24–v0.36 (ten shipped releases, unrecorded), and
  this document folded in and deleted.
- Release objects for the 11 tags that have none (v0.6.0, v0.6.2, v0.8.1,
  v0.23.1, v0.25.0, v0.25.2–6, v0.25.12). `scripts/backfill-release-objects.sh`
  already exists for this.
- `ROADMAP.md` reconciled with two decisions taken in session and never written
  down: v0.16 Stronger Together dropped, Cycle-Aware Readiness deferred.
- Repo hygiene: 4 stale worktrees under `.claude/worktrees/`, 23 merged local
  branches. Check for dev-server processes rooted in a worktree before removing
  it — that has blocked removal before.

Carries no risk and no dependency, so it fills any gap in the schedule rather
than holding a slot.

## Parked, with the reason stated

These stay closed unless something changes. They are listed so that a future
session does not rediscover them as though they were open.

- **v0.16 Stronger Together** (sharing, group view, coach seat, group digest,
  shareable cards) — dropped as YAGNI. `ROADMAP.md` still shows it as a normal
  unchecked section; item 6 fixes that.
- **Cycle-Aware Readiness** — deferred. Nobody on the instance generates cycle
  data, so the feature would ship with no way to know whether it works.
- **Fitbit / Google Health direct** — conditional on demand that has not
  appeared.
- **Accessibility as-you-go** — open by nature. It is a standing practice, not a
  deliverable, and should never be marked done.

## Owed verification — human only

No release may claim these; they need a person and, in two cases, a real device.
They are listed here so the debt stays visible rather than being quietly
absorbed into a release's done criteria.

- **Press "Backfill full history" on the live instance.** v0.36.0 shipped it and
  it has never been run against live. The dev database holds a dry run from
  _before_ the load-only stop rule landed, so it is not evidence.
- **A browser pass on `/settings` and `/body`.** Never done — no credentials in
  the build environment.
- **The `<input type="time">` picker, on a real phone.** Eight sites use it and
  it is the primary input of the entire availability feature. Automated specs
  `fill()` it programmatically, which exercises none of what a human would hit.
- Voice dictation in Firefox (no `SpeechRecognition`; the feature-detected
  fallback branch has never run) and PWA install/push on iOS.

## Closed on inspection

Two items carried in memory as open did not survive a read of the current tree:

- **"The verification gate omits `npm run build`."** True of the local pre-merge
  gate, but `.github/workflows/ci.yml:22` runs it on every pull request, so the
  failure mode it describes — a release image build failing at tag time — is
  caught before merge. Not scheduled.
- **`activities.raw` and `llm_settings.encryptedApiKey` missing from the
  importer.** Both are deliberate, documented strips, not the column-parity
  defect they resemble. Recorded as exemptions in item 1's design rather than
  fixed.
