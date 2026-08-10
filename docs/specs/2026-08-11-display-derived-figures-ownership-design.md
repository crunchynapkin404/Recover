# Display-derived figures — ownership design (v0.89.0)

Phase 2c's second-to-last number slice: **sleep debt, body battery,
correlations, bio-age.** Surveyed 2026-08-10, re-verified against the code on
2026-08-11 before planning.

## What is actually wrong

Two of the four figures are fine. The roadmap's survey said so and the
re-verification agrees, recorded here so they are not swept a third time:

- **Body battery** — `src/lib/body-battery.ts` is imported by exactly one
  consumer, `app/body/page.tsx:46`.
- **Correlations** — `correlationFigure()` is called only by
  `components/body/correlation-rows.tsx:42`; `correlateTags()` has one
  internal caller. One producer.

The other two are duplicated assemblies. **Neither currently diverges** —
this is a drift guard, not a bug fix, and the release notes must say so
rather than implying athletes were shown wrong numbers.

### 1. Sleep debt — the same 8 lines on two pages

`computeSleepDebt()` is called from `app/page.tsx:319` and
`app/body/page.tsx:492`. The two call sites are character-identical apart
from variable names (`bodyPrefsRow`/`prefs`, `sleepDebt`/`debt`): the same
14-day filter, the same `bedStart` → minutes-of-day mapping, the same
`sleepNeedSecs ?? DEFAULT_SLEEP_NEED_SECS` fallback, the same `wakeTime`.

`body/page.tsx:487` carries this comment:

> the same computation the sleep vital's debt delta uses on Today, so the two
> can't disagree.

They can't disagree **today**, and nothing makes that true tomorrow. The
claim is asserted in a comment rather than established by construction —
which is the precise failure mode 2c exists to remove, and the same one
v0.87.0 found in the race-card assembly written out twice.

**The window is enforced in two places, by two different rules.**
`computeSleepDebt()` already truncates internally with
`input.nights.slice(-DEBT_WINDOW_DAYS)` — the last 14 **elements**. The call
sites additionally filter `w.date >= daysAgo(14)` — the last 14 **days**.
Those are the same thing only when wellness rows are dense. With gaps —
a provider outage, a new athlete, anyone who does not sync daily —
`slice(-14)` reaches back as far as it needs to find 14 rows, which can span
months. The date filter at the call site is what makes the figure a genuine
14-day debt.

So the two filters are not redundant, and a caller who reasonably assumed the
owner owned its own window would get a quietly wrong number. The new owner
must do the **date** filtering itself; the existing `slice()` stays as a
safety net rather than the definition.

### 2. Bio-age — the same ~20 lines on a page and an MCP tool

`biologicalAge()` is called from `app/body/page.tsx:837` and
`lib/tools/get-biomarkers.ts:93`. Both independently build the identical
input: the same `birthYear` → age arithmetic, the same
`[...wellness].reverse().find(...)` searches for `latestWellness`, `vo2max`
and `bodyFatPct`, and the same 30-day `nights` mapping feeding
`sleepConsistency()`.

Both were checked for the divergence that would make this a live bug — a
different query window — and **both fetch 90 days and filter nights to 30**.
They agree. This is the UI-vs-MCP shape v0.86 removed from five surfaces,
caught before it produced a discrepancy rather than after.

## The fix

One pure owner per figure, taking rows the caller has already fetched. Pure
rather than DB-reading, for two reasons: both current call sites already hold
the wellness rows and a second query would be a real regression, and v0.87.0
established that separating the pure mapping from DB assembly is worth doing
on its own merits.

```ts
// src/lib/sleep-debt.ts
export function sleepDebtFrom(
  wellness: Array<{
    date: string;
    sleepSecs: number | null;
    bedStart: Date | null;
  }>,
  prefs: { sleepNeedSecs: number | null; wakeTime: string | null } | null,
  today: string
): SleepDebtResult;

// src/lib/biological-age.ts
export function bioAgeFrom(
  wellness: WellnessRow[],
  prefs: { birthYear: number | null } | null,
  today: string
): BioAgeResult | { insufficient: true; missing: string[] };
```

The date window is derived inside the owner, not passed in — the window
(14 days for debt, 30 for nights, "latest non-null" for the point values) is
part of the figure's definition, and leaving it at the call site is exactly
what allows two surfaces to drift.

`today` is a parameter rather than `new Date()` so the owners stay pure and
testable, matching `raceCard(userId, now)` from v0.87.0.

**Not changed:** the `Figure<BioAgeResult>` wrapping at `body/page.tsx:854`
stays at the page. The MCP tool has its own `{ status: "insufficient" }`
shape, and collapsing those two presentations into the owner would be a
surface change, which Phase 2's non-goals rule out. The owner returns the
raw result; each surface presents it as it already does.

## Conditions

| #   | How it is met                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `sleepDebtFrom()` and `bioAgeFrom()`, inputs named in the signature.                                                                                                                                |
| 2   | Both duplicated assemblies deleted; three call sites migrated (two pages, one MCP tool).                                                                                                            |
| 3   | N/A — neither figure is persisted.                                                                                                                                                                  |
| 4   | Asserted at the surface: `get_biomarkers` via its own test; the pages via the owners' tests plus the existing component tests. The page-wiring gap is the same one v0.88.0 left open and 2d closes. |
| 5   | Already explicit — `Figure.missingInput` on the page, `{ status: "insufficient", missing }` on the tool. Both preserved.                                                                            |
| 6   | Mutation-checked: change each owner's window (14 → 7, 30 → 60) and confirm a test fails at both the owner and the surface.                                                                          |

## Gate

`npm test`, `npm run lint`, `npm run typecheck`, `npm run build`,
`npm run format:check` — with `set -a; . ./.env; set +a` exported, so the
DB-gated suites actually run.
