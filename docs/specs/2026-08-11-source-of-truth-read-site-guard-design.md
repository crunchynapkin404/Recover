# Source-of-truth read-site guard — design (v0.92.0)

Phase 2d's second guardrail: _"a source-of-truth guard pinning approved read
sites, so a new one fails the build."_

The guard is half the release. The other half is the three read sites the
survey for it found — because a guard cannot ship green over existing
violations, and pinning the wrong set would freeze a defect in place.

## What the survey found

v0.86.0 migrated **five** surfaces from reading `wellness_daily.ctl`/`.atl`
directly to reading the resolved `daily_metrics` figure: `get_fitness_summary`,
`get_training_load_summary`, `weekly-review.ts`, `coach-context.ts` and
`get_wellness`. All five are coach- or MCP-facing.

**It did not migrate any UI surface, and three read sites remain.** Checked
2026-08-11 against the code, not assumed:

| Site                                                           | What reads it                                   |
| -------------------------------------------------------------- | ----------------------------------------------- |
| `src/app/train/page.tsx:1359-1367`                             | the fitness trend — CTL, ATL, TSB, 28-day delta |
| `src/app/train/page.tsx:1466` → `components/log/pmc-chart.tsx` | the PMC chart, fed the same array               |
| `src/lib/week-plan/volume-inputs.ts:209-217`                   | `ctlBuckets`, which feeds `athleteLevel()`      |

`src/lib/morning-insight.ts:273` looks like a fourth and is **not** one — it
queries `schema.dailyMetrics` and the `.ctl` read is off that row. Recorded
so the next sweep does not re-flag it.

### Why this matters, stated precisely

`daily_metrics.ctl` is the resolved authority: per `metrics.ts:43-45`, the
provider's value wins when present and **Recover's native engine fills the
gaps** from activities. `wellness_daily.ctl` is provider-only — it arrives
from intervals.icu (`connectors/intervals.ts:183`).

So for an athlete with no intervals.icu connection, `wellness_daily.ctl` is
empty while `daily_metrics.ctl` holds a real, computed value. This is the
same "manual-only athlete gets nothing" defect class v0.10 fixed for the
dashboard and v0.86 fixed for five coach surfaces, surviving in the UI.

**It is a missing figure, not a wrong one — the distinction matters and the
release notes must keep it.** For the two Train surfaces the athlete sees
blanks. For `volume-inputs.ts`, `ctlBuckets` fills with zeros, and `peakOf()`
deliberately treats an all-zero window as `null` ("a peak of zero is not a
measurement"), so `athleteLevel()` returns `source: "calibrating"` rather
than a wrongly-low level. That is honest behaviour working as designed.

The cost is real anyway: such an athlete stays **permanently** calibrating,
and never gets a computed volume ceiling, while Recover has known their CTL
the whole time.

## The release

### Part 1 — migrate the three sites

Read `daily_metrics` for ctl/atl at all three. The Train page already queries
`dailyMetrics` at line 332 for `latestMetric`, so the file is not short of an
example — it simply grew a second, older path.

Expected visible change: an athlete with no provider connection gains a
fitness trend, a PMC chart and an athlete level they should always have had.
An athlete with intervals.icu connected sees **no change**, since the
provider's value wins in `daily_metrics` anyway.

This is a correctness fix, not new capability — the figures already exist and
are already claimed elsewhere in the app. Phase 2's non-goals are not
engaged.

### Part 2 — the guard

Following `tests/dead-component-guard.test.ts` (v0.91.0) and
`tests/uncertainty-dialects-guard.test.ts`: a filesystem walk, an allowlist
of approved readers, and a ratchet.

For each pinned column, name the files allowed to read it. Any other
non-test file referencing it fails the build, with a message naming the
authority to use instead.

Pinned to start:

- **`wellness_daily.ctl` / `.atl`** → authority is `daily_metrics`. Approved
  readers: `connectors/intervals.ts` (writes it), `metrics.ts` (resolves it),
  `export/export-user.ts` (round-trips raw rows), `db/schema.ts`.

Start with the one column pair that has a proven defect history rather than
guessing at a broad list — the same reasoning
`uncertainty-dialects-guard.test.ts` gives for listing two retired phrases
instead of all six. The list grows one migrated column at a time.

### The ratchet

As in v0.91.0: a second test asserting every approved reader still exists and
still reads the column, so a stale entry fails the build rather than silently
widening the permission.

## Conditions

Mutation-checked: add a `wellness_daily.ctl` read to a non-approved file and
confirm the guard fails; remove an approved reader that genuinely reads it
and confirm the ratchet fails; revert one migrated site and confirm the guard
catches it.

## Known limitation

A text match on column identifiers, with the same honesty as its siblings: it
catches the realistic reintroduction — a copy-pasted `w.ctl` — not one built
through indirection or aliasing. A pass is evidence against the common case,
not proof.

## Gate

All five, with `set -a; . ./.env; set +a` exported so the DB suites run.
