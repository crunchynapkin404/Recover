# Race-Day Form Projection and Feasibility — Ownership Design (Phase 2c, fifth number slice)

## Scope

The race-day form projection (projected TSB at the target date and its
green/amber/red band) and the event feasibility verdict. Both are
athlete-facing by 2c's definition: rendered on Today and Train, and returned by
the `simulate_plan_change` MCP tool.

This slice exists because the 2026-08-10 sweep found it missing from 2c's
original six entries — see `docs/ROADMAP.md`, "The slice list below is
enumerated, not guessed".

## What was found

### The projection: one computation, four renderings

`forecastForm()` and `simulatePlanChange()` in `src/lib/race/forecast.ts` are
pure and single-owner. The defect is entirely above them, in four consumers
that each decide independently what to show when there is no projection:

| Consumer                                | Encoding of "no projection"                                    |
| --------------------------------------- | -------------------------------------------------------------- |
| `src/app/page.tsx`                      | `{ kind: "insufficient" }` / `{ kind: "no_plan" }`             |
| `src/app/train/page.tsx`                | the same union, written out a second time                      |
| `src/app/plan/actions.ts`               | `insufficient: boolean` plus nulled TSB and band fields        |
| `src/lib/tools/simulate-plan-change.ts` | `insufficient: true` plus prose ("CTL/ATL not calibrated yet") |

That is condition 5 in four dialects — the failure 2b.3 exists to prevent, in a
figure 2b.3 never reached.

**The duplication is larger than the outlook mapping.** `page.tsx` lines
148-180 and `train/page.tsx` lines 707-735 are character-identical apart from
variable names: the same outlook mapping, the same `race` object, the same
`daysOut` arithmetic, both feeding `<RaceChip {...raceCard} />`. Roughly 35
lines, written twice.

**A claim corrected.** The roadmap entry as first written said the four paths
could disagree because the pages pass four arguments to
`assembleForecastInputs()` while the what-if paths pass two. That is wrong: the
fourth argument is `preloadedWeek`, and both pages pass
`getOpenWeekPlan(userId)` — exactly what the function fetches itself when the
argument is omitted (`service.ts` lines 264-266). It is a duplicate-query
optimization. The third argument `now` defaults to `new Date()`, resolving to
the same local ymd the pages pass. The mechanism by which these four can drift
is duplication, not argument mismatch.

### The two what-if paths duplicate a chain

`plan/actions.ts` and `simulate-plan-change.ts` each perform race lookup →
`assembleForecastInputs()` → build a `PlanChange` → `simulatePlanChange()`,
then serialize. The serializations legitimately differ (a server action feeding
the UI, versus an MCP tool return). The chain above them does not.

### Feasibility: three inline call sites, and two silent nulls

`assessFeasibility()` is called from `training-plan.ts` (lines 1151 and 1297)
and `train/page.tsx` (line 489). All three are structurally identical — the
same `demand == null || !demand.available ? null : assessFeasibility({...})`
guard over the same six-field input object. Only the `weeksUntilEvent`
derivation differs.

Separately, `null` means two different things and no surface can tell them
apart:

1. the caller's guard fired — no tracked race with computable demand;
2. `assessFeasibility()`'s own guard fired — no measured `currentWeeklyHours`
   or `longestSessionHours`.

Both render as silence. That is a fifth dialect, and a conflation of two
reasons the athlete would act on differently.

### The live type lives inside a dead component

`RaceCountdownProps` is exported from
`src/components/dashboard/race-countdown.tsx` and imported by `race-chip.tsx`,
`page.tsx` and `train/page.tsx`. The file's component, `RaceCountdownCard`, has
**zero non-test render sites** — its only consumer is its own test file. This
is the trap `docs/ROADMAP.md` names as blocking 2b.2's dead-component sweep,
and the reason the orphan survived: a component with a test suite looks alive.

The type also widens `band` to `string`, discarding `FormBand`.

## Fix

### Three owners

**`src/lib/race/outlook.ts`** (new). Holds the two DB-touching owners.
`race/service.ts` stays race CRUD plus `assembleForecastInputs` — it is already
406 lines, and adding these would push it past 500 while blurring its purpose.

- `raceCard(userId, now, preloadedWeek?): Promise<RaceCard>` — owns race
  lookup, input assembly, `forecastForm()`, and the outlook mapping. Each page
  becomes a single call.
- `simulateRaceForm(userId, change): Promise<SimulatedRaceForm>` — owns the
  lookup → assemble → `simulatePlanChange()` chain. `plan/actions.ts` and
  `simulate_plan_change` become serializers over it, keeping their differing
  output shapes.

**`src/lib/race/feasibility.ts`** gains
`feasibilityFor(demand, level, longestSessionHours, weeksUntilEvent): Figure<Feasibility>`
— pure, replacing the identical guard-and-mapping at all three call sites, and
splitting the two silent nulls into distinct `missing_input` reasons.

It absorbs three guards, so each has one stated outcome rather than a shared
`null`:

| Condition                                                              | Result                                                 |
| ---------------------------------------------------------------------- | ------------------------------------------------------ |
| `demand` null or not available                                         | `missing_input`: a tracked race with computable demand |
| `weeksUntilEvent` null (only `train/page.tsx` computes a nullable one) | `missing_input`: a race date to count back from        |
| `currentWeeklyHours` or `longestSessionHours` null                     | `missing_input`: measured training history             |

`assessFeasibility()` itself is unchanged and keeps returning
`Feasibility | null`; `feasibilityFor()` wraps it. That keeps the pure verdict
function testable on its own and confines the vocabulary to the layer the
surfaces read.

### Vocabulary

`RaceCountdownProps` moves to `outlook.ts` as `RaceCard`;
`race-countdown.tsx` and its test are deleted. `outlook` becomes:

```ts
Figure<{ full: ScenarioEnd; adherence: ScenarioEnd | null; capped: boolean }>;
```

which also restores `FormBand` where the old type widened it.

| Old                        | New                                                     |
| -------------------------- | ------------------------------------------------------- |
| `{ kind: "insufficient" }` | `Figure.calibrating(have, need, "days")`                |
| `{ kind: "no_plan" }`      | `Figure.missingInput("an active training plan", { … })` |
| `{ kind: "projection" }`   | `Figure.available(value, "low", why)`                   |

**Confidence: Low**, sourced in-code to `forecast.ts`'s own hedging — it
forecasts the form component only and its header states that calling it a
projected readiness score would be fabrication; its `ADHERENCE_FLOOR` and
`ADHERENCE_CEIL` are already rated Low by 2a. Low is an honest answer under 2a,
and asserting anything higher would be a new claim, which Phase 2's non-goals
forbid.

## Verification

Per 2c's six conditions:

1. **Owner** — `raceCard()`, `simulateRaceForm()`, `feasibilityFor()`, inputs
   named in their signatures.
2. **One read path** — no page or tool recomputes the mapping.
3. **Persistence** — none of these are persisted; condition 3 does not apply.
4. **Asserted at the surface** — tests assert at the page and MCP-tool level,
   not at `RaceChip`.
5. **Unknown state** — every branch is a `Figure` kind, rendered.
6. **Mutation-checked** — break the outlook mapping and each feasibility guard
   in turn; confirm a test fails for each.

Two project-specific traps to design around:

- `outlook.ts` touches `@/lib/db`, so its test file needs
  `describe.skipIf(!hasDb)` or CI crashes instead of skipping.
- The full suite must be run with `DATABASE_URL` **unset** before pushing. A
  green local gate cannot catch the skipIf trap, because locally the DB exists.

## Out of scope

- `forecast.ts`'s math and `assembleForecastInputs()`'s internals — both are
  already single-owner and behavior stays unchanged.
- `race/debrief.ts`'s taper stat — a different, already-correct question, left
  alone for the same reason v0.83 left it alone.
- The remainder of the dead-component sweep. Only `race-countdown.tsx` is
  removed here, because this slice owns its type; the other orphans belong to
  the sweep listed in `docs/ROADMAP.md`'s gate-window items.
