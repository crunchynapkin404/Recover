# Inline numeric literals — 2a's remaining gap (v0.94.0)

Phase 2a swept **exported constants** — all 77, across 28 files — and closed on
that basis. The roadmap records, in its own item, that the sweep never reached
numbers written **inline**, which can carry exactly the same claims. This is
that sweep.

## What the survey found

Scanned `src/lib` on 2026-08-11 for numeric literals in decision and arithmetic
positions, excluding array indices, unit conversions and obvious mechanics:
179 raw hits across 54 files. Most are mechanics. **Two clusters carry real
athlete-facing claims and have no provenance at all.**

### Already fine — recorded so they are not re-swept

- **The roadmap's own named example is already done.** It cites
  `clamp(50 + 2.5·tsb, 10, 90)` duplicated across `readiness.ts` and
  `race/forecast.ts`, and the `>= 67` / `>= 34` band thresholds. **v0.87.0
  fixed both**: `formScore()` is the single owner, `FORM_BAND_THRESHOLDS` is a
  named constant, `race/forecast.ts` imports both, and each carries
  `Source: Invented` / `Confidence: Low`. Nothing to do.
- **`blood-pressure.ts`** — the category cutoffs (180/140/130/120 systolic,
  120/90/80 diastolic) are inline, but the file header cites the **2017
  ACC/AHA guideline**. The provenance exists; only the formal `Source:` /
  `Confidence:` shape is missing. Lowest-value part of this release.

### Cluster A — `src/lib/fuelling/` has no provenance whatsoever

Roughly 20 numbers, **zero `Source:` or `Confidence:` in the directory**. There
are no exported constants in it, which is precisely why 2a's exported sweep
never touched it.

It is in scope by 2a's own definition twice over: rendered by
`components/train/fuelling-card.tsx` on the Train page, and returned to the
coach by the `get_week_plan` MCP tool via `fuellingFromSession`.

**These numbers are largely sourceable, which was checked rather than
assumed.** Verified against the literature before labelling:

| Function       | Values                                          | Verdict                                                                                                           |
| -------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `duringCarbs`  | ≤60min 0–20, 60–120min 30–45, >120min 45–60 g/h | Matches Jeukendrup: small amounts <1h, ~30 g/h for 1–2h, ~60 g/h for 2–3h. **Medium.**                            |
| `duringCarbs`  | clamp at **90** g/h                             | Exactly the published ceiling for multiple-transportable-carbohydrate intake. **Medium.**                         |
| `afterCarbs`   | 0.6–0.8 / 0.8–1.0 / 1.0–1.2 g/kg                | ≥1.2 g/kg/h maximises glycogen repletion; ≤0.8 is explicitly sub-optimal. Long band hits the optimum. **Medium.** |
| `afterProtein` | 0.25–0.35 g/kg                                  | Sits on the cited 0.3–0.4 g/kg/h co-ingestion range. **Medium.**                                                  |
| `duringFluid`  | 400–800 ml/h, +100 when high intensity          | **Low.** Fluid need is individual and sweat-rate driven; Recover does not know sweat rate.                        |
| `beforeCarbs`  | 20–30 / 30–50 / 50–70 g                         | **Low.** Plausible practice, no single citation found for these bands.                                            |

Worth recording: the model's _structure_ matches the literature's conditional,
not just its numbers. It gives deliberately sub-optimal carb factors (0.6–0.8)
for short sessions **and** always adds protein — which is exactly the case
where co-ingestion is documented to help. That is a coherent design, and the
comments should say so rather than listing values.

The honest caveat that must ship with it: these are **general guidance, not a
personalised prescription**. Recover knows duration, intensity band and body
mass. It does not know sweat rate, gut tolerance, heat, or altitude.

### Cluster B — `training-plan.ts`'s session-distribution model

The ratios that decide what an athlete's week physically looks like, all
inline, all undocumented — while their _exported_ neighbours in the same file
(`MIN_LONG_BOUND_MINS`, `ABSOLUTE_LONG_BOUND_MINS`) each carry a full
`Source:` block from 2a's original sweep. The clearest possible illustration of
the gap this release exists to close.

- Run: long run **0.32** of weekly minutes; other sessions **0.15**
- Bike: long ride **0.38**; others **0.18**
- **Triathlon: swim 0.20 / bike 0.40 / run 0.40**
- Within-discipline: **0.45**, **0.55**, **0.30**

The triathlon split is the sharpest claim of the group — it decides how a
triathlete's hours divide between three sports, and it is a bare literal.

## The fix

**Promote each cluster to a named, documented constants object**, following
`plan-constants.ts` and `race/demand-constants.ts`, which already establish the
pattern in this repo. Naming them does three things a comment cannot: it makes
them greppable, it puts them inside the exported-constant discipline 2a already
enforces, and it makes a future sweep able to find them.

Each entry carries `Source:` and `Confidence:` in 2a's existing shape. Where
the literature supports the number, cite it and rate Medium. Where it does not,
label it **Invented / Low** — an acceptable answer, and per the roadmap far
better than silence. **No number changes value in this release.** It is a
provenance release; if the sourcing shows a number is wrong, that is a finding
to report, not to quietly fix here.

## Non-goals

- **Changing any value.** See above.
- **A guard against new inline literals.** Tempting after 2d, but a detector
  that distinguishes a claim-bearing constant from an array index is a real
  design problem, and getting it wrong produces either noise or false comfort.
  Recorded as a candidate for the post-gate fill, not built on the way past.
- **`get-workout-syntax.ts`, `coach-persona.ts`, `zwo.ts`** — the scan's other
  large hit counts. Checked: workout-syntax examples, prompt text and Zwift XML
  mechanics. No athlete-facing claims.

## Conditions

Mutation-checked like any bound: change a promoted constant and confirm a test
fails. Where no test currently pins a fuelling number, that absence is itself a
finding — `calculate.test.ts` exists, so check what it actually asserts before
assuming coverage.

## Gate

All five, with `set -a; . ./.env; set +a` exported so the DB suites run.
