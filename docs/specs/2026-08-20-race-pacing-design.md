# Race pacing — design

The skipped v0.54, from `docs/ROADMAP.md`: "pacing bands with confidence and
assumptions made visible." Written 2026-08-20. Every claim below about existing
behaviour was read out of the file that implements it.

## The engine already exists

This is not a new model. `src/lib/race/` already computes the pacing target and
throws it away.

`estimateRidingHours` (`riding-time.ts`) resolves "power needs duration needs
power" by fixed-point iteration. On its last pass it holds a sustainable FTP
fraction for this event — and returns only the hours. The fraction comes from
`ftpFractionFor(hours)`, which is **already exported**:

```
FTP_FRACTION_ANCHORS: 3h → 0.85, 5h → 0.75, 8h → 0.68   (interpolated, flat outside)
```

`estimateRunningHours` (`running-time.ts`) is Riegel's endurance model over an
ITRA km-effort distance. Riegel predicts race pace for a distance **by
construction**, so the target pace is `distanceKm / hours` — no new maths.

So the work is a derivation, a vocabulary wrapper, and a surface.

## What a band is here, and what it is not

**An intensity range, not a segmented plan.** `races` stores total `distanceKm`
and total `elevationM` (`src/lib/db/schema.ts`) — there is no course profile.
"Hold 210-225 W" is supportable. "Ease off on the climb at 40 km" is not, and
producing it would be fabrication of exactly the kind
`docs/specs/2026-08-08-uncertainty-vocabulary-design.md` exists to prevent.

## Decisions

| #   | Decision                                                                    | Why                                                                                                                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | A new pure module `src/lib/race/pacing.ts`, not an addition to `outlook.ts` | `outlook.ts` answers "what shape will I be in" from a TSB forecast. Pacing answers "how hard do I go" from anchors and course. Different question, different inputs; folding them together makes one file do two jobs.                                                                    |
| D2  | Returns `Figure<PacingTarget>` from `src/lib/uncertainty.ts`                | The vocabulary already carries `confidence`, a free-text `why`, and a `missing_input` case with a fix link. That IS "confidence and assumptions made visible" — inventing a second shape for it would be worse and inconsistent.                                                          |
| D3  | Bike and Run at launch; **Triathlon returns `Figure.notApplicable`**        | Triathlon pacing has a coupling nothing here models: bike effort determines what is left for the run. A bike wattage computed as though no run followed is not an incomplete answer, it is a harmful one. Refusing is a first-class result.                                               |
| D4  | Band width is a declared engineering bound, `Confidence: Low`               | There is no published figure for how wide a pacing tolerance should be. `forecast.ts` already sets the house precedent for this exact situation: `ADHERENCE_CEIL` is documented as "an uncited, symmetric engineering bound". Say the same thing rather than dressing a guess as derived. |
| D5  | Exposed as a tool in `src/lib/tools/`                                       | Principle 2 (`CONTRIBUTING.md`): every data capability is one object serving both the coach and MCP. Not optional. The coach must answer "how hard should I go Sunday?" from the number the UI shows, not a second one.                                                                   |

## The module

`src/lib/race/pacing.ts` — pure, no I/O, no clock, mirroring `priceLeg`'s shape
in `demand.ts` and reusing its already-assembled anchors.

```ts
export interface PacingInput {
  sport: "Bike" | "Run" | "Triathlon";
  distanceKm: number | null;
  elevationM: number | null;
  eventDays: number;
  ftpWatts: number | null;
  massKg: number | null;
  thresholdPaceSecPerKm: number | null;
}

export type PacingTarget =
  | {
      sport: "Bike";
      targetWatts: number;
      lowWatts: number;
      highWatts: number;
      ftpFraction: number;
      hours: number;
    }
  | {
      sport: "Run";
      targetSecPerKm: number;
      lowSecPerKm: number;
      highSecPerKm: number;
      hours: number;
    };

export function racePacing(input: PacingInput): Figure<PacingTarget>;
```

**Bike:** `hours = estimateRidingHours(...)`, then
`fraction = ftpFractionFor(hours)`, then `target = ftpWatts * fraction`.

**Run:** `hours = estimateRunningHours(...)`, then
`target = (hours * 3600) / distanceKm` seconds per km.

**Multi-day events** (`eventDays > 1`) are `Figure.notApplicable`. The stored
distance is the total across all days, so a single sustainable intensity over
it is meaningless — the same reason `demand.ts` treats stage events separately.

## The band's width

```ts
/**
 * Half-width of the pacing band, as a fraction of the target.
 *
 * UNCITED, SYMMETRIC ENGINEERING BOUND — Confidence: Low. There is no
 * published figure for how wide a pacing tolerance should be, and this is not
 * derived from anything. It is wide enough to be holdable on real terrain
 * without a power meter twitching the athlete around, and narrow enough that
 * the top of the band is not a different workout from the bottom.
 *
 * Same voice, and the same honesty, as forecast.ts's ADHERENCE_CEIL. If it is
 * ever measured, this comment is what should be deleted.
 */
export const PACING_BAND_FRACTION = 0.05;
```

±5% of a 250 W target is 237-263 W; of a 5:00/km target, 4:45-5:15. Both are
tolerances a person can actually hold.

The band is symmetric around the target and **does not widen with lower
confidence.** Confidence is reported separately, in words. Encoding it as a
wider band would look derived, and would quietly turn a low-confidence figure
into one that is technically harder to be wrong about — which is not the same
as being more useful.

## Confidence, and where each level comes from

Every level below is traceable to something already written down. Nothing is
assigned by feel.

- **Bike, event ≥ 8 h → `low`.** `demand-constants.ts` says the 8 h anchor "is
  LOW CONFIDENCE — it is a reading of what the old `>5h` band meant, not a
  published figure". The figure repeats that reason in its `why`.
- **Bike, under 8 h → `medium`.** Interpolated between anchors that are
  themselves engineering readings, through a drag equation scaled by an
  uncited `REAL_WORLD_FACTOR`. Defensible, not measured.
- **Run → `medium`.** Riegel is cited (Riegel 1981, _American Scientist_
  69(3):285-290), which is better founded than the cycling anchors — but the
  ITRA km-effort elevation conversion in front of it is not, so `high` would
  overclaim.
- **Never `high`.** No path here is measured against this athlete's own race
  results. When race results start feeding back (`races.resultActivityId`
  exists and is unused by this feature), that is the release that earns `high`.

## When it refuses

- **No anchor for the sport** → `Figure.missingInput`, `needs` naming the
  anchor, `fix` linking to Settings. `demand.ts` already distinguishes
  `no_cycling_anchor` from `no_running_anchor`; the same distinction is kept so
  the fix link points at the right field.
- **No distance** → `Figure.missingInput`, fix linking to the race.
- **Triathlon** → `Figure.notApplicable`, `why` stating the bike-to-run
  coupling explicitly, so the athlete learns why rather than seeing a blank.
- **Multi-day** → `Figure.notApplicable`, `why` stating that the stored
  distance is a total across days.

## Surfaces

**The race card** (`raceCard` in `src/lib/race/outlook.ts`, rendered from
`src/app/train/page.tsx`) gains the pacing line. Target, band, and the `why`
visible — not behind a tooltip, because the assumption is the point.

**A tool**, `src/lib/tools/get_race_pacing.ts`, one object serving coach and
MCP per Principle 2.

**Out of scope:** the Today race chip (`src/components/today/race-chip.tsx`).
It is a chip; a target, a band and an assumption do not fit one, and cramming
them in would drop the assumption first — which is the half that matters.

## Testing

- **Pure-unit, table-driven**, matching `riding-time.test.ts`'s shape.
- **Mutation-check the fraction wiring specifically.** The likely defect is
  reading `INITIAL_FTP_FRACTION` (0.75, the pre-iteration guess) instead of
  `ftpFractionFor(hours)`. A 5 h event resolves near 0.75, so a fixture at 5 h
  **cannot tell those apart** — this is exactly the fixture failure
  `docs/RELEASING.md` step 3 names. Fixtures must sit at 3 h and 8 h, where the
  two differ by 0.10 and 0.07.
- **Every unavailable case gets a test**, including Triathlon and multi-day.
  `Figure.notApplicable` carries the reason string an athlete reads; a
  regression that empties it is invisible to a truthy check.
- **A test that the band brackets the target** and that its width tracks the
  declared constant, so changing the constant cannot silently stop widening it.

## What this deliberately does not do

- **No segmented pacing.** No course profile exists. See above.
- **No triathlon.** See D3.
- **No feedback from race results.** `races.resultActivityId` is populated and
  ignored here. Calibrating the model against what the athlete actually did is
  the obvious next release and the one that could justify `high` confidence.
- **No live/in-race guidance.** Nothing in this app is on the athlete's head
  unit, and a pacing number that arrives after the start is a briefing, not a
  guide.
