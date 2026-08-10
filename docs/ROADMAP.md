# Roadmap

Current baseline: **v0.65.0** — see `docs/BASELINE.md` for the measured state.
Reasoning and evidence behind this roadmap:
`docs/specs/2026-08-08-goal-pillars-and-correctness-design.md`.

History through v0.65 is preserved in
`docs/archive/ROADMAP-through-v0.65.md` — 256 completed items. It is a record,
not a plan; nothing there is scheduled.

## The goal

> **Recover is a self-hosted endurance training companion that plans around the
> time an athlete actually has, and never shows a number it cannot defend.**
>
> Every figure traces to a source with a stated confidence. Baselines are the
> athlete's own, not population norms. When it does not know, it says so.

The second clause is deliberately testable. At v0.65.0 it does not hold: 72 of
77 exported engine constants carry no source and no confidence. Phase 2 exists
to make it true.

A proposal that does not serve that sentence does not belong on this roadmap.

## The three pillars

Every item here must name which pillar it answers to. They answer different
questions, and conflating them is what produced the v0.53–v0.64 drift.

| Pillar        | Question          | Source                                                                             |
| ------------- | ----------------- | ---------------------------------------------------------------------------------- |
| **Science**   | What is _true_?   | Peer-reviewed literature. Constrains what may be claimed.                          |
| **The forum** | What is _hard_?   | <https://forum.intervals.icu/c/ai-tools/> — ~30 competing tools failing in public. |
| **Demand**    | What is _wanted_? | <https://joincycling.featurebase.app/en/roadmap> — ranked votes from paying users. |

Science says what you may claim. The forum says where the bar is. Demand says
what to build next. **None substitutes for another** — a high vote count never
licenses a number science cannot back.

### Why this is written down

The roadmap tracked its evidence exactly through v0.52, then diverged:

| Planned (`2026-08-05-ai-coaching-landscape.md` §9) | Shipped                        |
| -------------------------------------------------- | ------------------------------ |
| v0.49–v0.52                                        | as planned ✓                   |
| **v0.53 Multi-A-race seasons**                     | planning-surface-parity-lock ✗ |
| **v0.54 Race pacing**                              | plan-style-quick-switch ✗      |

From v0.53 the work became UI quick-switches, and quality collapsed with it:
v0.56–v0.60 built and advertised a control that never reached the week it
edited, v0.61 removed a safety clamp it claimed to respect, v0.63/v0.64 were
published from a red build. Both skipped items are what demand ranks highest.

The failure was not speed. It was working without a source.

## Demand map

Recover's standing against ranked external demand. Updated when the board is
re-read; last read 2026-08-08.

| Request                                        | Votes | Recover at v0.65.0 |
| ---------------------------------------------- | ----: | ------------------ |
| Choosing a new goal before the last one's done |   244 | **Gap** → Phase 3  |
| Availability beyond one week ahead             |   159 | **Leads**          |
| Calendar                                       |   152 | Partial            |
| Strength training                              |   121 | Absent             |
| Different FTPs indoor/outdoor                  |   105 | Absent             |
| Race scheduling weeks ahead                    |     8 | Shipped            |
| Multiple time blocks within a day              |     7 | **Leads**          |
| Vacation weeks in advance                      |     5 | **Leads**          |
| Fuelling suggestion                            |     5 | Shipped (v0.49)    |
| Summary after a ride                           |     2 | Shipped            |

Recover leads on availability — the #2 request — and that is worth defending.
The #1 request is a known gap and the feature the sequence skipped.

## Phase 1 — Goal and pillars _(in progress)_

- [x] Audit v0.55–v0.64 and remediate (v0.65.0)
- [x] Baseline the project (`docs/BASELINE.md`)
- [x] Design spec for goal, pillars and correctness
- [x] This roadmap; archive the 1,469-line predecessor
- [x] Refresh `ai-coaching-landscape.md` — §10. Only **two** topics were
      created since 2026-08-05 (VeloForge, Lora, both 7 Aug); a category that
      added fifty products in nine months added two in three days. The refresh's
      real content is the MCP connector cluster the original's sixteen deep
      reads skipped, which bears directly on Recover's own 57-tool surface.

Ships no code. **Phase 1 complete.**

## Phase 2 — Prove the current features correct

The base. **No new athlete-facing capability until it holds.**

**Done means:** every athlete-facing number has a source, a confidence, and a
test that fails when it drifts. Not 100% line coverage — that is neither
achievable nor the point.

**Athlete-facing number**, precisely: any figure rendered in the UI, injected
into coach context, or returned by an MCP tool. If the athlete can read it or
the coach can quote it, it is in scope. Internal intermediates are not, unless
one of those three surfaces exposes them.

**Order matters here.** 2b lands before 2c's number slices, because slice
condition #5 — "its 'I do not know' state is explicit and rendered" — is a
design decision. Made six times independently, it produces six more dialects on
top of the six the app already speaks.

### 2a — Provenance

- [x] Source, confidence and scope for all 77 exported engine constants across
      28 files, following `src/lib/plan-constants.ts`
- [x] Label the unsourceable ones **invented** — an acceptable answer, and far
      better than silence
- [x] Settle the correction owed since 2026-08-05: `HEADROOM = 1.3` and
      `RAMP_CLAMP_PCT = 0.2` are rated High confidence on an ACWR anchor the
      2025 systematic review undermines. **v0.74.0** settled this in the code
      itself (not just prose docs) and shipped Phase 2a's first slice more
      broadly: `src/lib/athlete-level.ts`'s `LEVEL_CONSTANTS` (5) and
      `src/lib/week-plan/types.ts`'s 11 exported constants now carry source,
      confidence and scope, following `plan-constants.ts`. `HEADROOM` and
      `RAMP_CLAMP_PCT` now read Confidence: Low in-code; 10 of the 11
      week-plan constants had no research to cite and are labelled Invented,
      Low. **v0.75.0** shipped a second slice: `src/lib/training-load.ts`'s
      8 exported constants. `CTL_DAYS`/`ATL_DAYS` (42/7) are the
      industry-standard Coggan/Banister EMA time constants — Confidence:
      Medium. `LTHR_HRR_FRACTION` (0.85) is an uncited coaching convention
      per the origin design spec — Confidence: Low. The other 5 are
      engineering thresholds, labelled Invented, Low. **v0.76.0** shipped a
      third slice: 11 exported constants across `readiness.ts`,
      `sleep-debt.ts`, `sleep-insights.ts`, and `sleep-history.ts`. 10 of 11
      are design trade-offs or data-sufficiency gates with no cited
      research, labelled Invented, Low; `DEFAULT_SLEEP_NEED_SECS` (8h) is
      Medium (sits inside the commonly-cited 7-9h/night adult range, but an
      editable default, not a personalized claim). **v0.77.0** shipped a
      fourth slice: the race/taper domain — `src/lib/race/taper.ts` (7),
      `src/lib/race/forecast.ts` (2), `src/lib/race/feasibility.ts` (2, one
      of which — `LONGEST_RIDE_FRACTION` — already had extensive in-code and
      evidence-doc documentation and only needed the explicit Confidence
      sentence added). All 11 are Invented, Low. Also closed a gap the
      original survey missed: `src/lib/race/triathlon-legs.ts`'s
      `TRIATHLON_LEGS` (governing-body course distances) rated High —
      definitional. ~31 constants across ~18 other files remain — grouped by
      domain in
      `docs/plans/2026-08-09-provenance-athlete-level-week-plan.md`'s
      Findings. **v0.78.0** shipped a fifth slice: the sync/polling
      domain — `src/lib/sync/activity-poll.ts` (4),
      `src/lib/sync/wellness-refresh.ts` (5),
      `src/lib/sync/strava-webhook.ts` (1), and
      `src/lib/sync/intervals-backfill.ts` (1). All 11 are Invented, Low —
      operational judgement calls for polling a free, single-developer API,
      each traced to an existing design doc (`wellness-sync-interval-design.md`,
      `intervals-wellness-expansion-design.md`,
      `event-driven-sync-triggers-design.md`,
      `wellness-history-backfill-design.md`) for reasoning, not external
      research. ~20 constants across ~14 other files remain — the long tail
      in the same Findings doc. **v0.79.0** shipped a sixth slice, the
      first into the long tail: the health-metrics domain —
      `src/lib/biological-age.ts` (2), `src/lib/blood-pressure.ts` (1),
      `src/lib/body-battery.ts` (4), `src/lib/overtraining.ts` (1). All 8
      are Invented, Low. `body-battery.ts`'s `AWAKE_DRAIN_TOTAL` and
      `DRAIN_PER_LOAD` are explicitly called "first-pass calibrations" by
      their own design doc, headed for revisiting in a future
      correlation-engine pass. ~12 constants across ~10 other files
      remain. **v0.80.0** shipped a seventh slice, the second into the
      long tail: plan/prediction engine constants —
      `src/lib/insights/correlations.ts` (3),
      `src/lib/week-plan/anchors.ts` (`ANCHOR_CONSTANTS`, 3),
      `src/lib/week-plan/ctl-projection.ts` (1), `src/lib/training-plan.ts`
      (5). All 12 are Invented, Low. A precise re-survey (not carried
      forward as an approximation) puts the remaining backlog at ~10
      constants across ~10 files, closing out Phase 2a once shipped:
      `coach-memory.ts`, `recall.ts`, `debrief/lifecycle.ts`,
      `debrief/ride-review.ts`, `race/debrief.ts`, `weekly-review.ts`,
      `athlete-curves.ts`, `availability/types.ts`, `export/export-user.ts`,
      `components/plan/wheel-column.tsx`. **v0.81.0** shipped the eighth
      and final slice, closing Phase 2a entirely: `coach-memory.ts` (2),
      `recall.ts` (2), `debrief/lifecycle.ts` (2),
      `debrief/ride-review.ts` (1), `race/debrief.ts` (1),
      `weekly-review.ts` (1), `athlete-curves.ts` (1),
      `availability/types.ts` (2). All 12 are Invented, Low.
      `export/export-user.ts`'s `EXPORT_VERSION` and `wheel-column.tsx`'s
      `ITEM_HEIGHT` — both "to be confirmed" in v0.80.0's estimate —
      resolved to zero in-scope constants (a format-version identifier and
      a UI layout pixel value, neither a behavioral claim). Every exported
      engine constant surveyed since v0.74.0 now carries source,
      confidence and scope, or an explicit documented exclusion.

### 2b — Design language and IA

A brainstorm → spec → plan cycle in its own right, not direct implementation.
It exists because the goal's third sentence — "when it does not know, it says
so" — is currently spoken in six dialects: `—` (47 uses), `calibrating` (39),
`insufficient` (14), `unknown` (13), `limited evidence` (3), `inconclusive`
(3), `no data` (2), plus v0.62's ad-hoc `· limited data`.

- [x] **2b.1 — Document what exists (v0.67.0).** A descriptive `docs/design-system.md`:
      the 83 tokens in `src/app/globals.css`, the `src/components/ui/`
      primitive inventory, the Today/Train/Coach/Body/Menu IA, and the six
      dialects. This is the artifact v0.21 and v0.23 were each supposed to
      leave behind and neither did — `.superdesign/` is empty and the only
      design spec predates the v0.23 IA.

- [ ] **2b.2 — Settle the IA.** Decide what the IA now is, remove the 12
      orphaned components, and make the directory tree match. Six of the twelve
      sit in `dashboard/`, the rest in `plan/`, `log/`, `journal/` — all
      superseded by `today/`, `body/`, `train/`. With PR #86's seven
      sleep-cards that is 19 orphans from one unfinished migration.
      **Independently reconfirmed dead** while migrating other surfaces (not
      necessarily additional to the 19 — overlap unverified):
      `journal/correlation-insights.tsx`, `dashboard/hero-readiness.tsx`,
      `dashboard/readiness-rings.tsx`, `dashboard/race-countdown.tsx`
      (component body only — its `RaceCountdownProps` type stays live),
      `dashboard/recent-sessions-accordion.tsx`, `dashboard/vitals-grid.tsx`.
      **Trap:** `dashboard/race-countdown.tsx` still exports a
      `RaceCountdownProps` type that `app/train/page.tsx` imports; it cannot be
      deleted wholesale.
      **v0.66.0** shipped the local-only `surface_views` telemetry this
      decision depends on (owner-only, closed-set surface keys, counts only,
      never leaves the instance). **Deployed to the live instance:
      2026-08-08.** Four-week trigger: do not settle this item before
      **2026-09-05**. Per the spec, record at that point that the counts are
      developer-biased — the sole user is also the developer and tester, so
      the data shows what was being built, not what an athlete would open.
- [x] **2b.3 — Uncertainty and confidence language.** One vocabulary replacing
      six, distinguishing at least: _calibrating_ (not enough history yet),
      _insufficient_ (a required input is missing), _low confidence_ (wide
      interval), and _no figure plus the reason_ (the pattern v0.46 set for
      event demand). A token and a treatment for each. **2c consumes this.**
      **v0.67.0** shipped `src/lib/uncertainty.ts`, its rendering primitives,
      and migrated the first surface (90-day correlations). **v0.68.0**
      migrated the Today vitals grid. **v0.69.0** migrated the Train page's
      CTL/ATL/TSB fitness tiles and `DayActions` preview (4 call sites).
      **v0.70.0** migrated biological age and the Estimated Energy (body
      battery) card (`LabsTiles`, `BioAgeCard`, `BodyBatteryCurve`) and
      investigated `src/lib/race/forecast.ts`'s `insufficient` kind, finding
      it already fully resolved — nothing to migrate. **v0.71.0** migrated
      `PmcChart`'s thin-sample state (`src/components/log/pmc-chart.tsx`) —
      the only real remaining call site on the Log/Activity surface;
      `wellness-trends.tsx` was confirmed dead and `laps-table.tsx`'s
      per-cell em-dashes were investigated and found disproportionate to
      wrap (see `docs/plans/2026-08-09-uncertainty-vocabulary-log-activity.md`).
      **v0.72.0** migrated the coach's own "calibrating" text
      (`morning-insight.ts`'s deterministic template,
      `coach-context.ts`'s LLM data snapshot) — the first slice to touch
      the AI coach rather than a UI component, and the second and third
      instances of the calibrating-vs-same-day-gap conflation the v0.70.0
      final review first caught in `BodyBatteryCurve` (see
      `docs/plans/2026-08-09-uncertainty-vocabulary-coach-journal.md`).
      **v0.73.0** investigated the last surface, Admin/misc, and found no
      code change warranted — `security-events.tsx`, `artifact-card.tsx`,
      and `health-upload.tsx`'s dashes are all dense per-row/per-cell
      placeholders already honest or out of this vocabulary's scope, the
      same judgment call that excluded `milestones-card.tsx`,
      `checkin-sheet.tsx`, and `laps-table.tsx` in earlier slices (see
      `docs/plans/2026-08-09-uncertainty-vocabulary-admin-misc.md`). **Phase
      2b.3 is complete.** Full backlog and correction history:
      `docs/plans/2026-08-08-uncertainty-vocabulary.md` (original backlog),
      `docs/plans/2026-08-09-uncertainty-vocabulary-vitals.md` (5 more
      confirmed-dead components found; 3 sites investigated and excluded),
      `docs/plans/2026-08-09-uncertainty-vocabulary-train.md` (2 sites left
      to Phase 2c's first number slice: one reads
      `trainingBlocks.targetLoadTotal` directly, the other reads
      `weekPlans.effectiveTarget`, a per-week snapshot derived from it),
      `docs/plans/2026-08-09-uncertainty-vocabulary-body-health.md` (no dead
      components found),
      `docs/plans/2026-08-09-uncertainty-vocabulary-log-activity.md` (1 more
      confirmed-dead component; 2 sites investigated and excluded), and
      `docs/plans/2026-08-09-uncertainty-vocabulary-admin-misc.md` (no code
      change needed).
- [ ] **2b.4 — Visual redesign.** All 12 pages, against the settled IA using
      the settled vocabulary. The largest item on this roadmap: it splits into
      its own releases with per-page gates, and needs real-browser verification
      — the v0.23 redesign shipped three bugs that only a real browser caught.
- [ ] On every page touched: scan for and remove duplicated data — the same
      value shown twice. A standing finding from prior redesigns here.

### 2c — One source of truth per number

A **number slice** is done when all six hold:

1. One function owns computing it, inputs named in its signature.
2. One read path — no consumer recomputes it or reads a second store.
3. If persisted, the row is documented as cache or authority, and a test fails
   when the two disagree.
4. Every surface showing it — page, coach context, MCP tool — reads through
   that path, asserted **at the surface**, not at the component.
5. Its "I do not know" state is explicit and rendered.
6. Mutation-checked: break the owner, confirm a test fails.

- [x] Week target load — 3 producers, 43 + 36 + 8 read sites. Caused four
      shipped bugs before this closed it
      (`docs/specs/2026-08-10-week-target-load-ownership-design.md`).
      **v0.82.0** (slice 1): `weekTargetLoad()` in `week-plan/volume.ts`, the
      one read path outside adherence (`effectiveTarget` once materialized,
      else the block's `targetLoadTotal`), returning `Figure<number>`.
      `weekAdherencePct` shares its resolution via a private helper — zero
      behavior change. Both columns documented cache/authority in
      `schema.ts`. **v0.83.0** (slices 2-4, shipped together): migrated
      every remaining read site — `race/service.ts`, the `get_training_plan`
      and `get_plan_drift` MCP tools, the weekly review's adherence
      calculation, and the Train page's remaining-weeks table — fixing real
      cases where a materialized week's more accurate effective target was
      shadowed by its un-tapered skeleton value. Deliberately unchanged,
      each with documented reasoning: `race/debrief.ts`'s taper stat (a
      different, already-correct question), `get_plan_drift`'s past-week
      drift comparison (measures drift FROM the skeleton on purpose),
      `update-training-plan.ts`'s block-target write (the week quick
      actions' own mechanism), and the export/import round-trip (raw
      values, not a resolved derivative). Settling ownership makes the week
      quick actions re-enable decision answerable — still deferred, a
      product choice, not made here.
- [ ] Volume and hours
- [ ] Adherence and completion
- [ ] CTL / ATL / TSB and readiness — closes the standing dashboard honesty debt
- [ ] Event demand
- [ ] Display-derived figures (sleep debt, body battery, correlations, bio-age)

### 2d — Guardrails

- [ ] A test failing on any component with zero non-test render sites. Would
      have caught the 7 sleep-card files and the 12 found after them.
- [ ] A source-of-truth guard pinning approved read sites, so a new one fails
      the build
- [ ] Into `RELEASING.md`: mutation-check any test guarding a bound; assert
      wiring at the surface; write release notes from the diff
- [ ] Live-DB hygiene: two `*.invalid` test users in production, demo's
      never-closed July week

## Phase 3 — Close the highest-ranked gaps

Demand order, science-constrained.

- [ ] **Multi-A-race seasons** — the 244-vote request and the skipped v0.53.
      Two A-races in one season, bridge phase, separate taper windows.
- [ ] **Race pacing** — the skipped v0.54. Pacing bands with confidence and
      assumptions made visible.
- [ ] Remainder of the demand map, by votes

## Phase 4 — Breadth

- [ ] Review `feat/v0.65-mcp-contract-hardening` — unreviewed work (push quiet
      hours + migration 0040, two new MCP tools). **Must not merge before 2d.**
- [ ] MCP contract freeze — after the numbers underneath are stable, not before.
      Freeze a **measured** surface: competitors now sell on being "token
      cheap" (`ai-coaching-landscape.md` §10) and Recover has never measured
      what its 57 tools cost as context. Freezing an unmeasured surface locks
      in whatever that cost happens to be.
- [ ] Dead-component sweep (12 identified; `race-countdown.tsx` still exports a
      type `train/page.tsx` imports)
- [ ] On-ramps for the three dormant-but-kept features: Deep Biology, outbound
      webhooks, coach long-term memory — **or** document them as dormant
- [ ] Long-standing conditionals: Fitbit / Google Health direct, Cycle-Aware
      Readiness, the "Stronger Together" sharing lane

## Non-goals

- **No feature removal.** All four zero/low-usage features were explicitly kept.
- **No new athlete-facing capability during Phase 2 — presentation may change,
  claims may not.** 2b deliberately changes how the app looks and what it says
  when it doesn't know. What it must not do is add a new figure, or make an
  existing one claim more than 2a can source.
- **v1.0 is not a milestone.** It has been "nearly there" for months; the label
  is doing no work.
- **No autopilot revival** until it composes with the safety rails instead of
  switching them off.

## How a release earns its number

From `docs/RELEASING.md`, now enforced rather than assumed:

1. Name the pillar the work answers to.
2. Ship it test-first; mutation-check anything guarding a bound.
3. Version bump, changelog written **from the diff**, roadmap ticked — before
   merge.
4. Green `main`, then tag. `release.yml` refuses to publish otherwise.
