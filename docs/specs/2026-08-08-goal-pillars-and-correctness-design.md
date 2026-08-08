# Goal, pillars, and correctness — design

Design spec, 2026-08-08. Written after the v0.55–v0.64 audit, at baseline
`v0.65.0` (`docs/BASELINE.md`). Supersedes the forward half of
`docs/specs/2026-08-05-ai-coaching-landscape.md` §9; its findings and sources
stand.

## Premise

Recover shipped 14 releases in five hours on 2026-08-07. The audit that
followed found a release named "bounded adaptive week autopilot" that removed
the bound it claimed to respect, five releases built on a control that never
reached the week it edited, two features wired to nothing, and two tags cut
from a commit whose test suite had already failed.

The tempting diagnosis is speed. The real one is visible in the sequence:

| `ai-coaching-landscape.md` §9 planned | Actually shipped               |
| ------------------------------------- | ------------------------------ |
| v0.49 Fuelling lite                   | fuelling-lite ✓                |
| v0.50 Workout export v1               | workout-export-v1 ✓            |
| v0.51 Plan styles and blocks          | plan-styles-and-blocks ✓       |
| v0.52 Off-season mode                 | off-season-mode ✓              |
| **v0.53 Multi-A-race seasons**        | planning-surface-parity-lock ✗ |
| **v0.54 Race pacing**                 | plan-style-quick-switch ✗      |

The roadmap tracked its evidence exactly through v0.52. It diverged at v0.53
into UI quick-switches, and quality collapsed from that point: v0.56–v0.60
built, hardened and advertised an action that could not affect the athlete's
week; v0.61 removed a safety clamp; v0.63/v0.64 published from a red build.

The two skipped items — multi-A-race seasons and race pacing — are the ones
external demand ranks highest. **The failure was not working too fast. It was
working without a source.** Everything below exists to make that structurally
hard to repeat.

## The goal

> **Recover is a self-hosted endurance training companion that plans around the
> time an athlete actually has, and never shows a number it cannot defend.**
>
> Every figure traces to a source with a stated confidence. Baselines are the
> athlete's own, not population norms. When it does not know, it says so.

The second clause is chosen because it is testable. "Never shows a number it
cannot defend" can be written as a gate, and at `v0.65.0` that gate would fail:
72 of 77 exported engine constants carry no source and no confidence.

Everything in this document is downstream of that sentence. A proposal that
does not serve it does not enter the roadmap.

## The three pillars

They answer different questions, and the divergence above is what happens when
they are conflated.

### 1. Science — what is _true_

Peer-reviewed work decides whether a number is defensible. Established sources
already in use: Gabbett 2016 (BJSM), Impellizzeri et al. 2020 (IJSPP), Bosquet
et al. 2007, Issurin 2010, Seiler 2010 (IJSPP), the 2025 ACWR systematic
review, Minetti et al. 2002 for walking/running energy cost, plus TrainingPeaks
and Couzens on CTL ramp rate.

The pattern to extend is already in the codebase: `src/lib/plan-constants.ts`
and `src/lib/race/demand-constants.ts` state a source and a confidence per
value, and `docs/specs/2026-08-06-periodize-evidence.md`,
`2026-07-28-training-volume-evidence.md` and `2026-08-07-race-demand-evidence.md`
carry the derivations. Coverage is the problem, not method.

Science constrains claims. It does not set priority.

### 2. The intervals.icu forum — what is _hard_

<https://forum.intervals.icu/c/ai-tools/> — roughly 30 threads as of
2026-08-08, up from the 19 cited three days earlier. It is a live record of
competing tools failing in public.

Engagement concentrates sharply: IntervalCoach 1,062 replies / 30.7k views,
Montis.icu 709 / 22.8k, LeCoach 574 / 14.2k, IcuSync 295 / 10.7k. Two threads
bear directly on surfaces Recover has already built — "MCP Server for
Connecting Claude" (176 replies, 22.2k views) and "Your AI coach messages you
first" (108 replies).

The forum says where the bar is and which problems are already commodity. It
does not say what to build next.

### 3. JOIN's public board — what is _wanted_, ranked

<https://joincycling.featurebase.app/en/roadmap> — the only source of the three
that supplies a priority order from users who pay for a cycling training
product.

| Request                                        | Votes | Recover at v0.65.0                         |
| ---------------------------------------------- | ----: | ------------------------------------------ |
| Choosing a new goal before the last one's done |   244 | **Gap** — maps to the skipped multi-A-race |
| Availability beyond one week ahead             |   159 | **Leads** — defaults, overrides, preview   |
| Calendar                                       |   152 | Partial                                    |
| Strength training                              |   121 | Absent                                     |
| Different FTPs indoor/outdoor                  |   105 | Absent                                     |
| Multiple time blocks within a day              |     7 | **Leads** — availability blocks            |
| Vacation weeks scheduled in advance            |     5 | **Leads**                                  |
| Fuelling suggestion                            |     5 | Shipped (v0.49)                            |
| Race scheduling weeks ahead                    |     8 | Shipped                                    |
| Summary after a ride                           |     2 | Shipped                                    |

Two readings matter. The **#2 request confirms the availability bet**:
`ai-coaching-landscape.md` §7 already claims availability as Recover's lead,
and 159 votes on a competitor's board is independent evidence that the claim is
worth something. The **#1 request is a known gap** — and it is the feature the
sequence skipped at v0.53.

Vote counts rank work. They never license a number that science cannot back.

## Phases

Ordered by the constraint that a base must be trustworthy before it is
extended.

### Phase 1 — Goal and pillars, documented

This document, plus a rewritten `docs/ROADMAP.md` carrying the goal, the three
pillars, the demand map and the phase sequence. The 1,469-line roadmap is
archived rather than extended: 256 of its checkboxes are historical record, and
its forward half is the sequence that diverged.

Refreshes `ai-coaching-landscape.md` for the ~11 forum threads that appeared
since it was written.

**Ships no code.**

### Phase 2 — Prove the current features correct

The base. No new athlete-facing capability until it holds.

**2a. Provenance.** Every exported engine constant gets a source, a confidence,
and an explicit scope, following `plan-constants.ts`. 77 constants across 28
files; 72 currently have none. Where a constant cannot be sourced, it is
labelled invented — that is an acceptable answer and a far better one than
silence. Settles the correction `ai-coaching-landscape.md` §8 records as owed:
`HEADROOM = 1.3` and `RAMP_CLAMP_PCT = 0.2` are rated High on an ACWR anchor
the 2025 systematic review undermines.

**2b. One source of truth per number.** A _number slice_ is done when all six
hold:

1. One function owns computing it, inputs named in its signature.
2. One read path; no consumer recomputes it or reads a second store.
3. If persisted, the row is documented as cache or authority, and a test fails
   when the two disagree.
4. Every surface that displays it — page, coach context, MCP tool — reads
   through that path, asserted **at the surface**, not at the component.
5. Its "I do not know" state is explicit and rendered.
6. Mutation-checked: break the owner, confirm a test fails.

Order: week target load → volume and hours → adherence and completion →
CTL/ATL/TSB and readiness → event demand → display-derived figures. Week target
load is first because it caused four shipped bugs and because settling
ownership is what makes the hidden week quick actions decidable.

**2c. Guardrails.** A test that fails on any component with zero non-test
render sites — it would have caught the seven sleep-card files and the twelve
found after them. A source-of-truth guard pinning approved read sites so a new
one fails the build. Into `RELEASING.md`: mutation-check any test guarding a
bound, assert wiring at the surface, write release notes from the diff.

**Definition of done.** Not 100% line coverage — that is not achievable and not
the point. Every **athlete-facing number** has a source, a confidence, and a
test that fails when it drifts.

An athlete-facing number is any figure rendered in the UI, injected into coach
context, or returned by an MCP tool. If the athlete can read it or the coach
can quote it, it is in scope. Internal intermediates are excluded unless one of
those three surfaces exposes them. This matters because it bounds 2a: 77
constants is the ceiling, but the ones that reach a surface are the ones that
must be defensible first.

### Phase 3 — Close the highest-ranked gaps

Demand order, science-constrained. Multi-A-race seasons first (the 244-vote
request and the skipped v0.53), then race pacing (skipped v0.54), then the
remainder of the demand map by votes.

### Phase 4 — Breadth

Everything else, including the three kept-but-dormant features (Deep Biology,
outbound webhooks, coach long-term memory) and the parked
`feat/v0.65-mcp-contract-hardening` branch, which is unreviewed and must not
merge before Phase 2's guardrails exist.

## Non-goals

- **No feature removal.** All four zero/low-usage features were explicitly
  kept.
- **No new athlete-facing features during Phase 2.**
- **No visual redesign.**
- **v1.0 is not a milestone here.** It has been "nearly there" for months; the
  label is doing no work.
- **No autopilot revival** until it composes with the safety rails rather than
  switching them off.

## Risks

**Phase 2 is large and unglamorous.** 77 constants and ~2,000 tests whose
reliability the audit called into question. The honest estimate is weeks. The
mitigation is that 2b ships one number at a time, each independently
verifiable — progress stays visible.

**Provenance can become theatre.** A citation that does not constrain the value
is worse than none, because it manufactures confidence. Where a source only
loosely supports a number, the confidence rating must say so; "invented,
unvalidated" is a legitimate and useful label.

**The demand map is one competitor's board.** JOIN's users are cycling-app
users, not necessarily self-hosting endurance athletes. Vote counts rank
candidates; they do not prove Recover's athletes want the same thing.

## Open questions

Deliberately unresolved here, to be settled with real numbers when Phase 2's
first slice is specified:

1. Whether week target load is one slice or two — 43 `targetLoadTotal` and 36
   `effectiveTarget` read sites may be too much for a single reviewable change.
2. Whether the dormant-feature on-ramps in Phase 4 are worth building at all,
   or whether those three features should simply be documented as dormant.
