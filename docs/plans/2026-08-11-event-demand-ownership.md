# v0.88.0 — Phase 2c: Event demand

Closes the **Event demand** number slice, and folds in the triathlon
confidence downgrade salvaged from `feat/v0.65-mcp-contract-hardening`
(`docs/specs/2026-08-10-v065-branch-disposition.md`, Salvage 2).

## What the survey found

Verified against the code on 2026-08-11, not assumed:

| Condition                    | Status before this release                                                                                                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. One owner                 | **Holds.** `eventDemand()` in `src/lib/race/demand.ts`, inputs fully named in `EventDemandInput`.                                                                                                                                 |
| 2. One read path             | **Holds.** Exactly one non-test call site: `week-plan/volume-inputs.ts:249`. `get_races` reads `assembleVolumeInputs()`; the Train page reads `assembleWeeklyTarget()`, which wraps the same call. Nobody recomputes.             |
| 3. Persisted row             | **N/A.** Demand is computed per request; no column caches it.                                                                                                                                                                     |
| 4. Asserted at the surface   | **Partial — this release's main work.** See below.                                                                                                                                                                                |
| 5. Explicit rendered unknown | **Holds.** `EventDemandResult` is a discriminated union with `DEMAND_UNAVAILABLE_COPY`; `uncertainty.ts` names it as the pattern `Figure<T>` copied. Rendered by `event-readiness.tsx:69-77` and mapped by `get-races.ts:95-100`. |
| 6. Mutation-checked          | **Does not hold.** No bound in this slice has been mutation-checked.                                                                                                                                                              |

### The condition-4 gap, precisely

The confidence rating an athlete reads is decided by
`priced.allAnchorsAthleteSet` — which is decided, in turn, by the
`athleteSet: true/false` flags that `volume-inputs.ts` assembles from
preferences, synced eFTP and history-derived paces (lines 239-270). That
mapping is what separates "Modelled from your FTP" (medium) from "Estimated
from your synced FTP" (low).

**`volume-inputs.test.ts` is 40 lines and tests only `longestSessionHoursOf`.**
Nothing asserts that mapping anywhere. The two tests that do reach it —
`get-races.test.ts:87` and `:99` — both seed athletes with _no_ set anchors,
so they cover `low` and `null` and leave the entire `athleteSet: true` branch
untested. An inverted flag there would silently relabel every athlete's
confidence and no test would notice.

That branch is also exactly what the new triathlon downgrade keys on, so it
cannot be folded in without covering it first.

## Tasks

Test-first throughout. Each task is dispatched to a fresh implementer, then a
task reviewer, per the repo's subagent-driven convention.

### Task 1 — the triathlon downgrade

Insert after the `confidence == null` block in `demand.ts` (after line 343):

```ts
if (input.sport === "Triathlon" && confidence === "medium") {
  confidence = "low";
  confidenceReason = `${confidenceReason} Multi-sport estimates are downgraded because swim, bike, and run anchors interact.`;
}
```

Reviewed rather than adopted blind — three things make it safe:

- It fires **only** on `medium`, so an athlete who stated a finish time keeps
  `high` (if they told us the time, anchor interaction is irrelevant), and an
  already-`low` triathlon is untouched. It narrows to one branch: a fully
  self-anchored triathlon.
- It **lowers** a claim. Phase 2's non-goals forbid making a figure claim more
  than 2a can source; reducing one is what 2a favours.
- It introduces no constant, so 2a needs nothing — this is a rule, not a
  number. The reasoning goes in a comment above it.

The salvaged test is adopted as written; the `BASE` fixture at
`demand.test.ts:449` was re-checked and is compatible (it supplies
`eventDays`, `elevationM`, `stages`, `massKg` and a null
`expectedFinishHours`; the test overrides sport, raceType, distance and all
three anchors), and it already uses the file's `if (!result.available) return;`
narrowing idiom.

Add alongside it the case the downgrade must **not** touch: a triathlon with a
stated `expectedFinishHours` stays `high`.

### Task 2 — mutation-check the bounds (condition 6)

Three mutations, each run against the full suite, each expected to fail:

1. Delete the downgrade block → Task 1's test fails.
2. Invert `priced.allAnchorsAthleteSet` → the medium/low bound fails.
3. Change `"Triathlon"` to `"Bike"` in the downgrade condition → a test fails.

If any mutation survives, the test is the defect, not the code. Record the
result in the release notes; a mutation check that was never run is worth
nothing.

### Task 3 — surface assertions (condition 4)

In `get-races.test.ts`, which already exercises the real path end-to-end
through Postgres and `assembleVolumeInputs`, add two seeded athletes:

- **A Bike athlete with `ftpWatts` set in preferences** → `demandConfidence`
  is `"medium"` and `demandNote` matches `/your FTP/i`. This is the branch
  nothing has ever covered, and it pins the `athleteSet: true` wiring in
  `volume-inputs.ts` at the surface.
- **A Triathlon athlete with FTP, threshold pace and a swim anchor all set**
  → `demandConfidence` is `"low"` and `demandNote` contains `"downgraded"`.
  This proves the downgrade survives the whole assembly and reaches the coach,
  not merely that the pure function does it.

Follow the file's existing convention: **one user per outcome**, seeded in
`beforeAll` and torn down in `afterAll`. The file already documents why —
seeding one user and asserting two outcomes from the same call cannot work.

### Task 4 — release mechanics

`package.json` to `0.88.0`, `CHANGELOG.md` entry, `docs/ROADMAP.md`: tick the
Event demand item with what was actually found, and fix the stale
"2c's four remaining slices" line in the sequencing section — three remain
after v0.87 closed the projection slice.

## Not in scope, with reasons

- **A Train-page render test.** The page has no test file and the repo has no
  page-level render harness; inventing one here is 2d's read-site guard
  arriving early and under-designed. The page and `get_races` read the same
  `assembleVolumeInputs()` result, so Task 3 covers the shared path, and
  `event-readiness.test.tsx` covers the rendering. The residual untested gap
  is the JSX prop passing at `train/page.tsx:826-831`. Stated rather than
  papered over.
- **`week-plan/project.ts`, `service.ts`, `volume-inputs.ts:328`** read
  `demand.weeklyHours` / `.queenStageHours` to _generate_ plans. They consume
  the owner's output; they are not surfaces showing the figure.
- **The 23 `icu_*` tools** — out of 2c's scope by the sweep's recorded
  reasoning; they pass a provider's number through and own none.

## Gate

All five, and this is the whole list: `npm test`, `npm run lint`,
`npm run typecheck`, `npm run build`, `npm run format:check`.
