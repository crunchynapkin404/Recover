# Brief Data Completeness: Design

**Date:** 2026-07-26
**Status:** Draft (pending user review)
**Follows:** `docs/specs/2026-07-26-event-driven-sync-triggers-design.md` (shipped as v0.25.16)

## Problem

v0.25.16 made the morning brief event-driven: it now fires as soon as new
wellness data lands, from whichever source arrives first. That fixed the
"waiting until 05:00 for data that isn't there" problem, but exposed the
real one underneath: **the system has no concept of data completeness.**
It knows only "enough to produce a number" and "not enough".

The readiness engine (`src/lib/readiness.ts`) weights four components:

| Component | Weight | Source                      |
| --------- | ------ | --------------------------- |
| HRV       | 0.40   | overnight measurement       |
| RHR       | 0.25   | overnight measurement       |
| Sleep     | 0.20   | overnight measurement       |
| Form      | 0.15   | CTL − ATL, known by morning |

`band === "calibrating"` is returned only when **both** the HRV and RHR
components are null (`readiness.ts:150`). Missing components silently
renormalize the remaining weights. So a single component is enough to
produce a confident-looking score: if intervals.icu's early sync supplies
only resting HR, readiness is "valid" while 60% of the signal (HRV + sleep)
is still missing — and nothing in the output marks it as partial.

Observed live on 2026-07-26, and the reason for this spec:

- 08:21 — brief posted: readiness 67, green, _"Je bent klaar voor
  intensiteit vandaag"_. Computed without HRV (renormalized over RHR +
  sleep + form).
- ~later — Apple Health delivered HRV 104.84 (≈ this athlete's mean, so a
  component score near 50) at weight 0.40. Readiness recomputed to **58,
  amber**.

The advice was not merely early — it was **inverted**. The athlete was told
to go hard on a day the completed data reads as amber. Because the brief is
at-most-once-per-day and never regenerates, the wrong advice stood all day.

Done when: the brief fires only once the overnight measurement has actually
arrived; when it cannot, it still appears but states plainly which signals
are missing; and a brief that admitted to being incomplete gets exactly one
chance to be replaced by the complete picture.

## Decisions

| Decision                 | Choice                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| North star               | One advisory per day that is **correct**, over an early one that gets contradicted. Trust in the number outranks how early it appears (user's explicit framing).                                                                                                                                                                                                                       |
| Completeness gate        | Fire when **today's `hrvMs` AND `sleepSecs` are both non-null**. RHR and form alone are never sufficient. These two are the heaviest missing weights (0.40 + 0.20) and the exact pair that failed on 2026-07-26.                                                                                                                                                                       |
| Gate reads RAW fields    | The gate checks `wellness_daily.hrvMs`/`sleepSecs` — **not** `componentScores`. `componentScores.hrv` is null until the athlete has `MIN_BASELINE_DAYS` (14) of history, so gating on it would keep the gate permanently shut for a new athlete (a real case on this instance today). The gate's question is "did the measurement arrive", not "can we score it".                      |
| Caveat text reads SCORES | The "what's missing" wording reads `daily_metrics.componentScores` — what actually contributed to the number. That is the honest thing to report, and it correctly distinguishes "no HRV measured" from "HRV measured but not yet baselined".                                                                                                                                          |
| Backstop behavior        | The 09:00 backstop still fires, but the brief **explicitly names the gaps** ("HRV and sleep for last night are missing — this leans on resting HR and form"). The athlete always gets something; they always know how solid it is. Consistent with the project's standing honesty principle (no fabricated confidence).                                                                |
| Revision                 | A brief that fired **complete** is never revised. A brief that fired **incomplete** may be replaced **exactly once**, when HRV + sleep both arrive later the same day. Still at most one valid advisory per day.                                                                                                                                                                       |
| Revision sends no push   | The athlete already saw the notification for the incomplete brief; a second push for the same morning is noise. The replacement is silent.                                                                                                                                                                                                                                             |
| No schema change         | `wellness_daily.hrvMs`/`sleepSecs` already exist. `daily_metrics.componentScores` already exists as jsonb (`schema.ts:318`, written at `metrics.ts:156`) and is already read by `coach-context.ts:61` — it is simply not read by `morning-insight.ts` yet. Revision state rides in the existing `chat_messages.toolCalls` jsonb, as `forced`/`generated` already do. **No migration.** |

## Architecture

### Completeness check — new, small, pure

A single predicate answering "has the overnight measurement arrived for
this date", plus a descriptor of what is missing for the caveat text. Pure
functions over values already fetched — no new queries in the hot path.

```ts
// e.g. src/lib/brief-completeness.ts
export interface OvernightArrival {
  hrv: boolean;
  sleep: boolean;
}
export function overnightComplete(a: OvernightArrival): boolean {
  return a.hrv && a.sleep;
}
```

### Trigger — `src/lib/sync/wellness-changed.ts`

The non-forced path gains the completeness gate, alongside the 04:00 floor
it already has: read today's `wellness_daily` row; if `hrvMs` or
`sleepSecs` is null, return `"skipped"` without touching
`generateMorningInsight`. `runDailyAdaptation` still runs (it is not a
user-facing notification, and training-load adaptation does not depend on
the overnight measurement). The forced path (the backstop) bypasses the
gate exactly as it bypasses the calibrating gate today.

### Brief generation — `src/lib/morning-insight.ts`

Two additions:

1. **Caveat.** When generating a forced/incomplete brief, read
   `componentScores` and prepend a plain-language line naming the null
   components. Both the deterministic template and the LLM instruction get
   it, so the caveat survives whichever path produces the text (mirroring
   how the existing race-day branch feeds both).
2. **Revision.** The stored `toolCalls` gains a flag marking the brief as
   incomplete-and-therefore-revisable.

   **Ordering matters here.** Today's at-most-once guard returns `"skipped"`
   as soon as any non-debrief message exists for today, which would block
   every revision before it started. So the revisable-brief check must run
   **before** that guard, not after it:

   ```
   today's brief exists?
     ├─ no                        → generate normally (guard unchanged)
     └─ yes
          ├─ marked revisable AND overnight now complete
          │     → regenerate, UPDATE that message in place, clear the flag,
          │       send no push                     (exactly one revision)
          └─ otherwise            → "skipped"      (guard unchanged)
   ```

   The replacement is an `UPDATE` of the existing row, not a second
   `INSERT` — so the thread still shows one brief for the day, and the
   dashboard card (which reads the latest non-debrief message) needs no
   change. Clearing the flag is what enforces "exactly once": a second late
   arrival finds a non-revisable brief and skips.

### What stays untouched

The readiness engine's own maths, weights, and `calibrating` semantics; the
09:00 backstop's schedule and its `userIds` test-scoping; the once-per-day
guard for complete briefs; the ride/race debrief pipeline; weekly and
monthly review.

## Out of scope

Each is a genuine issue, deliberately kept separate so this spec stays
implementable in one pass:

- **Missing Apple Health fields.** VO2max, weight, BMI, lean mass, waist
  and wrist temperature never arrive. The live metric-name diagnostic
  (v0.25.15) shows Health Auto Export currently sends 13 metrics, and
  `body_mass` — a long-working mapping — is absent too. That points at the
  iOS app's export selection, not at wrong metric names in our connector.
  Check the phone first; no code change is implied.
- **The 8 ignored metrics** now arriving (steps, walking speed/asymmetry/
  step length, flights climbed, active + basal energy, raw heart rate).
  A real feature with no home in the current schema or UI; needs its own
  design.
- **`adaptDay` non-idempotence.** Re-scales an already-scaled workout on
  every invocation, with no `status === "adapted"` guard. Real damage
  already in the live database (a `Long/Z1-Z2/8min` slot on 2026-07-24 with
  12 stacked adjustments). Needs a migration and its own review, and is
  arguably more urgent than this spec.
- **The component weights themselves** (is HRV 0.40 right?) — a sports-
  physiology question, not a software one.

## Testing

- Gate: today's row with HRV but no sleep → no brief; sleep but no HRV →
  no brief; both → brief fires; neither, forced → brief fires with caveat.
- Gate reads raw fields, not scores: an athlete with fewer than 14 baseline
  days but both measurements present passes the gate (regression test for
  the new-athlete case).
- Caveat names exactly the null components, and appears in both the
  template path and the LLM-instruction path.
- Revision: incomplete brief → later complete data replaces it in place
  (one message total, not two), sends no push, and a second late arrival
  does not revise again.
- A complete brief is never revised by later data.
- `runDailyAdaptation` still runs when the gate blocks the brief.
