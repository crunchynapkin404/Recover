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

- [x] **Inline numeric literals — the gap 2a's own framing left open.** 2a
      swept _exported constants_, and closed on that basis. It never reached
      numbers written inline, which can carry exactly the same claims. Found
      2026-08-10 while sourcing the race-day form projection:
      `clamp(50 + 2.5 · tsb, 10, 90)` is written out in both
      `readiness.ts` (line 167) and `race/forecast.ts` (line 65), and the
      `>= 67` / `>= 34` band thresholds in both — so the numbers deciding
      whether an athlete sees green, amber or red carried no source and no
      confidence while all 77 exported constants did. v0.87 gives the form
      score one owner as part of its slice; this item is the sweep for the
      rest. **2a's completeness claim above is true as written and narrower
      than it reads** — that is the point of recording this rather than
      quietly widening it.
      **Closed by v0.94.0.** The named example was already fixed — v0.87.0
      gave `formScore()` one owner, named `FORM_BAND_THRESHOLDS` and sourced
      both — and `blood-pressure.ts` already cites the 2017 ACC/AHA guideline;
      both recorded so they are not swept again. The sweep for the rest found
      two clusters with no provenance at all. **`src/lib/fuelling/`** had zero
      `Source:` anywhere: ~20 nutrition figures rendered on Train and handed
      to the coach via `get_week_plan`, in a directory with no exported
      constants, which is exactly why 2a missed it. Most proved genuinely
      sourceable when checked against the literature rather than asserted —
      during-session carbohydrate sits on Jeukendrup's per-duration guidance
      and the 90 g/h clamp is the published ceiling; fluid volumes are the
      weak ones, Invented/Low, because requirement is sweat-rate driven and
      Recover does not measure sweat rate. **`training-plan.ts`'s
      session-distribution model** was the sharper find: the ratios deciding
      how long the long run is and how a triathlete's hours divide, inline,
      beside exported constants in the same file each carrying a full
      `Source:` block. **Two findings reported rather than fixed**, since
      changing a training prescription needs its own release: the triathlon
      split (20/40/40) matches no published distribution — they put bike at
      40-50% and run at 20-30%, so Recover's running share is roughly double
      the cited figure — and `RUN_LONG_FRACTION` is **not the binding bound**
      for most athletes, because a previously undocumented `Math.min` caps
      the long run at 180 minutes, binding above 9.375 h/week, so for a
      higher-volume runner the documented fraction has no effect at all.
      **Mutation-checking earned the release three times**: nothing pinned
      any of these (inverting the triathlon split entirely passed the whole
      suite), the fuelling tests asserted floors rather than values (raising
      the long-session carb recommendation from 60 to 75 g/h passed), and the
      first fix's own tests could not fail because they asserted against the
      constants under test. Design:
      `docs/specs/2026-08-11-inline-numeric-literals-design.md`.

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
      `dashboard/readiness-rings.tsx`,
      `dashboard/recent-sessions-accordion.tsx`, `dashboard/vitals-grid.tsx`.
      `dashboard/race-countdown.tsx` was on this list, and the **trap** that
      kept it here — it exported the `RaceCountdownProps` type
      `app/train/page.tsx` imported, so it could not be deleted wholesale —
      is gone: **v0.87.0** moved that type to `race/outlook.ts` as `RaceCard`
      and deleted the component with its test. One down without waiting for
      this item, because the slice that owned the type had to touch it
      anyway.
      **v0.66.0** shipped the local-only `surface_views` telemetry this
      decision depends on (owner-only, closed-set surface keys, counts only,
      never leaves the instance). **Deployed to the live instance:
      2026-08-08.** The original four-week trigger — do not settle before
      **2026-09-05** — was **lifted on 2026-08-11 (v0.95.0)** by the owner's
      call, on the reading below. The telemetry itself is unchanged; what
      changed is the judgement that four more weeks of it would not move the
      decision. See "Sequencing" below for the full argument.
      **Final reading, 2026-08-11 (day 4 of a planned 28).** 177 views:
      today 69, train 53, body 31, coach 13, settings 8, admin 3 — every
      surface seen on all four days except settings (3) and admin (2). Three
      instrumented surfaces recorded **zero**: `activity`, `activity-log`,
      `import`. The ranking is stable day over day; today/train/body are the
      top three on every one of the four days.
      **The zeros for `activity` and `activity-log` are tested, not merely
      absent.** Four activities landed inside the window (two on 2026-08-08,
      two on 2026-08-09). The athlete trained and still never opened either
      surface, so the zero is behaviour rather than an artefact of a quiet
      week. **`import`'s zero is not evidence of anything** and must not be
      read as such: it is a once-ever surface — connect a provider and never
      return — so it would read zero at 28 days too. 2b.2 may not conclude
      "import is unused" from this.
      **Instrumentation audited 2026-08-11 and it is complete**: every
      authenticated page calls `recordSurfaceView`. The only three that do not
      are `login` and `join/[code]`, both pre-auth with no user to attribute,
      and `src/app/wellness/page.tsx`, which is a seven-line redirect stub to
      `/body?tab=journal` kept for old bookmarks — no auth lookup, renders
      nothing, and the destination it forwards to already records. It was
      briefly mistaken for an uninstrumented real page by matching the page
      list against the instrumentation list without opening the file; noted
      because the same list-matching would produce the same false gap again.
      **n=1 is a census, not a sample.** The owner has confirmed they are the
      only user of this instance, so the developer-bias caveat stands — the
      sole user is also the developer and tester, so the data shows what was
      being built, not what an athlete would open — but the _sample-size_
      worry does not: one user is 100% of the population. The decision this
      item makes is "which surfaces does the only athlete actually use", and
      the data answers exactly that. It will not support a general claim about
      athletes, and must not be written as one.
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

**The slice list below is enumerated, not guessed.** It originally held six
entries chosen by intuition, which is how v0.86's first commit came to fix 2 of
5 affected surfaces — nobody had listed them. The list was swept against 2c's
own definition on **2026-08-10**, walking all 57 registry tools plus the UI and
coach-context surfaces. What that sweep changed, and the reasoning for what it
excluded, is recorded here so that closing 2c means something:

- **Out of scope, with reason:** the 23 `icu_*` tools return intervals.icu's
  own data, not a Recover-computed figure. They pass a provider's number
  through; they do not own one.
- **Checked and already sound — recorded so they are not re-swept:**
  per-activity load (`activityLoad` → `dailyLoadSeries` →
  `resolveEffectiveLoad`, a single path), plan drift (migrated to
  `weekTargetLoad()` in v0.83), and threshold pace
  (`thresholdPaceFromHistory` layers on `thresholdPaceFromPerformance` — one
  producer, not two).
- **Two slices were missing** and are now listed below.

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
- [x] Volume and hours — investigated broadly
      (`docs/specs/2026-08-10-volume-and-hours-ownership-design.md`): planned
      minutes and target hours were already single-owner (v0.38.0,
      `plannedMins()`/`assembleWeeklyTarget()`). **v0.84.0** fixed the one
      real duplication found: `page.tsx` and `train/page.tsx` both
      independently summed `days[].availableMins` into hours instead of
      sharing a function — the same drift risk `plannedMins` exists to
      prevent, recurring for availability. New `availableMins(days)` in
      `week-plan/fill.ts`, both call sites migrated.
      `constraints.hoursPerWeek`'s ~60 reads audited and left alone — a
      genuinely different question (plan configuration, not this week).
- [x] Adherence and completion — investigated broadly
      (`docs/specs/2026-08-10-adherence-and-completion-ownership-design.md`):
      `weekAdherencePct()`, `weekActuals()`/`deriveDayActuals()`/
      `bookWeekActuals()`, and the cache-only
      `trainingBlocks.actualLoad`/`actualSessions`/`adherencePct` columns
      were already single-owner, no duplication found. **v0.85.0** fixed
      a real bug found along the way: the season timeline's season-to-date
      adherence figure zero-filled a week's unknown target while still
      counting its real actual load, silently inflating the percentage —
      fixed to exclude such weeks from both sums (pairwise), not one side.
- [x] CTL / ATL / TSB and readiness — investigated broadly
      (`docs/specs/2026-08-10-ctl-atl-tsb-readiness-ownership-design.md`):
      readiness (`computeReadiness()`) was already single-owner. **v0.86.0**
      fixed two real issues in CTL/ATL/TSB: the EMA recurrence itself was
      duplicated three times (`training-load.ts`, `race/forecast.ts`,
      `morning-insight.ts`) — consolidated into one `advanceLoadEma()`.
      Five surfaces (`get_fitness_summary`, `get_training_load_summary`,
      `weekly-review.ts`, `coach-context.ts`, `get_wellness`) read
      `wellness_daily.ctl`/`.atl` directly instead of the resolved
      `daily_metrics` figure — the same "manual-only athlete gets
      nothing" defect class v0.10 fixed for the dashboard, recurring in
      coach- and MCP-facing surfaces. All five now read `daily_metrics`.
- [x] Event demand. Surveyed 2026-08-10, closed by **v0.88.0**. The survey was
      right that the ownership half was short — `eventDemand()` has exactly one
      call site (`week-plan/volume-inputs.ts`); `get_races`,
      `event-readiness.tsx` and `train/page.tsx` all consume its result rather
      than recompute; and its unavailable states were already a discriminated
      union with `DEMAND_UNAVAILABLE_COPY`, the pattern `uncertainty.ts` cites
      as its source. Conditions 1, 2 and 5 held before the release began.
      **What the slice found instead was an untested athlete-facing claim.** A
      triathlon's confidence is _structurally pinned at low_:
      `allAnchorsAthleteSet` requires `swimPace.athleteSet`, and there is no
      athlete-set swim pace in this codebase — no `body_prefs` column beside
      `ftpWatts` and `thresholdPaceSecPerKm`, no Settings control, and
      `volume-inputs.ts` only ever derives it from history. The sentence
      shipped alongside that pin told the athlete to _"set your thresholds in
      Settings for a sharper figure"_ — advice a triathlete who had set both of
      theirs had already followed, for a rating it could never lift. It is now
      fixed to name the swim as the always-derived anchor while keeping the
      nudge that genuinely does sharpen the bike and run legs. It had no test
      at all, which is how it stayed wrong; the corrected claim is pinned at
      both the function and the surface. **The salvaged downgrade is
      unreachable, and is kept as a latent guard rather than shipped as live
      behaviour.** It fires only on `medium`, which the pin makes impossible
      for the sport, so it never executes in production. The disposition doc
      (`docs/specs/2026-08-10-v065-branch-disposition.md`) said neither the
      code nor its test would be adopted without review — this is that review
      finding something, and the reason the caveat was worth writing. Kept
      rather than deleted because adding a swim anchor later would otherwise
      promote triathlon from low to medium as a silent side effect of an
      unrelated feature. Its tests exercise the pure function, which is honest
      for a rule on a pure function; nothing at any surface guards it, and
      nothing can until the pin is gone. **Condition 4** added two seeded
      athletes to `get-races.test.ts`, both running the real Postgres path: a
      Bike athlete with an athlete-set FTP reads `medium` — a branch **nothing
      had ever exercised**, since both pre-existing users have no set anchors —
      and a triathlete who has set everything settable still reads `low` with
      the swim named. **Condition 6:** six mutations, all killed. The `medium`
      gap was found _by_ mutation rather than by reading: retargeting the
      downgrade's sport to `"Bike"` killed one test where it should have killed
      two. **Left open, stated rather than papered over:** the Train page has
      no test file and the repo has no page-level render harness, so the JSX
      prop passing at `train/page.tsx:826-831` is unguarded. The page and
      `get_races` read the same `assembleVolumeInputs()` result, so the shared
      path is covered and `event-readiness.test.tsx` covers the rendering, but
      the wiring between them is not. That is 2d's read-site guard; building it
      here would have been that guard arriving early and under-designed.
- [x] Display-derived figures (sleep debt, body battery, correlations,
      bio-age). Surveyed 2026-08-10, re-verified 2026-08-11, closed by
      **v0.89.0**. The survey's claims all held: `computeSleepDebt` ran
      independently in `app/page.tsx` and `app/body/page.tsx`;
      `biologicalAge` ran independently in `app/body/page.tsx` and the
      `get_biomarkers` MCP tool, the same UI-vs-MCP shape v0.86 removed from
      five surfaces; body battery and correlations were already single-owner.
      Two fixes, not four. **Both duplications were checked for divergence
      and neither had produced one** — the release notes say so plainly
      rather than implying athletes had been shown wrong numbers. It is a
      drift guard. `sleepDebtFrom()` and `bioAgeFrom()` now own the two
      assemblies, both pure and taking a `today` string so they stay
      testable, matching `raceCard(userId, now)` from v0.87.0. Each surface
      keeps its own presentation — `Figure<BioAgeResult>` on the page,
      `{ status: "insufficient" }` on the tool — since collapsing those would
      be a surface change the non-goals forbid. **Two findings worth the
      slice on their own.** First, `computeSleepDebt()` truncates with
      `slice(-DEBT_WINDOW_DAYS)`, the last 14 _elements_, while both call
      sites filtered on _date_; with sparse wellness those are different
      sets, and fourteen rows can span months, so a caller who assumed the
      function owned its own window would get a quietly wrong figure. The
      date filter now lives in the owner. Second, a mutation **survived** —
      a fixture's custom sleep need happened to equal
      `DEFAULT_SLEEP_NEED_SECS`, making an owner that ignored the athlete's
      preference entirely invisible to the test. Fixed with a value chosen to
      produce a different outcome. Reading the test would never have shown
      that.
      Design: `docs/specs/2026-08-11-display-derived-figures-ownership-design.md`.
- [x] **Race-day form projection and feasibility.** Added by the 2026-08-10
      sweep; it was missing, and it was the largest remaining defect in 2c.
      **v0.87.0** closed it: `raceCard()` and `simulateRaceForm()` in
      `race/outlook.ts` own the two paths, the four encodings of the unknown
      state became one `Figure`, `feasibilityFor()` names which of three
      inputs is missing instead of returning a silent `null` for any of them,
      and `formScore()` in `readiness.ts` is the one owner of the TSB→score
      transform. `RaceCountdownCard` is deleted. The `capped` qualification
      is rendered again on every surface.
      **Correction, 2026-08-10 — this entry originally carried a false
      finding, and it is left here rather than quietly deleted because the
      way it was reached matters more than the claim.** It said the whole-
      branch review had found both new owners with zero _executing_ CI
      coverage, on the reasoning that their tests are DB-gated and "CI runs
      without a database". **CI has a Postgres service** (`ci.yml`, added
      2026-08-04 in `62c3ab2`, "ci: give the test job a database") and runs
      all 2163 tests with **zero skipped**. The owners were guarded the whole
      time. The reviewer had run the suite locally with `DATABASE_URL` unset
      and called that "the CI condition"; it is not, and nobody opened
      `ci.yml` to check. The generalisation drawn from it — that every slice
      behind a DB gate has the same hole — was false and is withdrawn.
      `race/outlook-figure.ts` (the pure `ForecastResult → Figure` mapping,
      extracted in response) is kept: separating the mapping from DB assembly
      stands on its own merits, but it fixed nothing. **The transferable
      lesson is about how the error survived review:** it was checked against
      a memory of the CI config written 2026-08-02, two days before the
      database was added, instead of against the file. A remembered fact
      about infrastructure has a shelf life; the file does not.
      The projection is a headline athlete-facing figure (race-day TSB and
      its green/amber/red band), and its unknown state is encoded **four**
      separate times: `app/page.tsx` and `app/train/page.tsx` each map
      `forecastForm()` into a `no_plan`/`insufficient`/`projection` outlook
      with near-identical duplicated code; `app/plan/actions.ts` flattens the
      same condition into an `insufficient` boolean plus nulled TSB fields;
      and the `simulate_plan_change` MCP tool writes its own prose for it
      ("CTL/ATL not calibrated yet"). That is condition 5 in four dialects —
      exactly what 2b.3 exists to prevent, in a figure 2b.3 never reached.
      Bigger than the mapping: the whole ~35-line race-card assembly —
      outlook, `race` object and `daysOut` arithmetic — is written out twice,
      character-identical apart from variable names. **Correction to this
      entry as first written:** it claimed the four paths could disagree
      because the pages pass four arguments to `assembleForecastInputs()`
      while the what-if paths pass two. They cannot. The fourth argument is
      `preloadedWeek` and both pages pass `getOpenWeekPlan(userId)`, exactly
      what the function fetches itself when it is omitted — a duplicate-query
      optimization, not a divergence. Duplication is the drift mechanism
      here, not argument mismatch. **Two more found while sourcing the
      confidence rating:** `forecastForm()`'s `capped` flag — the projection
      stopped at plan end rather than reaching the race — is rendered by no
      athlete-facing surface. The `RaceCountdownCard` this slice deletes did
      render it ("projection ends at plan end"); the `RaceChip` that
      superseded it drops it, so Today and Train show a race-day form figure
      that may not be a race-day figure at all. A lost qualification, not a
      missing one. And the form score `clamp(50 + 2.5 · tsb, 10, 90)` is
      written out in both `readiness.ts` and `forecast.ts` — see the inline
      literals item under 2a. Feasibility is the condition 1 half:
      `assessFeasibility()` is called from three sites (`training-plan.ts`
      twice, `train/page.tsx` once), each assembling its input object inline,
      and its `null` conflates two different reasons for silence. Design:
      `docs/specs/2026-08-10-race-form-projection-feasibility-ownership-design.md`.
- [x] **Athlete curves and best efforts** — `get_power_curve`,
      `get_pace_curve`, `get_best_efforts`. Added by the 2026-08-10 sweep for
      completeness; closed by **v0.90.0**, which **closes 2c**. The sweep's
      expectation of "verification-only" was nearly right: one owner
      (`athlete-curves.ts`), the cache documented in `schema.ts`, and
      `available`/`stale`/`fetched_at` already an explicit unknown state — so
      conditions 1, 2, 3 and 5 held, and `tests/athlete-curves.test.ts`
      already covered the owner's cache miss, fresh hit, TTL expiry and
      stale-on-error. **What was missing was condition 4: the three MCP tools
      that expose these figures had no tests at all**, so nothing asserted
      the shape the coach actually receives — the rounding, the passthrough
      of `stale`/`fetched_at`, or `get_best_efforts`' sport filter. The new
      `tests/curve-tools.test.ts` runs the real read path rather than mocking
      the owner: a seeded connection plus a fresh `athlete_curves` row makes
      `cachedFetch()` short-circuit before any fetch, so tool, owner and DB
      all execute with no network. Mocking `@/lib/athlete-curves` would have
      proved nothing about the read path, which is what condition 4 exists to
      test. **Condition 6 produced the release's one real finding.**
      Hardcoding `stale: false` in `get_power_curve` **survived** every
      fresh-cache assertion — `stale` is genuinely `false` on that path, so
      the assertion could not tell a wired flag from a constant. Seeding a
      row past the TTL fixes it: the real fetcher runs, fails under
      `no-network` (the production shape of intervals.icu being unreachable),
      and the owner serves the expired row with `stale: true`. The coach is
      told the number is hours old instead of being handed it as current.
      That mutation now fails. No UI surface reads these; the only other
      consumer is `strava-describer.ts`.

### 2d — Guardrails

- [x] A test failing on any component with zero non-test render sites. Would
      have caught the 7 sleep-card files and the 12 found after them.
      **v0.91.0** shipped `tests/dead-component-guard.test.ts`: one test
      failing on any unreferenced component, and a second — the ratchet —
      asserting every `KNOWN_ORPHANS` entry is still genuinely orphaned, so
      an allowlisted component that gains a render site or is deleted fails
      the build until its entry goes. The list can only shrink, which is what
      separates an allowlist from a dumping ground. It ships with **15**
      entries, scanned fresh rather than carried over; the 19 in earlier
      notes predates v0.87.0's deletion of `RaceCountdownCard` and other
      removals since. **They are superseded predecessors, not lost features**
      — spot-checked rather than assumed: debriefs still render via
      `today/debrief-chip.tsx` and `activity-debrief-section.tsx`, so
      `pending-debrief-card.tsx` is a leftover, not something that silently
      stopped appearing. No athlete is missing anything. The cost is real
      regardless, and `plan/today-card.tsx` is the proof: it was edited on
      2026-07-27 by _"refactor(week-plan): a day carries blocks and a list of
      workouts"_ — read, reasoned about and updated, for a component that
      renders nowhere. Dead components do not sit quietly; they get
      maintained. `src/components/ui/` is in scope rather than exempt.
      **Deleting the 15 is deliberately not part of it** — disposal is 2b.2's
      call, and some may be worth reviving rather than deleting. That call was
      date-gated to 2026-09-05 when this shipped; the gate was lifted on
      2026-08-11 (v0.95.0), so 2b.2 can now take the list whenever it runs.
      Design:
      `docs/specs/2026-08-11-dead-component-guard-design.md`.
- [x] A source-of-truth guard pinning approved read sites, so a new one fails
      the build. **v0.92.0** shipped `tests/read-site-guard.test.ts`, pinning
      who may read the provider-only `wellness_daily.ctl`/`.atl` when the
      authority is the resolved `daily_metrics`. Pinned to that one column
      pair on purpose — it has a proven defect history (v0.10 for the
      dashboard, v0.86.0 for five coach/MCP surfaces) and a guard that starts
      narrow and true beats one that starts broad and gets disabled; the same
      reasoning `uncertainty-dialects-guard.test.ts` gives for listing two
      retired phrases rather than six. **The guard's real value showed up
      before it shipped: it found a fourth violation the survey for it
      missed.** `week-plan/start-state.ts` restricted its query
      (`columns: { ctl: true, atl: true }`) rather than reading `.ctl`, so a
      grep for read sites could not see it — and it was the most
      consequential of the four. For an athlete with no intervals.icu
      connection that row is always null, so a plan's **starting CTL/ATL**
      fell through to `sport_rolling` or the hardcoded 30/40 global fallback,
      a guess standing in for a figure Recover had already computed. The
      other three sites only displayed a blank; this one fed plan generation.
      Detection is binding-aware rather than a substring match, because a
      bare `.ctl` scan flags the _correct_ `daily_metrics` code and a
      "queries wellnessDaily and mentions .ctl" heuristic flags
      `train/page.tsx` and `volume-inputs.ts`, which legitimately read both
      tables. Mutation-checked, and one mutation **survived** before the
      detector was fixed: `metrics.ts`'s `byDate.get(date)?.ctl` Map
      indirection was invisible to it, a shape reintroducible anywhere
      undetected. Design:
      `docs/specs/2026-08-11-source-of-truth-read-site-guard-design.md`.
- [x] Into `RELEASING.md`: mutation-check any test guarding a bound; assert
      wiring at the surface; write release notes from the diff. **v0.93.0**
      added all three as numbered steps, each carrying the evidence from
      v0.87–v0.92 rather than stated as principle. Mutation-checking caught
      something reading could not **three times** in six releases (v0.89.0's
      fixture equal to the default it had to beat; v0.90.0's hardcoded
      `stale: false`; v0.92.0's invisible `Map.get()?.ctl` hop), and the
      recurring cause is named: a fixture that cannot distinguish the two
      things the test exists to tell apart. The surface step records that a
      component test cannot prove what the page hands it, points at
      `tests/curve-tools.test.ts` as the pattern for running the real path,
      and requires an untestable surface to be **stated in the release
      notes** rather than implied covered. The release-notes step records
      that every release in that run had a headline its plan did not contain.
- [x] Live-DB hygiene: two `*.invalid` test users in production, demo's
      never-closed July week. **v0.93.0** investigated both read-only against
      the live database and shipped `scripts/live-db-hygiene.sh`, which
      **defaults to a dry run** and writes nothing without `--apply`. Both
      confirmed: `test-coach-inbox-user` and `test-coach-inbox-other-user`
      were created in production on 2026-07-27, carrying one chat thread and
      one message between them, and every FK to `users` involved
      (`accounts`, `sessions`, `chat_threads` → `chat_messages`) is
      `ON DELETE CASCADE`, so the removal is contained. The demo account's
      `2026-07-13` week is the only `open` week older than the current one —
      the owner's July weeks all closed on cadence — and the script's
      `UPDATE` is scoped by date so it can never close a current week for
      anyone. The release deliberately stopped there — writing to the live
      database is the owner's call, not a release step. **The owner ran it
      with `--apply` on 2026-08-11, and it is done.** `DELETE 2`, `UPDATE 1`,
      one transaction. Verified independently afterwards rather than taken
      from the script's own output: zero `*.invalid` users remain, three real
      users, **zero orphaned `chat_threads` or `chat_messages`** (the cascade
      worked), zero stale open weeks, and exactly one open week left — the
      owner's current one, which the date-scoping correctly did not touch.
      That scoping was the only part able to do real harm, and it behaved.
      **Two things this item surfaced that are not closed by it.** First, the
      instance reports `backupAgeS` as `null` — no successful backup has ever
      been recorded, so there was nothing to restore from had this gone
      wrong. Second, and the more useful of the two: the `*.invalid` rows
      were a **symptom**, not the defect. Something pointed a test run at
      production on 2026-07-27, and deleting the rows removed the evidence
      without removing the cause. This machine's `.env` points at 5435, so it
      was not a plain local `npm test`. Both belong to Phase 4's measurement
      and ops work rather than to 2d.

### Sequencing — the gate at 2026-09-05, lifted 2026-08-11

**The date gate is gone.** 2b.2 was held until **2026-09-05** so it would be
settled against four weeks of `surface_views` rather than against recall. The
owner lifted that gate on **2026-08-11 (v0.95.0)**, at day 4 of the planned
28, on the reading recorded under 2b.2 above. This section is kept rather
than deleted because the gate shaped three releases of sequencing and the
reasoning for ending it should be as legible as the reasoning for starting
it.

**Why four days settled what twenty-eight were budgeted for.** Three
arguments, none of which is "we got bored waiting":

1. **n=1 does not converge.** The instance has exactly one user, confirmed by
   the owner. More days add observations of the same person, not more people.
   The window was budgeted as if it were a sample; it is a census, and a
   census is complete on the day it is taken. The developer-bias caveat the
   spec demands is untouched by this — it would have been just as biased on
   2026-09-05.
2. **The zeros were tested against real behaviour.** `activity` and
   `activity-log` read zero across four days in which four activities were
   recorded. The athlete trained and did not open them. That is the exact
   distinction the window existed to establish, and it is established.
3. **The window already spans the weekly cadence.** 2026-08-08 was a
   Saturday, so the four days cover a weekend and a Sunday — the weekly
   review's own beat. No surface on the roadmap has a monthly-only cadence;
   the monthly report lands in the coach inbox, which is counted as `coach`.

**What the window would still have bought, stated so it is not lost:**
nothing for `import`, whose zero is structurally uninformative at any window
length (see 2b.2), and nothing about athletes in general, which this
telemetry was never able to support. If a second user ever joins this
instance, the census argument above expires and the counts become a sample of
one — reopen the question then rather than citing this reading.

**Order now:** **2a, 2c and 2d are all closed** — 2c at v0.90.0, 2d at
v0.93.2, and 2a's last item (inline numeric literals) at v0.94.0. Check that
against the checkbox list before repeating it; that is how it was wrong in
v0.93.0. What remains in Phase 2 is **2b.2, then 2b.4**, and neither is
date-blocked any longer — only 2b.4's dependency on 2b.2 remains, because it
still redesigns against an IA 2b.2 has to settle first. **2b.2 is the head of
the queue.** Per §2b it is a brainstorm → spec → plan cycle in its own right,
not direct implementation.

**A correction worth keeping, because it is the second time this line has
been wrong.** v0.93.0 first wrote here that "2a, 2c and 2d are all closed",
which was false: 2a's exported-constant sweep closed, but the inline-literals
item it deliberately left open is still open — the very item recorded above
precisely so this would not happen. The line before that read "four remaining
slices" for three releases after the count changed. **Keep this section
current as items close, and re-read the checkboxes before summarising them
rather than summarising from memory of the last release.**

**The four below are no longer "fill."** They were written as work to take
while the queue was empty and the date had not arrived. The queue is no
longer empty, so they stop being filler and go back to being ranked on their
own merits — item 1 in particular is a real defect and does not become less
real for having been listed as something to do while waiting. Sequencing them
against 2b.2 is the owner's call. All four are hardening, measurement or
hygiene, so none of them trips the Non-goal against new athlete-facing
capability during Phase 2:

1. **Finish `executeIcuTool()` across the icu\_ tool cluster.** The one piece
   worth keeping from `feat/v0.65-mcp-contract-hardening`, which applied it to
   a single tool. Measured on `main` 2026-08-10: **24** icu tools call
   `activeIcuConnection`, **23** hand-write the identical
   `"No active intervals.icu connection"` string, and **0** catch
   `ConnectorError`. So when intervals.icu is down, rate-limits, or the token
   goes stale, the error propagates as an unhandled throw out of every one of
   them. The duplicated guard is the easy half; the error path nobody wrote is
   the one that matters. This is the goal sentence's third clause — saying so
   when it does not know — on 23 surfaces 2b.3 never reached. Ranked first in
   this list because it is a real defect, where the other three are
   measurement. Detail and the helper itself:
   `docs/specs/2026-08-10-v065-branch-disposition.md`.
2. **Measure the MCP tool surface.** Phase 4 already requires this before any
   freeze — "freezing an unmeasured surface locks in whatever that cost
   happens to be" — and measuring is not freezing. It is the prerequisite,
   and it can be done now.
3. **The dead-component sweep**, which is 2d's first guardrail's payload
   anyway: the guard is what keeps them from coming back, the sweep is what
   removes the 19 already identified.
4. **Re-measure `docs/BASELINE.md`.** It is pinned at v0.65.0, and Phase 2's
   own claim to be done is a claim against that baseline. A stale baseline
   cannot settle it.

## Phase 3 — Close the highest-ranked gaps

Demand order, science-constrained.

- [ ] **Multi-A-race seasons** — the 244-vote request and the skipped v0.53.
      Two A-races in one season, bridge phase, separate taper windows.
- [ ] **Race pacing** — the skipped v0.54. Pacing bands with confidence and
      assumptions made visible.
- [ ] Remainder of the demand map, by votes

## Phase 4 — Breadth

- [x] `feat/v0.65-mcp-contract-hardening` — **evaluated and dispositioned
      2026-08-10; nothing in it survives that is not recorded here or in the
      spec, so the branch can be deleted.** It held unreviewed work: push quiet
      hours, two new MCP tools, and an icu refactor. Until that date it existed
      only on the developer's machine, so it was first pushed to `origin` as a
      backup, then read piece by piece rather than reviewed as a unit. It could
      not have merged regardless — its `0040_quiet_hours.sql` collides with
      `main`'s `0040_surface_views.sql`. Outcome, with reasoning per piece, in
      `docs/specs/2026-08-10-v065-branch-disposition.md`:
      `executeIcuTool()` **salvaged** (now item 1 of the gate-window list
      above); the triathlon confidence downgrade **salvaged** into 2c's Event
      demand slice; `get_recommendation_scorecard` **declined** — it read the
      `trainingBlocks.adherencePct` cache directly, bypassing
      `weekAdherencePct()`, and invented three unsourced figures;
      `get_backup_status` **deferred** until the surface is measured; push
      quiet hours **deferred** past Phase 2 as new capability, renumbering to
      0041 when it lands.
- [ ] The two deferrals from that disposition, kept here so deleting the branch
      does not drop them: **push quiet hours** (quiet-hours columns on
      `notification_prefs`, a settings card, gating in `push.ts` — rebuild
      rather than restore, and take migration 0041) and **`get_backup_status`**
      (blocked on the measurement below, not on its own merit). Both are
      reproduced in the disposition spec.
- [ ] MCP contract freeze — after the numbers underneath are stable, not before.
      Freeze a **measured** surface: competitors now sell on being "token
      cheap" (`ai-coaching-landscape.md` §10) and Recover has never measured
      what its 57 tools cost as context. Freezing an unmeasured surface locks
      in whatever that cost happens to be.
- [ ] Dead-component sweep (11 remaining; `race-countdown.tsx` was the twelfth
      and v0.87.0 deleted it, along with the type export that had blocked it)
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
