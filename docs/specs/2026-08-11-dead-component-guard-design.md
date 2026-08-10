# Dead-component guard — design (v0.91.0)

Phase 2d's first guardrail: _"a test failing on any component with zero
non-test render sites. Would have caught the 7 sleep-card files and the 12
found after them."_

## The scan

Run 2026-08-11 across all 122 non-test files under `src/components`.
**15 have no reference from any non-test source file** — not 19; that figure
predates v0.87.0's deletion of `RaceCountdownCard` and other removals since.

| Component                                          | Note                                                        |
| -------------------------------------------------- | ----------------------------------------------------------- |
| `dashboard/behavior-tags.tsx`                      |                                                             |
| `dashboard/coach-insight.tsx`                      | last touched 2026-07-15                                     |
| `dashboard/hero-readiness.tsx`                     | its own last commit removed the headline it rendered        |
| `dashboard/morning-brief.tsx`                      | last touched 2026-07-14                                     |
| `dashboard/recent-sessions-accordion.tsx`          |                                                             |
| `debrief/pending-debrief-card.tsx`                 | superseded by `today/debrief-chip.tsx`                      |
| `journal/correlation-insights.tsx`                 | already allowlisted in `uncertainty-dialects-guard.test.ts` |
| `log/wellness-trends.tsx`                          |                                                             |
| `plan/availability-sheet.tsx`                      |                                                             |
| `plan/today-card.tsx`                              | **maintained on 2026-07-27** in a refactor, while dead      |
| `scroll-reveal.tsx`                                |                                                             |
| `train/week-adjustment-switch.tsx`                 |                                                             |
| `ui/separator.tsx`, `ui/sonner.tsx`, `ui/tabs.tsx` | vendored primitives, see below                              |

**These are superseded predecessors, not lost features.** Spot-checked rather
than assumed: debriefs still render, through `DebriefChip` on Today and
`ActivityDebriefSection` on the activity page, so `pending-debrief-card.tsx`
is a leftover rather than a feature that silently stopped appearing. No
athlete is missing anything because of this list.

**The cost is real anyway, and `plan/today-card.tsx` is the proof.** It was
edited on 2026-07-27 by _"refactor(week-plan): a day carries blocks and a
list of workouts"_ — someone read it, reasoned about it, and updated it, for
a component that renders nowhere. That is the guard's actual argument: dead
components do not sit quietly, they get maintained.

## The design

A filesystem-walking guard test, following the shape
`tests/uncertainty-dialects-guard.test.ts` already established in this repo —
including its habit of documenting its own limitations rather than implying
completeness.

```
tests/dead-component-guard.test.ts
```

For every `.tsx` under `src/components` that is not a test, assert that at
least one other non-test `.ts`/`.tsx` file in `src/` references it — by `@/`
module specifier or by relative path ending in its basename.

### The allowlist is a ratchet

The guard ships with the 15 above in `KNOWN_ORPHANS`, because a guard that
fails on day one is a guard that gets deleted. Two rules make it a ratchet
rather than a dumping ground:

1. **A second test asserts the allowlist contains no entry that is now
   referenced.** Delete an orphan or give it a render site, and the guard
   fails until it is removed from the list. The list can only shrink.
2. **Nothing may be added to it** without a comment naming why. A new orphan
   is the exact defect this guard exists to catch.

### `src/components/ui/` is in scope, not exempt

`separator.tsx`, `sonner.tsx` and `tabs.tsx` are vendored primitives that a
future feature might reach for, which is the standard argument for exempting
the directory wholesale. That argument is declined: an unused primitive is
still code that is typechecked, linted, bundled-if-imported and read by
people. They go in the same allowlist, with the same shrink-only rule, and
the same expectation of eventual disposal.

### Deliberately NOT in this release

**Deleting the 15.** Disposal is Phase 2b.2's call, and 2b.2 cannot settle
before 2026-09-05 — it depends on the four-week `surface_views` telemetry
window that opened 2026-08-08. Some of these may be worth reviving rather
than deleting, and that is a product decision made with usage data, not a
cleanup decided by a guard test. The guard's job is to stop the list
growing; shrinking it is scheduled work with a date attached.

### Known limitation, stated rather than implied

Reference detection is a text match on module specifier and basename. It will
miss a component reached only through a dynamic import built at runtime, and
it can be fooled by a basename appearing in an unrelated string. Treat a pass
as evidence against the common case — a component whose last import was
deleted — not as proof of liveness. The same honest caveat
`uncertainty-dialects-guard.test.ts` carries.

## Conditions

Mutation-checked like any other bound: add a throwaway component with no
render site and confirm the guard fails; remove an entry from the allowlist
whose component is genuinely orphaned and confirm the guard fails; add an
allowlist entry for a component that _is_ referenced and confirm the
ratchet test fails.

## Gate

All five, with `set -a; . ./.env; set +a` exported so the DB suites run.
