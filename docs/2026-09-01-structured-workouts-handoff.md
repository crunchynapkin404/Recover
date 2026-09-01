# Handoff — structured cycling workouts, v0.125.0 → v0.127.0

**Read this if you are picking up `src/lib/interval/`, the workout library, or
anything that captures a surface.** Written 2026-09-01 at the end of the
strand. Everything here was measured or run, not remembered.

Authority order: **the code and the workflow files**, then `docs/ROADMAP.md`,
then `docs/specs/2026-08-31-structured-cycling-workouts-design.md`, then this
file. It supersedes nothing — `docs/2026-08-31-visual-polish-handoff.md`'s
traps are all still true and still worth reading.

---

## State

|            |                                                                        |
| ---------- | ---------------------------------------------------------------------- |
| Shipped    | **v0.126.0** (slices 0–4) and **v0.127.0** (slice 5 + the capture job) |
| Merges     | 13, `#211`–`#224`                                                      |
| Tests      | **3452 passed, 1 skipped**, no expected fail                           |
| Library    | **46 workouts, 12 families**, two families at every covered duration   |
| Migrations | **none** — the export pin lives in the existing week-plan JSON         |
| Rollback   | reachable only while Soak run **33519240386** exists                   |

The feature: Recover planned _"Intervals · 95 min · Z4–Z5"_ and left the rest
to the athlete. It now plans the session, draws it, and hands it to the head
unit via `.zwo` or the intervals.icu calendar.

---

## What is genuinely unproven

Stated plainly rather than implied, because two of these were nearly missed.

- **The three judges never ran.** The 17-agent workflow that produced the
  design lost all three judges and all four attackers to a session limit.
  The adversarial pass was done by hand (`docs/2026-08-31-cycling-workouts-adversarial-pass.md`)
  and found eleven defects, but the three rival designs were never scored —
  `result.tally` in that run's cache is still `{}`.
- **`renderDescription` is honest but vague on alternating bodies.**
  `vo2-30-30` reads _"3 × 5 min at 50–125% FTP, 5 min recovery"_. Accurate —
  five minutes of alternating work then five easy — but it describes the span
  rather than the structure. Deliberate: a work body holding interior rests is
  described by its span, because vague is recoverable and wrong is not.
- **Two families is a floor, not a claim about sufficiency.** It is the
  smallest number at which the pick is a choice at all. Whether 46 workouts
  feels varied over a season is a question only riding it answers.

---

## Traps this strand sprang

**A green suite is not evidence the branch compiles.** Vitest transpiles and
strips types without checking them. 47/47 passed on a branch where
`tsc --noEmit` had **seven errors**, from an import a plan told the implementer
to delete — and two task reviews read the diff and passed it too. Run
`npx tsc --noEmit` after every task, not only at the end.

**A guard you have never seen fail is not a guard.** Every one here was
mutation-tested, and the two that found real defects were the two that had been
broken deliberately first. Three examples that each caught something: dropping
the flex delta fails 15 tests; swallowing an intervals.icu rejection fails
_"does NOT pin when intervals.icu refuses"_; collapsing a workout family fails
the rotation guard with 84 minutes listed by number.

**A fixture that cannot distinguish two rules tests neither.** Slice 1's stub
gave every family one candidate, so a test named _"spreads across families
rather than across ids"_ passed identically under id-uniform selection — and
that thinness hid a **Critical**: FNV-1a's low bit is a parity, not a hash, so
`seed(date|family)` was a constant XOR of `seed(date)` and one workout of any
even-sized family was unreachable (measured: index 1 chosen 181/181). Fixed
with a murmur3 finalizer. When a test's point is "X rather than Y", X and Y
must differ in the fixture.

**Prose-matching checks misfire, repeatedly.** Three times in this strand,
after the visual-polish handoff recorded four more in one strand. Slice 0's
plan mandated the doc comment _"never watts"_ and then grepped `/\bwatt/i`, so
the slice could not pass its own proof step. `purity-guard.test.ts` strips
comments before matching and is the pattern that holds — and it later caught
`"Easy watts at high cadence"` in a workout's `why`, which becomes the `.zwo`
description an athlete reads.

**Capture coverage says nothing about a surface the fixtures cannot produce.**
v0.126.0 shipped with 100 PNGs and a `0 confirmed` axe report, **none of which
contained the feature that release existed to add** — every seeded plan is a
marathon, the race decides the plan's sport, and this answers cycling days
only. Closed by a fourth capture job with its own seeded cycling owner
(`scripts/seed-cycling-owner.ts`, `capture-cycling`).

**A surface added to the global `SURFACES` map is captured by BOTH workflows.**
`0.127.0-rc.1` died in the Soak because `train-workout` was excluded from
`surfaces.yml`'s demo job but not `soak.yml`'s. Update both `--except` lists.
That the release died rather than filing a wrong picture is the guard working.

**`Current release:` had no guard and rotted three times in one session** —
README seven releases behind, ROADMAP two, and ROADMAP again the very next
release after being corrected. `tests/release-version-guard.test.ts` now checks
both against `package.json`; it caught README on its first run.

---

## Design decisions you should not undo without reading why

- **Derive at read time; pin only on export.** A %FTP structure is a pure
  function of `(purpose, durationMins)`, so storing it buys only staleness —
  and the engine rewrites a planned day in at least six places. The pin exists
  because once a workout reaches a head unit, a silent re-derive means Recover
  disagrees with the device.
- **The pin is four fields, on the SESSION.** `workoutId` and `exportedAt`
  alone cannot answer "does this still fit?", because re-derivation depends on
  the library, and the library grows — a content-only release would mark every
  exported day stale at once. It lives on `ScheduledWorkout`, not `DaySlot`,
  because a day holds up to two sessions.
- **Variety is spread, not avoidance.** Avoiding what a nearby day picked
  needs either a `recent` argument — reintroducing the neighbouring-day
  dependency the pin's design removed — or stored state.
- **FTP is not an input to the matcher.** No planned session carries
  indoor/outdoor context, and the renderers emit `%` and fractions that
  intervals.icu and Zwift resolve themselves.
- **The flex step is sized to its purpose, not by position.** For
  `recovery`/`aerobic_base`/`long` it is the endurance body. Warmup-sized flex
  everywhere needs 70 workouts to tile the range where 20 will do.

---

## What you are inheriting

- **The coverage model has been wrong three times** and is the part of this
  spec most worth attacking next. It now derives from the engine's own
  constants (`coverage-guard.test.ts`) rather than restating them, but _which_
  constants matter was one person's reading of `adapt-day.ts` and `slots.ts`.
- **Everything the v0.124.0 and visual-polish handoffs listed is still
  inherited**, including information architecture as Phase 6's last open
  strand.
- **The whole strand touched exactly these areas**, and no engine behaviour
  changed: `src/lib/interval/`, `src/lib/week-plan/export-workout.ts`,
  `src/app/api/workout/zwo/`, `src/app/train/`, `src/components/train/`,
  `scripts/`, `.github/workflows/`, and the release files. A day the library
  cannot answer renders exactly as it did before the feature existed —
  asserted three ways, including with the prop absent entirely.

## How to verify anything here

```bash
set -a; . ./.env; set +a
DATABASE_URL="$DATABASE_URL" DATABASE_DRIVER=pg npx vitest run
npx tsc --noEmit          # the suite will not tell you this

# The library, end to end: every workout through every renderer.
# See docs/plans/2026-08-31-cycling-workouts-slice2-library.md, Task 4.
```

To see the workout surface without CI, seed a cycling owner against a throwaway
Postgres and read `scripts/seed-cycling-owner.ts`'s self-check output — it
refuses unless a session actually yields a structured workout, and prints the
week's shape when it does not.
