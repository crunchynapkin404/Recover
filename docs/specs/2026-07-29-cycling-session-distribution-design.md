# Cycling Session Distribution — Design

**Status:** approved 2026-07-29. Supersedes nothing; fixes a defect present since
`training-plan.ts` was created.

**Problem in one line:** the weekly target is computed carefully and then ~30% of
it is discarded by unsourced constants in the session generator.

---

## The defect

Live evidence, owner account, week of 2026-08-03 (skeleton week 5, build phase):

| stage                                                         | value                                                                   |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| race demand (The Ride – Dolomites 2026, 8 days, 2026-09-13)   | 15.68 h/wk                                                              |
| measured ceiling (1.3× rolling peak)                          | 17.47 h/wk                                                              |
| maintenance floor                                             | 8.07 h/wk                                                               |
| offered availability                                          | **12.50 h** ← binds                                                     |
| `weeklyTargetHours` result                                    | **12.50 h**, `source: "race"`, `shortfall {wanted 15.68, offered 12.5}` |
| handed to `generateCyclingWorkouts` (× build multiplier 1.03) | 772 min                                                                 |
| skeleton actually produced                                    | **559 min (9.32 h)**                                                    |
| finally scheduled after `materializeWeek`                     | **525 min (8.75 h)**                                                    |

The 247-minute loss decomposes exactly:

```
Long       round(772 × 0.38) = 294 -> min(…, 240)         = 240   -54
Intervals  round(772 × 0.18)                              = 139
Endurance  easyMins = round((772 − 379) / 2) = 197
           -> max(30, min(197, 90))                       =  90  -107
Endurance  same                                           =  90  -107
                                                    total = 559
```

`Math.max(30, Math.min(easyMins, 90))` at `training-plan.ts:433` is the dominant
leak: it computed 197-minute endurance rides and clamped both to 90.

### Why the constants have no standing

- Every cap (90/60/240/180) and proportion (0.38/0.18/0.32/0.15) arrived in a
  single commit — `619b6ae`, 2026-07-15, the file's initial 514-line creation.
  Never revised.
- 748 lines, **zero** rationale comments; no reference to research, ACWR or
  evidence anywhere in the file.
- **No test pins any of them.** The only assertions on `generateWorkouts` are
  that each workout has a purpose and `minEffectiveMins > 0`.
- `volume.ts`, which feeds this generator, was created 2026-07-28 — thirteen days
  later — and documents every constant it uses with reasoning. The careful layer
  hands its number to an older layer that discards it.

Absence of recorded intent is not proof the caps were arbitrary, but in a
codebase where every sibling module justifies its constants, the silence is
itself evidence.

---

## Scope

**In:** `generateCyclingWorkouts` only.

**Out:** `generateRunningWorkouts` and `generateTriathlonWorkouts` carry the same
structural leak but need their own evidence — running's is the athlete-relative
spike rule below, which is a genuinely different rule. Running follows as its own
spec and plan. Triathlon is unscheduled.

**Why not one sweep:** cross-sport borrowing is the error that produced this bug.
Cycling is non-impact; running is weight-bearing. A study of 5,200+ runners found
exceeding your own recent longest run by 10–30% raises injury risk 64%, and
doubling it raises the risk 128% — a session-level spike rule with real support.
**No cycling equivalent exists.** In cycling, overuse injury follows _cumulative_
load outrunning tissue repair, and risk rises when a week exceeds ~1.5× the
4-week rolling average — which Recover already bounds upstream at `HEADROOM 1.3`,
inside the safe band, plus the ramp clamp.

**The consequence that makes this safe:** for cycling, the weekly target is
already the safety-bounded number before the generator ever sees it.
Distributing it in full introduces no load spike. What the generator must not do
is invent its own unsourced second opinion.

---

## The rule

**The target is the contract.** `generateCyclingWorkouts` distributes its
`weekHours` in full, within per-session bounds that are themselves derived from
the athlete's event rather than from constants.

### Session bounds

| session           | today                                        | proposed                                                     |
| ----------------- | -------------------------------------------- | ------------------------------------------------------------ |
| Long              | `min(round(total × 0.38), taper ? 90 : 240)` | `min(round(total × 0.38), longBoundMins)`                    |
| Intervals / Tempo | `round(total × 0.18)`                        | unchanged                                                    |
| Endurance fill    | `max(30, min(easyMins, 90))`                 | `max(MIN_EFFECTIVE_EASY_MINS, min(easyMins, longBoundMins))` |

`longBoundMins` derives from `EventDemand`, which already exists and is already
computed by `assembleVolumeInputs`:

```
longBoundMins = clamp(
  round(demand.queenStageHours × 60),      // hardest single day of the event
  MIN_LONG_BOUND_MINS,                     // 120 — "longer than two hours"
  ABSOLUTE_LONG_BOUND_MINS                 // 360 — "shorter than six hours"
)
```

Named constants, with their values and the reason each exists:

| constant                    | value | why                                                                                                                                                                                                                                                      |
| --------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MIN_LONG_BOUND_MINS`       | 120   | A short event (a criterium) yields a tiny `queenStageHours`; without a floor the long ride would collapse below a useful endurance stimulus. Cycling guidance puts effective endurance rides "longer than two hours" for a moderately experienced rider. |
| `ABSOLUTE_LONG_BOUND_MINS`  | 360   | The upper end of the same guidance, "shorter than six hours". Applies regardless of how long the event is.                                                                                                                                               |
| `MIN_EFFECTIVE_EASY_MINS`   | 30    | Today's floor, retained. A minimum effective Zone 2 duration is real; this value is unchanged so it introduces no new claim.                                                                                                                             |
| `NO_DEMAND_LONG_BOUND_MINS` | 240   | Today's cap, retained **deliberately** for the null-demand path — see below.                                                                                                                                                                             |

`queenStageHours` is documented in `race/demand.ts` as "the hardest single day;
equals `dailyRateHours` when stages are unknown". Training toward the hardest day
you will actually ride is precisely what the cycling guidance describes: for
events lasting 4–5 hours a 4-hour long ride weekly is sufficient; endurance rides
run "longer than two hours and shorter than six" for a moderately experienced
rider.

When `demand.queenStageKnown` is `false` the figure is an average across event
days, not a known hardest day — for a mountain tour the true queen stage is
harder, so the bound is conservative. **State this in-code.**

**Null-demand path.** `eventDemand` returns `null` when there is no target race
or no FTP. Then there is no queen stage, and `longBoundMins` falls back to
`NO_DEMAND_LONG_BOUND_MINS` (240) — never infinity. This mirrors
`weeklyTargetHours`, which deliberately _suppresses_ race demand rather than
bypassing a null ceiling, on the grounds that "writing this as
`min(demand, ceiling ?? Infinity)` would hand a brand-new athlete ~11h/week on no
evidence at all". The identical hazard applies to session length.

240 is today's cap, retained on purpose. The governing principle: **where the
athlete's event gives us evidence, use it; where there is none, keep today's
conservative behaviour.** This change therefore only ever lengthens sessions for
athletes who have a real event to train for, and is a no-op for the long-ride
bound of an athlete without one. The endurance-ride leak is fixed on both paths,
because discarding remainder is a defect independent of any evidence.

The taper reduction stays. Taper weeks shorten deliberately; that is periodization,
not a leak.

### Redistribution

The cap values are only half the defect — the other half is that clamped
remainder is **discarded**. After sizing every session under its bound,
redistribute any unallocated minutes across sessions still below their bound,
repeating until either the target is met or every session sits at its limit.

Two rules make this unambiguous:

- **Intervals and Tempo never absorb remainder.** They keep their 18% share and
  are excluded from redistribution. Stretching a VO2max session to soak up volume
  changes what the session _is_; duration at intensity is prescribed, not filler.
  Only Long and Endurance rides participate.
- **Remainder is split evenly** among participating sessions that still have
  headroom, each capped at its own bound. Any session that reaches its bound
  drops out and the loop repeats with the rest. The loop terminates when the
  remainder is zero or no participant has headroom.

Worked, for the case above (772 min, 4 sessions, `longBoundMins` = 294):

```
Long        294  at bound
Intervals   139
Endurance   170  below bound (294) — absorbs share of remainder
Endurance   170  below bound (294) — absorbs share of remainder
            ---
            773  ≈ target        unallocatedMins: 0
```

Note `round(772 × 0.38) = 294 min = 4.90 h` is _exactly_ the owner's
`queenStageHours`. The proportional maths already wanted the correct number; the
240 cap was the only thing preventing it.

### The residual

Whatever cannot be allocated once every session is at its bound is returned as
`unallocatedMins`. Non-zero means something real — "your available days cannot
absorb this target" — not a silent clamp.

---

## Reporting

Two distinct gaps exist; only one has reporting today.

| gap                                                    | today                                       | after                            |
| ------------------------------------------------------ | ------------------------------------------- | -------------------------------- |
| demand vs availability (15.7 wanted / 12.5 offered)    | surfaced in `WeekRationale` via `shortfall` | unchanged                        |
| **target vs scheduled** (12.5 target / 8.75 scheduled) | **invisible**                               | one line, from `unallocatedMins` |

`WeekRationale` gains a single line for the open week. Next week's preview has no
rationale panel — v0.29.0 deliberately kept those panels weekly — so it gets a
single line rather than inheriting the panel.

**Out of scope:** a full rationale panel for the projected week. That is its own
design pass and must not be smuggled in here.

---

## Correcting the current week

Fixing the generator changes future derivations only. Both `projectWeek` and
`rolloverWeekPlan` call `periodize` fresh — `service.ts` is explicit that a stored
target is "never read as authority ... exactly how `hoursPerWeek` went stale in
the first place" — so **no migration is required** and next week is correct
immediately. Only the stored open week stays as it is.

`computeWeekRepair` corrects it, and is safe by construction: for a stored week it
reuses that week's own resolved availability, leaves completed and missed days
untouched, and carries `actualLoad` / `unplannedLoad` / `activityId` across
unconditionally. It can only alter days not yet trained.

**Sequenced, not automatic:**

1. Fix the generator and land it.
2. Dry-run `scripts/repair-corrupted-week.ts` **scoped with `--user`**. The script
   recomputes from current inputs, so unscoped it rewrites other athletes' weeks.
3. Review the actual diff.
4. Decide then whether to apply, or let Monday's rollover pick it up.

Two cautions on the record:

- This would be the script's **first run against live data**. It has only ever
  been dry-run; the handoff lists it as owed precisely because it needs explicit
  consent.
- **Mid-week correction back-loads the week.** With Monday and Tuesday settled,
  raising the week to target concentrates the difference into the remaining days.
  The weekly total stays inside the ACWR ceiling, but distribution is the axis
  cycling research cares about — "multiple shorter rides versus fewer long rides
  can affect injury risk differently, even with the same weekly total". This is
  why step 3 exists: the numbers must be seen before anyone commits.

---

## Testing

This is pure logic with no I/O — **all of it can be CI-visible**. No
`describe.skipIf(!hasDb)`, no tests that silently skip where CI cannot set
`DATABASE_URL`.

The invariant that was never pinned, and which would have caught this on day one:

- **Totals match target** across a matrix of hours × `daysPerWeek` × phase.
  Regression case: 12.5 h / 4 days / build totals ~12.5 h, not 9.32 h.
- Long ride never exceeds `longBoundMins`; endurance never falls below the
  minimum-effective floor.
- Redistribution: a session pinned at its bound pushes its remainder onto
  sessions with room, rather than dropping it.
- `unallocatedMins` is 0 in the ordinary case and non-zero only when every session
  is at its bound.
- Null demand (no race, or no FTP) takes the documented fallback, not infinity.
- Taper and recovery phases still shrink.

### On changed expectations elsewhere

`materialize.test.ts`, `rollover-volume.test.ts`, `repair.test.ts` and
`project.test.ts` may hold numeric expectations that shift, because prescriptions
genuinely change. The standing repo rule — _if a numeric expectation does not
hold, STOP and report rather than loosening the test_ — still applies, with one
amendment for this work: a changed number must be **re-derived deliberately and
shown correct**, never widened to pass. An expectation that cannot be re-derived
is a finding, not a test to relax.

---

## Safety note, owner account

Ceiling 17.47 h/wk implies a rolling peak near 13.4 h/wk, and the longest logged
single ride is 6.16 h — already longer than the 4.90 h queen stage. Moving the
prescription from 8 h 45 m to ~12.5 h is therefore **below a week already ridden**
and below a session length already completed. This corrects an under-prescription
rather than creating a spike.

---

## Deliberately not in this change

- Running and triathlon generators (running is next, as its own spec).
- A rationale panel for the projected week.
- Making the generator availability-aware. `materializeWeek` already fits sessions
  to real blocks via `fitToBlock` — compressing, substituting or dropping, and
  logging an adjustment each time. `periodize` is plan-scoped while availability
  is week-scoped; coupling them is a much larger change for a benefit that already
  exists.
- The proportions themselves (0.38 / 0.18). They are as unsourced as the caps
  were, but they distribute rather than discard, so they do not cause this defect.
  Revisiting them is separate work.
