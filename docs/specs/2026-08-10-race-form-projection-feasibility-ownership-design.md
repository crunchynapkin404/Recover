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

### `capped` reaches no athlete-facing surface

`horizonEnd` is the end of the last block in the plan (`service.ts` lines
355-358). When the race falls beyond it, `forecastForm()` sets `capped: true`
and `full.tsb` is the projection at **plan end, not at the race**.

The deleted-in-this-slice `RaceCountdownCard` rendered that caveat —
`"(projection ends at plan end)"`, `race-countdown.tsx` lines 82-87. The
`RaceChip` that superseded it drops `capped` entirely: it renders
`🏁 Race · 45 days · form +5` with nothing indicating the +5 stops short of the
race. `plan/actions.ts` also drops it. Only `simulate_plan_change` still passes
it through.

So an athlete-facing qualification existed, and was lost when the component was
replaced. That is the goal sentence's second clause failing on the same figure
this slice owns, and it is a regression rather than an omission.

### The form score is duplicated; the band scale is shared

Two different things, and conflating them would produce the wrong fix.

**Duplicated.** `clamp(50 + 2.5 · tsb, 10, 90)` appears in `readiness.ts` line
167 and `forecast.ts` line 65. Same input, same output, same meaning — the form
component score. One computation, two copies.

**Shared scale, not duplicated.** The `>= 67 green / >= 34 amber` thresholds
appear in both, but `readiness.ts` line 189 applies them to the **composite
readiness** score (weighted across HRV, RHR, sleep and form) while
`forecast.ts` applies them to the **form score alone**. That is one 0-100 → band
scale used on two different scores, which is legitimate — but it means a green
form outlook and a green readiness are different claims wearing the same
colour. Documented here; not changed, because changing it would be a new claim.

Both are inline numeric literals, which is why Phase 2a's sweep never reached
them: 2a swept _exported constants_. See `docs/ROADMAP.md`'s 2a note.

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
| `{ kind: "insufficient" }` | `Figure.missingInput("training-load history")`          |
| `{ kind: "no_plan" }`      | `Figure.missingInput("an active training plan", { … })` |
| `{ kind: "projection" }`   | `Figure.available(value, "low", why)`                   |

`insufficient` maps to `missing_input`, **not** `calibrating`. An earlier draft
of this spec said `calibrating`; the codebase says otherwise. `insufficient`
fires when `forecastForm()` gets no CTL/ATL at all, and the four surfaces
already migrated for that exact condition — the Today TSB tile and Train's CTL,
ATL and TSB tiles — all say `Figure.missingInput("training-load history")`.
`Figure.calibrating` is used only where a real count exists to report
(`correlations.ts` has events versus a minimum; body battery has days). There
is no such count here, and inventing one would make the race outlook describe
the same condition differently from the tiles directly above it — the dialect
problem this slice exists to remove.

### `capped` becomes a rendered qualification

`capped` stops being a boolean the surfaces may ignore. The `Figure`'s `why`
carries the qualification, and every surface renders it: `RaceChip` regains the
caveat it lost, `plan/actions.ts` stops dropping it, and
`simulate_plan_change` keeps passing it. Asserted at each surface per condition
4 — the regression happened because nothing tested that the caveat reached the
athlete.

### One owner for the form score

`formScore(tsb)` moves to `src/lib/readiness.ts` — where the composite already
lives — carrying source and confidence in the 2a format. `forecast.ts`'s
`formOutlook()` calls it instead of repeating the arithmetic. The band
thresholds get one exported owner alongside it, documented as a scale applied
to two different scores rather than a single figure computed twice.

This is deliberately the smaller of the two possible fixes: it removes the
duplicated computation without altering either number. No band changes value.

### Confidence

**Confidence: Low**, and the two findings above make that better sourced rather
than weaker. The chain behind a band label is:

| Step              | Provenance                                                               |
| ----------------- | ------------------------------------------------------------------------ |
| CTL/ATL EMA       | Medium — Coggan/Banister time constants (2a, v0.75)                      |
| TSB = CTL − ATL   | Definitional                                                             |
| `50 + 2.5 · tsb`  | Unsourced inline literal, never swept by 2a                              |
| `67` / `34` bands | Unsourced inline literals, and a scale borrowed from the composite score |
| Planned loads     | May not be executed — hence the adherence scenario                       |
| `capped`          | May not reach the race date at all                                       |

`forecast.ts`'s own header states that calling this a projected readiness score
would be fabrication, and `ADHERENCE_FLOOR`/`ADHERENCE_CEIL` are already Low
under 2a. Low is the honest ceiling; asserting higher would be exactly the
claim Phase 2's non-goals forbid.

## Verification

Per 2c's six conditions:

1. **Owner** — `raceCard()`, `simulateRaceForm()`, `feasibilityFor()` and
   `formScore()`, inputs named in their signatures.
2. **One read path** — no page or tool recomputes the mapping, and the form
   score exists once.
3. **Persistence** — none of these are persisted; condition 3 does not apply.
4. **Asserted at the surface** — tests assert at the page and MCP-tool level,
   not at `RaceChip`. This includes the `capped` qualification: the regression
   happened precisely because nothing asserted that it reached the athlete.
5. **Unknown state** — every branch is a `Figure` kind, rendered, `capped`
   included.
6. **Mutation-checked** — break each of these in turn and confirm a test
   fails: the outlook mapping, each of `feasibilityFor()`'s three guards, the
   `capped` qualification, and `formScore()`.

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
