# Multi-A-race seasons — implementation design

**Date:** 2026-08-19 · **Phase:** 3, first item (`docs/ROADMAP.md`) ·
**Status:** approved for implementation · **Target:** v0.114.0

**Pillar: Demand,** constrained by **Science**. The #1 ranked external request
at 244 votes, the only demand-map row marked **Gap**, and the skipped `v0.53`.

**Supersedes the "Design sketch" section of**
`docs/specs/2026-08-19-multi-a-race-seasons-design.md`, which was explicitly
labelled _"for review, not for implementation yet"_. That document's findings
about the current code still stand and are not repeated here.

**Depends on** `docs/specs/2026-08-19-multi-a-race-transition-evidence.md` for
every number this release introduces, and on
`docs/specs/2026-08-19-taper-evidence.md` for the ones it reuses.

---

## Scope

**One release, sequenced in layers.** The owner's call on 2026-08-19 was the
full feature — engine, storage, selection, the preview warning, the MCP
parameter and the surfaces — in a single release rather than an engine slice
followed by a surface slice.

The concern that argues the other way is recorded rather than dropped: this puts
an interface change and a UI change in one diff, which is the combination
`ROADMAP.md` blames for v0.56–v0.60 (a control that never reached the week it
edited). **The mitigation is ordering, not scope.** The plan sequences the
engine to green before anything renders it, and every layer below is its own
reviewable step:

1. `periodize()` signature refactor — mechanical, no behaviour change
2. `raceRecoveryDays()` and its constants
3. The taper-collision guard (a failing test first)
4. Segment composition in `periodize()`
5. Migration 0042 and the plan-target read path
6. Selection: `raceIds`, and the preview warning
7. Surfaces: Train page, coach context, `get_training_plan`
8. MCP: `generate_training_plan`'s optional `secondRaceId`

---

## 1. `periodize()` composes itself

### 1.1 The signature is refactored first, on its own

`periodize` currently takes **seven positional parameters**, three of them
optional with defaults:

```ts
periodize(
  weeksTotal,
  startingCtl,
  daysPerWeek,
  hoursPerWeek,
  sport,
  (queenStageHours = null),
  (startingTsb = null)
);
```

Adding an eighth positional makes the call sites unreadable. Step 1 of the plan
converts it to a single options object across all five call sites
(`training-plan.ts:1067`, `training-plan.ts:1542`, `week-plan/service.ts:385`,
`week-plan/project.ts:226`, plus tests). **Purely mechanical, no behaviour
change, and it ships as its own commit** so the segment work that follows reads
as a small diff rather than a large one.

This is a targeted improvement to code the work touches, not unrelated
refactoring — the parameter list is the reason the next section would otherwise
be unreviewable.

### 1.2 The body becomes `arc()`, and `periodize` composes segments

The existing body — phase shares, floors, progression, the recovery cadence —
moves unchanged into a private `arc(weeks, …): Block[]`. `periodize` becomes:

```text
single race:  arc(weeksTotal)
two races:    arc(weeksToFirstRace) + recovery(n) + arc(remainingWeeks)
```

**The rebuild needs no new phase logic.** `arc()` already collapses into
whatever week count it is handed — that is the documented `short_horizon`
behaviour at `training-plan.ts:1045-1051`, _"it collapses into whatever phases
fit inside the week count"_ — so a 4-week rebuild produces exactly the shape a
4-week plan produces today. Reusing it means the rebuild inherits the phase
tests that already exist rather than needing parallel ones.

**No enum migration.** `trainingBlocks.phase` already accepts `"recovery"`
(`schema.ts:819`) and `periodize` already emits it for step-loading weeks
(`training-plan.ts:453`). The bridge is that phase, at that fraction.

### 1.3 The recovery segment

`n = ceil(raceRecoveryDays(firstRaceType) / 7)` weeks at
`PLAN_CONSTANTS.RECOVERY_FRACTION` (0.6), which
`docs/specs/2026-08-06-periodize-evidence.md` §3 already rates **Medium** on the
50-75% maintenance band. No `BRIDGE_FRACTION` is introduced: inventing a third
number for a lever that already has two, one of them cited, is what the
evidence pass explicitly declined to do.

### 1.4 Week numbering is contiguous, and must be pinned

`trainingBlocks.weekNumber` is a smallint, and both live sites find their block
by matching a number against it — `week-plan/service.ts:393` on
`plan.currentWeek`, `week-plan/project.ts:239` on `requestedSkeletonWeek`. **Both
fall back to `derivedBlocks[derivedBlocks.length - 1]` when the match misses.**

That fallback is the hazard: a composition that leaves a gap or repeats a number
does not throw, it silently hands the athlete the plan's last block. Composition
must renumber the concatenated segments `1..weeksTotal` with no gap and no
repeat, and a test pins contiguity **directly** rather than inferring it from a
rollover that passes.

---

## 2. Data model — one additive column pair, and why

### 2.1 The decision, and the instinct it overturned

The first instinct was zero migration: everything `periodize` needs looked
present on the plan row already (`startDate`, `raceDate`, `raceType`,
`weeksTotal`), so the first race's week index is arithmetic.

**It does not hold.** It requires redefining `trainingPlans.raceDate` from "the
race this plan targets" to "the first of two", while the plan's end moves to the
second race. `raceDate` and `raceId` have **43 read sites across 10 files** —
`app/plan/actions.ts`, `app/train/page.tsx`, `race/debrief.ts`,
`race/service.ts`, `week-plan/volume-inputs.ts`, `tools/get-training-plan.ts`,
`tools/generate-training-plan.ts`, `export/import-user.ts`, `training-plan.ts`,
`schema.ts`. Changing what a column means under 43 readers is precisely the
defect shape this roadmap keeps recording.

**So `raceDate` and `raceId` keep their meaning: the plan's FINAL target**,
which for a two-race plan is the second race. The earlier race gets its own
nullable pair.

### 2.2 Migration 0042 — additive

```sql
ALTER TABLE "training_plans" ADD COLUMN "first_race_id" uuid
  REFERENCES "races"("id") ON DELETE SET NULL;
ALTER TABLE "training_plans" ADD COLUMN "first_race_date" date;
```

`0041_dashing_blur.sql` is the current head, so this is `0042`. (The
`feat/v0.65-mcp-contract-hardening` disposition doc says push quiet hours would
"take migration 0041" — that note is stale; whatever lands next takes 0042 or
later.)

**Additive, therefore cheap rollback** under `docs/RELEASING.md`'s rule that a
release classify its migrations. Every existing plan row gets `null` and behaves
bit-identically. `ON DELETE SET NULL` matches the existing `raceId` FK, so
deleting the earlier race degrades a two-race plan to a single-race one rather
than cascading it away.

**Single-race stays the untouched path**, not a special case of a new one:
`firstRaceId IS NULL` takes exactly today's code route.

### 2.3 One read path for "which race is which"

Per 2c condition 1, surfaces must not hand-roll the pairing. A single owner:

```ts
planRaceTargets(plan): { first: RaceTarget | null; final: RaceTarget }
```

Every surface that shows a plan's races reads through it. Asserted at the
surface (condition 4), not only at the function.

---

## 3. Selection and the API change

**A correction, made during this spec's own review, because it changes the
work.** An earlier draft of this section said selection replaced _"highest
priority, nearest date"_ inside `previewTrainingPlan`, citing
`training-plan.ts:1161`. **`previewTrainingPlan` does not select a race at
all.** It takes an optional `raceId` and looks it up, or takes `raceType` +
`raceDate` and promises to create one (`training-plan.ts:1001-1032`). The
"highest priority, nearest date" phrase at :1161 is a comment about the
**demand and feasibility** input — the app's one "current target race" concept —
and is not the plan's target. The callers decide the target:
`app/plan/actions.ts:812` and `tools/generate-training-plan.ts:58`.

**This retires the idea that the feature needs no new input.** The scope
question put to the owner offered an engine-only option on the premise that the
athlete's existing A-priority races were already an input the plan ignored. They
are not — nothing reads them for plan targeting — so that option would have
required inventing auto-adoption of a second A-race, which is a surprising
behaviour change on existing data rather than a smaller one. The full-scope
option chosen on 2026-08-19 is the one that survives contact with the code.

**So the second race is explicit, everywhere.**

- `previewTrainingPlan({ raceId })` becomes `{ raceIds: string[] }`, with a
  compatibility shim so a single id behaves **exactly** as today. Two ids mean
  the earlier date is the first target and the later is the final one,
  regardless of the order given.
- **The plan flow gains a second-race picker**, offering the athlete's upcoming
  A-priority races. Optional: leaving it empty is today's single-race plan.
- `generate_training_plan` gains an optional `secondRaceId`. Omitting it keeps
  today's contract exactly, so no existing coach behaviour changes.

**The cap is two, enforced on input arity**, not by silently dropping a third.
The demand row is "choosing a new goal before the last one's done", not
arbitrary multi-peak seasons, and the source design doc names more-than-two as a
non-goal. Three or more ids is a caller error and refuses with a named reason,
which is the one place a refusal is right here: it is input that can only be a
mistake, the same test `horizon_too_long` passes.

**Both ids must be A-priority and `upcoming`**, verified at lookup. A B or C
race as a second target refuses rather than quietly building a bridge to it —
`materializeWeek` already decides what B and C races do, and this feature is not
changing it.

`weeksTotal > 52` still refuses as `horizon_too_long`. Two races widen the
horizon, so this fires more often; the rule is unchanged and the reason is
already honest.

---

## 4. The warning, not a refusal

`previewTrainingPlan` already settled this class of question at
`training-plan.ts:1045`: _"A close race is SCALED, not refused — refusing to
plan is worse than planning honestly."_ Refusal is reserved for input that can
only be a typo.

So: a new `PreviewWarning` union member in `plan-preview.ts:77-113`, one
sentence in `WARNING_TEXT` (`:116`) naming the input at fault, and the
exhaustive switch that makes omitting the text a compile error. Fired when

```text
gap < raceRecoveryDays(first.raceType) + taperWindowDays(final.raceType)
```

— 35d marathon→marathon, 21d half→half, 14d short→short. Below that there is no
week that is neither recovery nor taper, so there is nothing to rebuild with.

**The copy says what the plan cannot contain, not what the athlete should
race.** The evidence doc is explicit that these floors are more permissive than
coaching consensus deliberately, and that Recover has no standing to tell an
athlete not to race.

---

## 5. The collision guard — a failing test before the engine work

`docs/specs/2026-08-19-multi-a-race-transition-evidence.md` §7: in a close
pairing the shipped code already puts race two's **taper** on the week
immediately after race one. `racesForWeek` (`race/service.ts:198`) drops race
one the moment its week passes, so the following week returns
`TAPER_FRACTION_WEEK_2` (0.80) at a 21-day gap or `WEEK_1` (0.65) at 14 — on the
week the evidence says is still repairing. Nothing in `week-plan/` or `race/`
distinguishes the week after an A-race from any other; `RECOVERY_FRACTION`'s
only three uses (`training-plan.ts:453`, `:457`, `:574`) are the step-loading
cadence.

**Unreachable today, reachable the moment this ships.** It gets a failing test
**first**, so the release proves the defect existed rather than asserting it did.

The fix: `materializeWeek` treats a week inside the first race's recovery window
as recovery, and the taper for the later race applies only after that window
closes. The two windows are pinned against each other by a test, the way
`TAPER_WINDOW_LONG` and `racesForWeek`'s 27-day lookahead already are.

---

## 6. Surfaces

Sequenced last, after the engine is green.

- **Train page** — renders the recovery/rebuild segment and both race targets,
  reading through `planRaceTargets()`.
- **Coach context and `get_training_plan`** — report both targets. Same figure,
  one read path, asserted at the surface per 2c condition 4.
- **`generate_training_plan`** — gains the optional `secondRaceId`. Omitting it
  keeps today's single-race contract, so no existing coach behaviour changes.

**No surface makes a comparative claim about the second peak.** The evidence
pass found no source in either direction, so the plan may not say the second
peak will be lower and may not say it will be equal. This is 2b.3's "no figure
plus the reason" applied to a claim rather than a number.

---

## 7. Testing

- **TDD throughout**, per `docs/RELEASING.md` step 2.
- **The collision guard's test fails before its fix** (§5).
- **Mutation-check every bound**: the recovery-window length, the warning
  threshold, the segment boundary, and week-number contiguity. The evidence-slice
  precedent is that mutation is what finds the gap reading cannot — v0.88's
  `medium` branch, v0.89's fixture that happened to equal the default.
- **Assert at the surface, not the component** (2c condition 4) for both the
  Train page and the two coach-facing paths.
- **DB-gated tests run in CI's Postgres service** and are skipped locally with
  `DATABASE_URL` unset. A local run is not the CI condition — `ROADMAP.md`
  records a reviewer getting this exactly wrong.
- **Capture the surfaces.** `verify-surfaces.ts` against a dev server, and
  **open the PNGs** — every slice that ran the capture found something axe could
  not see. A two-race plan needs a seeded state that actually contains two
  A-races, or the capture photographs the single-race path under a name
  promising the other.

## 8. Non-goals

- More than two A-races.
- Changing what a B or C race does — `materializeWeek` already handles those.
- Any claim about the second peak's height relative to the first.
- Modelling recovery from the athlete's own state. The constants describe a
  calendar, not the athlete; reading `daily_metrics` to shorten or extend the
  window would be a new athlete-facing claim needing its own evidence.
- A feature-flag mechanism. This repo has none, and the additive-null design
  makes existing plans bit-identical without one.

## 9. Risks

- **The 43-site audit is avoided, not eliminated.** `planRaceTargets()` is new,
  and any surface that keeps reading `plan.raceDate` directly will show the
  final race where it may mean the first. The plan includes a sweep of those
  sites.
- **`weeksTotal` grows**, so `CTL_RAMP_PER_WEEK`'s bound now compounds over a
  longer horizon. Worth a check that a two-race plan's peak load is still
  bounded where a single-race plan's is.
- **The interface-and-UI-in-one-diff concern** in Scope above. Ordering is the
  mitigation; it is not a guarantee.
