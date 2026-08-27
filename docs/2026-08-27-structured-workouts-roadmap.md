# Structured workouts — a separate roadmap

**Proposed 2026-08-27, against `main` at `9112d10` (v0.122.0). Not scheduled.**

Today Recover plans _"Long · 95 min · Z1–Z2"_. The athlete is told how long to
ride and roughly how hard, and decides the rest. The proposal is that Recover
plans the session itself — _"5 × 5 min at 88–94% FTP, 5 min recovery"_ — and
can hand that to the device the athlete actually rides with.

This is deliberately **not** part of the Week surface redesign
(`docs/specs/2026-08-27-week-surface-redesign-design.md`). That
one is arrangement. This one changes what the engine produces, adds a data
shape, and touches four external platforms. It is a phase.

---

## What exists already, which is more than it looks

**The pattern is in the codebase and is one sport wide.**
`PlannedWorkout` (`src/lib/training-plan.ts:75`) carries:

```ts
{ day, sport, type, durationMins, intensity: "Z1-Z2", description,
  purpose, minEffectiveMins, exercises?: StrengthExercise[] }
```

That last field is the whole argument. Its own comment says why it exists:

> The structured prescription behind `description`'s human-readable line —
> what the MCP tool and any future coach reason about, rather than re-parsing
> prose.

`StrengthExercise` is `{ lift, sets, reps, pctOneRm, targetLoadKg }`, produced
by a pure module (`src/lib/strength/prescription.ts`) from the plan's phase and
the athlete's own one-rep maxima, opt-in via the Settings fields, with every
constant labelled as coaching convention rather than measured fact, and its own
design spec (`docs/specs/2026-08-24-strength-training-design.md`).

So Recover already knows how to turn "the plan wants this stimulus" into a
structured prescription against the athlete's own baselines. **It does it for
squats and not for intervals.** Everything below is extending a pattern this
codebase has already justified, tested and shipped once.

The inputs an endurance equivalent needs are also present: FTP indoor and
outdoor (v0.118.0), threshold pace, max HR, and the `purpose` taxonomy
(`recovery`, `aerobic_base`, `long`, `threshold`, `vo2max`, `brick`) the engine
already reasons in.

## What is missing

1. **A step shape.** `{ durationS, target: { type: "power"|"hr"|"pace",
low, high }, repeat? }` — nested or flattened, with a name.
2. **A prescription function.** `intervalPrescription(purpose, durationMins,
band, baselines) → steps`, pure, the direct analogue of
   `strengthPrescription`.
3. **A surface for it.** A workout view: the interval profile as a shape, the
   targets as numbers, and _why this session_ — which Recover is better placed
   to answer than anyone, because `plan_adjustments` already records the
   engine's reasoning.
4. **Export.** A structured session is worth little if it cannot reach the
   head unit.
5. **Nothing that reads it back.** Which is Phase 7's problem, and the reason
   these two overlap.

## The four stages

Each is shippable on its own, and each is useless-but-harmless without the
next — so they must ship in this order.

### 1. Prescription — the engine

`src/lib/interval/prescription.ts`, mirroring `strength/prescription.ts`:
pure, no db, no clock, callable from tests and from MCP. Takes a purpose, a
duration and the athlete's baselines; returns steps.

**The epistemic bar is the same one strength met, and it is the hard part of
this stage, not the code.** Every number — how long a VO₂max interval is, how
many, at what fraction of threshold, with what recovery — is coaching
convention. It must be labelled `Confidence: Low` and say what would raise it,
exactly as `plan-constants.ts` does. A structured session states far more
specifically than "Z1–Z2" does, and the project's whole discipline is that it
must not state more than it knows.

Opt-in, the way strength is: an athlete with no FTP and no threshold pace gets
the band and the prose they get today, not invented targets.

### 2. Surface — the workout view

The day's session gets a name derived from its structure ("5 × 5 min
threshold"), the interval profile drawn as a shape, targets in the athlete's
own numbers, and a _why this session_ line. JOIN's home card does exactly this
and it reads well: name, three stats, profile.

This lands on top of the Week redesign, whose open-day block is where a
workout name and profile belong.

### 3. Export — reaching the device

Ordered by cost, cheapest first, and the order is not obvious:

| Target                        | Mechanism                                                          | Note                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **intervals.icu**             | Existing two-way connection, encrypted credentials, already writes | **Start here.** Recover is already connected and already writes to it. The workout lands in the athlete's calendar and _their_ device sync does the rest |
| **`.zwo` download**           | Plain XML, no auth                                                 | Cheap, self-contained, no third party to break                                                                                                           |
| **`.fit` download**           | Binary encoding, a real library                                    | The universal format; the work is the encoder, not the plumbing                                                                                          |
| Garmin / Wahoo / Zwift direct | OAuth per platform, push on every plan change                      | JOIN does all four. Each is its own integration with its own failure modes                                                                               |

**intervals.icu first is the leverage.** JOIN pushes to four platforms because
JOIN has no other route to the athlete's device. Recover already sits behind
intervals.icu, which reaches Garmin, Wahoo and the rest on the athlete's
behalf — so one write buys most of the coverage that costs JOIN four
integrations.

A note on the browser: an artifact-style download is not available here, but
the app is a real server — a route returning `.fit`/`.zwo` with the right
content type is ordinary work.

### 4. Calibration — Phase 7's half

Once a session prescribes 5 × 5 min at 290 W and the activity comes back with
what was actually held, the comparison is available for free. That is Phase
7's stated capability — _"we predicted 208 W, you held 214 W"_ — applied to a
session rather than a race. **The prescription is what makes Phase 7 sharp**,
which is the strongest argument for doing this at all, and the reason to
sequence it near Phase 7 rather than after it.

## Non-goals

Named so they are not smuggled in later:

- **A workout player.** JOIN drives trainers over Bluetooth FTMS with ERG
  control. That is an app-with-a-device-stack, not a planning app.
- **A curated library.** JOIN advertises 400+ hand-made workouts. Recover
  generates from the athlete's own baselines; a library would be a different
  product with a different epistemic basis.
- **Prescribing outdoors what only holds indoors.** Recover already keeps
  indoor and outdoor FTP apart (v0.118.0), and a step targeting 105% of the
  wrong one is worse than a zone band.

## Open questions

- **Does a structured session survive the adaptation model?** The engine
  recomputes the open week on the spot and adapts to readiness — an amber day
  drops intensity a step. A prescription pinned in the morning and adapted at
  noon has to re-prescribe, or be pinned deliberately and marked stale. This is
  the question most likely to be underestimated.
- **What happens to `description`?** Today it is the human-readable line. It
  should be _derived_ from the steps rather than kept in parallel, or the two
  drift — the same class of defect as v0.122.0's duplicated event count.
- **Does the athlete want this?** One athlete uses this app. The honest first
  move may be stage 1 plus stage 3's intervals.icu write, skipping the surface
  entirely, and seeing whether the workouts get ridden.

## Where it sits

Not scheduled. It overlaps Phase 7 rather than queueing behind it, for the
reason stage 4 gives. Phase 6 finishes first — its remaining strands are
arrangement work that this would otherwise have to be re-done on top of.
