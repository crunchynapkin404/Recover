# Roadmap

Recover is built depth-first: make the daily loop genuinely useful for the
people already running it, then widen who can run it. Each phase ships as a
tagged release with its own definition of done. Order can shift if real usage
says otherwise — file an issue if something here matters to you.

## ✅ v0.1 — GitHub-ready release

- [x] intervals.icu sync (wellness, activities, CTL/ATL) with scheduler
- [x] Readiness engine on personal baselines (HRV, RHR, sleep, TSB)
- [x] Dashboard, journal, and performance log
- [x] AI coach — bring your own key (Anthropic or any OpenAI-compatible endpoint, Ollama included)
- [x] Built-in MCP server with scoped, revocable bearer tokens
- [x] Multi-user invites + Strava OAuth (provenance-aware, AI-excluded by default)
- [x] Docker self-hosting with prebuilt multi-arch images
- [x] Demo seed data, screenshots, docs, community files

## ✅ v0.2 — Phone & daily loop

The morning glance: install it like an app, get told when your score is ready.

- [x] PWA: manifest, icons, service worker
- [x] Web-push morning readiness notification after the overnight sync
- [x] Per-user notification subscriptions and settings
- [x] Manual resync: dashboard sync chip + pull-to-refresh in the installed app

**Done when:** installed on a phone, the morning notification arrives unattended.

## ✅ v0.3 — Analytics depth

More reasons to open the app than a single number.

- [x] Activity detail page: stream charts (HR, power, pace), laps/intervals
- [x] Fitness page: performance management chart (CTL/ATL/TSB over time)
- [x] Wellness trends: HRV, resting HR, and sleep against personal baselines
- [x] History/calendar polish

**Done when:** a month of training is explorable end-to-end.

## ✅ v0.4 — Coach Intelligence

The coach becomes a proactive, memory-rich training partner.

- [x] **Coach Memory**: persistent knowledge store (goals, injury history, race calendar, preferences) — structured JSON in DB, injected into system prompt, survives across threads
- [x] **Thinking Modes**: user selects Quick (haiku/flash) or Deep (opus/sonnet) per message or as default — maps to model selection at runtime
- [x] **Proactive Insights**: cron generates a morning message from overnight sync data → stored as coach message, visible on dashboard next visit (no push infra needed)
- [x] **Ghost Mode**: ephemeral threads (`ephemeral: true` column) — auto-purge after 24h via cleanup job; quick Q&A without cluttering history
- [x] **Coach Personalities**: selectable tone presets (Analytical, Encouraging, Direct) that modify system prompt preamble; stored in user settings
- [x] **Overtraining Warnings**: automatic alerts on sustained HRV suppression (>7 days) or RHR spikes (>10bpm above baseline)
- [x] **Extended MCP tools**: power/pace curves, best efforts, training load summaries

**Done when:** coach memory persists across threads; morning insight appears unasked; ghost threads auto-delete; thinking modes switch the underlying model.

## ✅ v0.5 — Training Intelligence

AI-generated structured training — the feature no WHOOP/Bevel competitor has with intervals.icu data.

- [x] **Training Plan Generation**: periodized multi-week plans from current CTL + target race date; stored as structured blocks in DB; coach tracks progress weekly
- [x] **Calendar Integration**: OAuth to Google Calendar; coach knows busy times and adjusts training suggestions ("You have meetings until 18:00 — I'd suggest an evening zone-2 ride")
- [x] **Artifacts**: coach can output inline SVG charts in chat (HRV trends, load vs recovery correlations, PMC projections) — rendered client-side from structured tool output
- [x] **Proactive Weekly Review**: scheduled job generates coach-written weekly summary comparing planned vs actual load, recovery trends, and next-week outlook

**Done when:** a training plan is generated from a race goal; calendar blocks are visible to the coach; inline charts render in chat; weekly review arrives automatically.

## ✅ v0.6 — Strava AI Descriptions

Auto-generate data-dense activity descriptions from intervals.icu metrics and push them to Strava.

- [x] **Strava write scope**: upgrade OAuth to include `activity:write`; prompt existing users to reconnect
- [x] **Description generator**: format activity metrics (load, IF, TRIMP, efficiency, form, PRs) into a compact emoji-rich block using intervals.icu data only
- [x] **Auto-describe post-sync**: opt-in setting; generates and pushes description after each new activity syncs
- [x] **Append mode**: preserves existing descriptions, adds AI block below a `---` separator
- [x] **Coach tool**: `describe_strava_activity` for manual trigger or custom descriptions
- [x] **Skip marker**: prevents double-writes on re-sync

**Done when:** new activities get a data-rich description on Strava within minutes of sync; existing descriptions are preserved; coach can describe on demand.

## ✅ v0.6.2 — Strava description fields

- [x] **Field selection**: per-user checklist of which metrics appear; live preview against a real activity
- [x] **Safe defaults**: no saved config = full v0.6 template; new fields never auto-appear for configured users
- [x] **Empty guard**: all fields off skips the write — no bare marker is ever published

**Done when:** a user unticks TRIMP and their next activity's description omits it.

## ✅ v0.7 — Score Integrity

Stop the app from knowing things it doesn't know: the journal fabricated
subjective input, and illness silently poisoned the baselines the readiness
score is measured against. Both had to be fixed before anything else consumes
those baselines.

- [x] **Honest subjective input**: unanswered energy/soreness/stress sliders write nothing instead of submitting invented defaults; unanswered state is announced to screen readers
- [x] **Day flags**: athletes flag abnormal days (🤒 ill, ✈️ travel, 🏔️ altitude); flagged days are excluded from rolling baselines but still scored
- [x] **Retroactive repair**: flagging a past day recomputes every score after it
- [x] **Honest degradation**: flagging most of the window returns `calibrating`, not a confident wrong number
- [x] **Coach visibility**: `get_wellness` returns day flags

**Done when:** saving the journal without touching a slider writes no
subjective values; a flagged illness day scores red but never appears in a
later day's baseline.

Design: [docs/specs/2026-07-15-v0.7-score-integrity-design.md](specs/2026-07-15-v0.7-score-integrity-design.md)

## ✅ v0.8 — Data Freedom

intervals.icu stops being a hard requirement. (Planned as v0.10; pulled
forward and shipped early — this section is the release that exists.)

- [x] Manual-first onboarding: fully usable with zero integrations
- [x] Manual vitals entry in the journal when no integration is active
- [x] Manual activity logging (`/activity/log`)
- [x] CSV import for wellness and activity history, with flexible column mapping
- [x] Fixed: `proxy.ts` exported `proxy()` instead of `middleware()` — the route guard had never run
- [x] v0.8.1: navigation to the activity-log and import pages

**Done when:** a user with no intervals.icu account gets a readiness score.

Apple Health file-export/webhook and a Google Health / Fitbit connector were
cut from this release and fold into v0.11 alongside the other connectors.

## v0.9.0 — Honest Body Intelligence ← next

v0.7 fixed fabricated data in the database. It never reached the dashboard,
which still ships invented numbers: a hardcoded body-battery curve every
athlete sees identically, a `"22:30 – 23:00"` bedtime string literal, and a
47%-REM sleep breakdown backed by no data at all. Verified against the live
DB: intervals.icu's wellness payload carries **no sleep stages and no
bed/wake times** — those cards cannot be fixed, only removed.

- [ ] **Body battery, for real**: energy curve modelled from morning readiness + real activity loads at their real times; explicitly labelled an estimate; returns nothing when readiness is `calibrating`
- [ ] **Sleep debt**: cumulative deficit over 14 nights from real `sleepSecs`; missing nights skipped, never counted as perfect sleep
- [ ] **Bedtime target**: derived from debt + a wake time the athlete sets; no wake time = no recommendation, never a guess
- [ ] **Delete the unbackable**: sleep-stage breakdown and the `sleepHours / 8` "efficiency" figure

**Done when:** the dashboard contains no hardcoded physiological constant; a
day with training shows a curve that drops when the athlete actually trained;
an athlete with no wake time set sees a prompt, not a bedtime.

Design: [docs/specs/2026-07-16-v0.9.0-honest-body-intelligence-design.md](specs/2026-07-16-v0.9.0-honest-body-intelligence-design.md)

## v0.9.1 — Smarter Coach

Plans that react to the life the athlete actually had, not the one the plan
assumed. Extends v0.5's `generateTrainingPlan` and the `adherencePct` the
weekly review already computes.

- [ ] **Adaptive training plans**: weekly auto-adjust from adherence + readiness trend; a missed week rewrites what's ahead instead of silently falling behind
- [ ] **Adherence intelligence**: planned vs actual load surfaced continuously (not just in the weekly review), with trend alerts the coach can act on
- [ ] **Coach visibility**: adherence and plan drift available as coach context/tools

**Done when:** skipping a week visibly reshapes next week's plan, and the coach
can explain what it changed and why.

## v0.9.2 — Deeper Insights

- [ ] **Correlation engine v2**: extend `lib/correlations.ts` — time-of-day patterns, weekday/weekend split, confidence intervals on impact scores; report "not enough data" rather than a thin correlation
- [ ] **Auto-tags from activities**: derive "Hard session", "Double day", "Rest day", "Late training" from activity data instead of asking
- [ ] **Achievements / streaks**: consistency milestones and plan completions

**Done when:** auto-tags appear without user input; correlations carry a
confidence interval; a streak survives a restart.

## v0.9.3 — Infrastructure

- [ ] **Nightly `pg_dump` backups**: to volume/S3, with a documented restore drill
- [ ] **Absorb `intervals-icu-mcp`**: merge the standalone server's tools into Recover's built-in MCP (58 → ~40 after dedupe)

**Done when:** a backup restores into a clean database unattended, and the
standalone MCP server can be retired.

## v0.10 — Deep Biology

Long-horizon health metrics. Deferred from the original v0.8 "Body
Intelligence" because the data isn't there yet: the live DB has 0/368 days of
blood pressure, 0/368 respiration, and only 79/368 VO2max.

- [ ] **Health Records**: upload blood test PDF/photo → LLM extracts biomarkers → `biomarkers` table
- [ ] **Biological Age**: weekly score from RHR baseline trend, HRV percentile-for-age, sleep consistency, VO2max, body composition; 20-year projection
- [ ] **Blood Pressure**: manual entry (`systolic`/`diastolic` exist in the intervals.icu payload but arrive empty)

**Done when:** a blood test PDF is parsed and biomarkers appear in the app.

## v0.11 — Wearable connectors

Whoop and Oura would also be the first providers to carry sleep stages and
bed/wake times — the data v0.9.0 had to delete cards for.

- [ ] Whoop OAuth (recovery, HRV, sleep)
- [ ] Oura OAuth
- [ ] Apple Health: file-export upload + Health Auto Export-style webhook (cut from v0.8)
- [ ] Google Health / Fitbit direct — if demand shows up

**Done when:** HRV/sleep flows in from a real Whoop or Oura account with full data isolation.

## Ongoing — operations track

Small chunks, shipped alongside feature phases.

- [ ] Sync-jobs admin UI
- [ ] Vercel + Neon deployment guide refresh
- [ ] Native `ubuntu-24.04-arm` release runners — restore the arm64 image dropped in v0.8 (QEMU builds took ~50 min)

## Ongoing — polish backlog

Considered for v0.9 and deliberately not scheduled. Cheap; pick up alongside
any release.

- [ ] Data export (GDPR): full history download — the read side of v0.8's import
- [ ] Default journal entries: pre-toggle frequent behaviors so only exceptions get marked
- [ ] Accessibility: ScoreRing aria labels, contrast, button roles
- [ ] Performance log filters: wire up the month/sport controls
- [ ] Dead UI sweep: remove non-functional settings controls (v0.9.0 clears the dashboard's share)

## Not planned

- **Garmin direct** — no open consumer API; the approval-gated program and unofficial
  scraping libraries are both poor fits for a self-hosted project. Garmin users
  are well served via intervals.icu sync today.
- **Cloud-hosted SaaS version** — Recover is self-hosted on purpose.
- **Nutrition tracking** — out of scope for an endurance recovery app; users already have MyFitnessPal/Cronometer. May integrate read-only nutrition data from Apple Health in a future version if there's demand.
- **Strength Builder / Watch app** — intervals.icu and Garmin/Apple Watch handle workout execution; Recover focuses on recovery intelligence, not workout delivery.
