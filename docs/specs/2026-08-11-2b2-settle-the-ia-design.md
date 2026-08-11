# Phase 2b.2 — settle the IA — design

**Date:** 2026-08-11
**Status:** Design, approved
**Phase:** 2b.2, the last item blocking 2b.4 (visual redesign)
**Inputs:** `docs/specs/2026-08-11-2b2-inputs.md` — telemetry, IA as built, measured inventories

## Premise

`src/components/` describes an information architecture the app stopped having
in v0.23. Five directories — `dashboard/`, `plan/`, `log/`, `journal/`,
`health/` — are named for routes that no longer exist, and they hold **41
files: 14 dead and 27 live**.

The two problems are related but not the same set, and the numbers should not
be conflated. **22 components are dead in total**, and 8 of them sit _outside_
those five directories — in `debrief/`, `train/`, `ui/` and the component root.
So Release 1 deletes 22 across the whole tree; Release 2 relocates the 27 live
files that remain in the five retired directories, which then cease to exist.

The live 27 are the larger problem. Dead code is inert; **live code at the
wrong address is read, reasoned about and maintained**. `plan/today-card.tsx`
is the proof — it was edited on 2026-07-27 by a week-plan refactor while
rendering nowhere at all.

2b.4 redesigns all 12 pages against this tree. Doing that before the tree
tells the truth means every page's redesign inherits the wrong map.

## Scope

**Cleanup only. No athlete-visible change.** The nav stays five items, the
routes stay twelve, the tabs stay as they are. Whether that IA is _right_ is
2b.4's question, and answering it here would mean redesigning against an IA
that had itself just changed.

The telemetry supports leaving it alone: today (69 views), train (53) and body
(31) were each used on all four days of the window. The shape works; the
filing doesn't.

### Non-goals

- **No nav, route or tab changes.** Explicitly including `activity` and
  `activity-log`, which recorded zero views across four days containing four
  activities. That is real signal, and it is 2b.4's to act on.
- **`/wellness` stays.** It is a seven-line redirect stub kept for old
  bookmarks. Retiring it would 404 a real URL — athlete-visible, therefore out
  of scope.
- **No visual change, no copy change, no new figures.** Phase 2's standing
  non-goal applies unchanged.
- **No revival of deleted components into the redesign.** If 2b.4 wants a
  tabs primitive or an animated counter, it writes one against the settled
  design system rather than inheriting one built for the pre-v0.23 IA.

## Decisions

| Question                        | Decision                            | Why                                                                                            |
| ------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| Scope                           | Cleanup, not re-examination         | Fastest route to 2b.4, where the UX gains actually are; telemetry says the shipped shape works |
| Target tree                     | Mirror the IA                       | Half the tree is already in this shape; a reader on `/body` knows where its components are     |
| The 22 dead                     | Delete all                          | Every one has a named live successor; git recovers any of them in seconds                      |
| The 3 vendored `ui/` primitives | Delete                              | Re-vendoring is a one-line add, and deleting them empties the guard's allowlist entirely       |
| The 5 shared                    | A named `week/` directory           | Filing genuinely shared units under one consuming page would make the tree lie                 |
| Execution                       | Two releases: delete, then relocate | Different failure modes; a mixed diff can attribute neither                                    |

## Release 1 (v0.98.0) — delete the 22

Pure subtraction. Nothing moves, nothing is renamed, so any breakage has
exactly one possible cause.

| Deleted                                                                                               | Live successor                                                                       |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `dashboard/hero-readiness`, `dashboard/readiness-rings`, `dashboard/animated-counter`, `ui/hero-card` | `today/today-hero`                                                                   |
| `dashboard/vitals-grid`                                                                               | `today/vitals-grid`                                                                  |
| `dashboard/coach-insight`, `dashboard/morning-brief`                                                  | `today/coach-brief`                                                                  |
| `dashboard/recent-sessions-accordion`, `dashboard/weekly-summary`                                     | `today/week-row`                                                                     |
| `dashboard/behavior-tags`                                                                             | tags render via `journal-form` and `/body`                                           |
| `debrief/pending-debrief-card`, `debrief/debrief-form`                                                | `today/debrief-chip`, `debrief/activity-debrief-section`                             |
| `plan/availability-sheet`, `plan/wheel-column`                                                        | v0.26's `availability-week-switcher`, `standard-week`, `intake-form`                 |
| `plan/today-card`                                                                                     | `today/session-card`                                                                 |
| `journal/correlation-insights`                                                                        | `body/correlation-rows`                                                              |
| `log/wellness-trends` (244 LOC)                                                                       | `/body` Trends tab                                                                   |
| `train/week-adjustment-switch`                                                                        | v0.59/v0.60 residue; live adjustments render via `session-card` and `week-rationale` |
| `scroll-reveal`                                                                                       | unused animation helper, no successor needed                                         |
| `ui/separator`, `ui/sonner`, `ui/tabs`                                                                | never wired up; re-vendor on demand                                                  |

**Four dead chains must come out together**, or the guard correctly reports the
remainder as newly orphaned:

1. `hero-readiness` → `readiness-rings` → `animated-counter`, plus `ui/hero-card`
2. `recent-sessions-accordion` → `weekly-summary`
3. `pending-debrief-card` → `debrief-form`
4. `availability-sheet` → `wheel-column`

Also in this release: each deleted component's own test file goes with it;
`journal/correlation-insights` is removed from the allowlist in
`tests/uncertainty-dialects-guard.test.ts` as well as the dead-component
guard's; and `KNOWN_ORPHANS` becomes empty.

**What that buys.** The dead-component guard stops carrying 22 standing
exceptions and becomes zero-tolerance. A new orphan then fails the build with
no precedent to point at.

## Release 2 (v0.99.0) — relocate the 27

**The rule:** a component reached by exactly one surface lives in that
surface's directory; a component reached by two or more lives in a directory
named for its domain.

Ownership was computed by transitive reachability from each `page.tsx`, not by
filename. 22 have exactly one owner, 5 have two.

| To            | From         | Files                                                                                                                |
| ------------- | ------------ | -------------------------------------------------------------------------------------------------------------------- |
| `today/`      | `dashboard/` | `calibration-progress`, `pull-to-refresh`, `sync-chip`                                                               |
| `body/`       | `dashboard/` | `body-battery`, `milestones-card`                                                                                    |
| `body/`       | `journal/`   | `journal-form`                                                                                                       |
| `body/`       | `health/`    | `bio-age-card`, `biomarker-list`, `blood-pressure-card`, `health-manual-entry`, `health-upload`                      |
| `train/`      | `log/`       | `fitness-stats-row`, `pmc-chart`, `range-tabs`, `view-tabs`, `weekly-load-bars`                                      |
| `train/`      | `plan/`      | `availability-week-switcher`, `event-readiness`, `plan-empty`, `plan-preview-card`, `races-section`, `standard-week` |
| `week/` (new) | `plan/`      | `block-sheet`, `day-actions`, `intake-form`, `week-rationale`, `week-strip`                                          |

3 + 8 + 11 + 5 = **27**. `dashboard/`, `plan/`, `log/`, `journal/` and
`health/` cease to exist.

`week/` earns its name: all five are week-plan UI reached from both `/` and
`/train`, and both surfaces render a week. `block-sheet` qualifies
transitively — `intake-form` imports it, and `intake-form` is shared.

**Every move is `git mv`,** so history follows the file. This makes the review
question sharp: **any content change in the relocation diff is a defect.** The
only permitted edits are import specifiers at call sites, which the compiler
enumerates.

## The structural guard

`tests/ia-directory-guard.test.ts`: fails if any of `dashboard/`, `plan/`,
`log/`, `journal/`, `health/` exists under `src/components/`.

The tree drifted from the IA in v0.21 and again in v0.23, both times because
nothing prevented it. Documentation did not hold and will not. This converts a
third drift from a discovery two releases later into a red build on the commit
that causes it — the same mechanism as the dead-component guard, applied to
structure rather than liveness.

It must **throw when its own directory scan finds nothing to check**, or it
passes vacuously the day someone moves `src/components/`.

## Testing

1. **Dead-component guard** — already recomputes reachability every run. After
   Release 1 its allowlist is empty; after Release 2 it proves no move
   orphaned anything.
2. **Structural guard** — new, above. Mutation-check it by recreating one
   retired directory with a file in it and confirming a red build.
3. **`npm run typecheck`** — proves every import specifier resolves after the
   moves. This is the primary net for Release 2.
4. **`npm run build`** — the only check that catches a server/client boundary
   break, and several relocated components are client components.
5. **Full suite** on both releases. Relocated tests move with their subjects;
   a test that fails after a `git mv` means content changed, which the
   relocation forbids.

## Risks

- **A move can be correct and still be wrong.** Reachability establishes who
  imports a component, not who _should_ own it. The 22 single-surface
  placements are mechanical and safe. The five in `week/` are a judgement
  call; if 2b.4 disagrees, that is a directory rename, not an untangling.
- **A deletion can orphan a neighbour.** Mitigated by taking the four chains
  as units, and backstopped by the guard, which recomputes rather than trusts
  the list.
- **Import churn is wide.** Every call site of 27 components changes. The
  compiler enumerates them exhaustively, which is why `typecheck` is the gate
  rather than review.
- **A deleted component turns out to be wanted.** `git log --diff-filter=D`
  recovers any of them. Weighed against 22 files that are read, linted,
  typechecked and maintained by people who cannot tell they are dead.

## What this unblocks

2b.4 — visual redesign, all 12 pages, the largest item on the roadmap. It
gains a tree where a page's components are findable, no dead code to redesign
by accident, and two guards ensuring neither problem returns while it works.
