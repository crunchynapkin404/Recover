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

## ✅ v0.9.0 — Honest Body Intelligence

v0.7 fixed fabricated data in the database. It never reached the dashboard,
which still ships invented numbers: a hardcoded body-battery curve every
athlete sees identically, a `"22:30 – 23:00"` bedtime string literal, and a
47%-REM sleep breakdown backed by no data at all. Verified against the live
DB: intervals.icu's wellness payload carries **no sleep stages and no
bed/wake times** — those cards cannot be fixed, only removed.

- [x] **Body battery, for real**: energy curve modelled from morning readiness + real activity loads at their real times; explicitly labelled an estimate; returns nothing when readiness is `calibrating`
- [x] **Sleep debt**: cumulative deficit over 14 nights from real `sleepSecs`; missing nights skipped, never counted as perfect sleep
- [x] **Bedtime target**: derived from debt + a wake time the athlete sets; no wake time = no recommendation, never a guess
- [x] **Delete the unbackable**: sleep-stage breakdown and the `sleepHours / 8` "efficiency" figure

**Done when:** the dashboard contains no hardcoded physiological constant; a
day with training shows a curve that drops when the athlete actually trained;
an athlete with no wake time set sees a prompt, not a bedtime.

Design: [docs/specs/2026-07-16-v0.9.0-honest-body-intelligence-design.md](specs/2026-07-16-v0.9.0-honest-body-intelligence-design.md)

## ✅ v0.9.1 — Honest Pixels

Patch release: same defect class as v0.9.0, smaller pixels. Claimed the
v0.9.1 number, so the planned feature releases below shift one patch digit.

- [x] Favicon was still the stock Next.js triangle — replaced with the
      Recover ring on the dark app tile (multi-size ICO)
- [x] Sleep Score sparkline plotted `sleepSecs` under a `sleepScore` label
- [x] Sparklines no longer fabricate a flat line from <2 data points —
      empty path, no SVG rendered
- [x] `package.json` version drift (`0.8.0` at the v0.9.0 tag) corrected

## ✅ v0.9.2 — Adaptive Week (Smarter Coach)

Plans that react to the life the athlete actually had, not the one the plan
assumed. Shipped as the rolling week + daily adaptation
([design](specs/2026-07-17-v0.9.2-adaptive-week-design.md)).

- [x] **Rolling week + daily adaptation** (subsumes "adaptive training
      plans" and "adherence intelligence"): each week materializes from the
      skeleton against real availability — adherence below 70% rebuilds on
      actual load, a suppressed readiness trend reduces the target, a ±20%
      ramp guard clamps jumps, and a fully missed week restarts at 60% of
      skeleton; every morning the day re-adapts to readiness and available
      time, and every change is logged with a deterministic reason
- [x] **Coach visibility**: `get_week_plan`, `set_week_availability`,
      `get_plan_drift` tools; day-level `move_workout`/`swap_workout` in
      `update_training_plan`; morning insight and weekly review quote the
      logged adjustment reasons verbatim
- [x] **`/plan` page**: living week, adjustments timeline, remaining
      skeleton, availability intake with calendar prefill

**Done when:** skipping a week visibly reshapes next week's plan, and the coach
can explain what it changed and why. ✅

## ✅ v0.9.3 — Week Starts Now

Patch release: the living week begins when the plan does, not at the next
Monday's weekly review. Claimed the v0.9.3 number, so the planned feature
releases below shift one patch digit (again).

- [x] `generateTrainingPlan` materializes the current week immediately
- [x] "Plan this week" button on the `/plan` empty state (idempotent)
- [x] Regenerating a plan mid-week replaces the archived plan's open week
      instead of being shadowed by it until Monday, with a logged
      "plan changed" adjustment
- [x] Mid-week starts give already-past days zero availability — no
      fabricated workouts behind the clock

## ✅ v0.9.4 — Deeper Insights

- [x] **Correlation engine v2**: extend `lib/correlations.ts` — time-of-day patterns, weekday/weekend split, confidence intervals on impact scores; report "not enough data" rather than a thin correlation
- [x] **Auto-tags from activities**: derive "Hard session", "Double day", "Rest day", "Late training" from activity data instead of asking
- [x] **Achievements / streaks**: consistency milestones and plan completions. Shipped as sober milestones (design decision: no badges/XP).

**Done when:** auto-tags appear without user input; correlations carry a
confidence interval; a streak survives a restart. ✅

## ✅ v0.9.5 — Nightly Backups

- [x] **Nightly `pg_dump` backups**: default-on sidecar to the `recover-backups` volume, 14-dump rotation, with `scripts/restore-drill.sh` as the documented restore drill. (S3/offsite deliberately out of scope — disk loss is the hypervisor layer's job.)

**Done when:** a backup restores into a clean database unattended. ✅

## ✅ v0.9.6 — Absorb intervals-icu-mcp

- [x] **Absorb `intervals-icu-mcp`**: merge the standalone server's tools into Recover's built-in MCP (24 → 48 tools)

**Done when:** the standalone MCP server can be retired. ✅

---

Everything below was replanned at v0.9.6 — ten versions ending where v1.0.0
begins. Brainstorm, candidate inventory, and rationale:
[docs/plans/2026-07-18-roadmap-replan-v0.10-v0.19.md](plans/2026-07-18-roadmap-replan-v0.10-v0.19.md).

## ✅ v0.10 — Honest Load

Recover stopped borrowing its training-load math: `ctl`/`atl` used to be
written only by the intervals.icu sync, so a manual-only athlete got a hero
"Recovery 60" and "Strain 0.0" invented from zero data. This was the last
big honesty-debt item, and the foundation for everything after it —
readiness's form component, the adaptive week's ramp guard, and v0.14's
forecasts all consume these numbers.

- [x] **Native load engine**: per-activity load (power TSS / HR TSS /
      honest duration fallback), and CTL/ATL/TSB by EMA over
      them — for every source: manual, CSV, Strava, and the v0.11 connectors
- [x] **Source precedence**: intervals.icu's precomputed values keep winning
      when present; native values fill the gaps, labelled as computed
- [x] **Recovery & Strain go honest**: `calibrating` treatment through
      `ScoreRing`, `StrainBudget`, and the narrative when inputs are missing
      — never `?? 0` again
- [x] **"This Week" rings wired**: real weekly targets from the plan (or a
      recent-average fallback), replacing the hardcoded 0.7/0.8
- [x] **Dead UI sweep**: every remaining non-functional control wired or
      removed (audit found settings/log/coach/journal already clean; the
      remaining fabrications were the dashboard captions fixed here)

**Done when:** a no-integration athlete who logs workouts sees Recovery and
Strain computed from their own sessions — or `calibrating` — and the
honesty-debt section of this file is empty. ✅

## ✅ v0.11 — Wearable Connectors

intervals.icu stopped being the only automatic pipe. Whoop and Oura carry
sleep stages and bed/wake times — the data v0.9.0 had to delete cards for —
and Withings brings the blood pressure and body composition v0.13 needs.

- [x] **Connector framework**: one provider shape (OAuth/token, refresh,
      field mapping, provenance, per-user isolation) so the fourth
      connector was a file, not a project
- [x] **Whoop OAuth**: recovery, HRV, RHR, sleep with stages
- [x] **Oura**: sleep with stages, HRV/RHR, sleep score, temperature
      deviation (which v0.15 wants). Ships token-first (PAT) rather than
      OAuth — the API supports it and it's the boring intervals.icu flow;
      OAuth can reuse Whoop's framework later if multi-user demand shows up
- [x] **Apple Health**: Health Auto Export webhook + JSON file upload
      (cut from v0.8, promised here since)
- [x] **Withings OAuth**: weight, body composition, blood pressure
- [x] **Conflict policy**: explicit per-field source priority when two
      providers report the same morning, recorded in `field_sources`
- [x] **First-run experience**: guided source picker (connect / manual /
      CSV) and a "day N of 14" calibrating progress bar with a next-step
      prompt instead of a bare label
- [ ] Fitbit / Google Health direct — if demand shows up (still conditional)

**Done when:** HRV and staged sleep flow in nightly from a real Whoop or
Oura account, with full per-user isolation and visible provenance on every
field — and a fresh invite lands in a guided first run, not on a bare
`calibrating`. ✅

## ✅ v0.12 — Sleep Intelligence

v0.9.0 deleted the fabricated sleep cards; v0.11 delivered real stage data.
This release earned the cards back — only for athletes whose provider
actually sends the data.

- [x] **Sleep stages, for real**: stage breakdown bar rendered only from
      provider stage data; absent data shows nothing, not an estimate
- [x] **Sleep consistency**: bed/wake regularity (circular SD of sleep
      midpoint) scored 0–100 against the athlete's own pattern — the metric
      the literature keeps ranking above duration
- [x] **Chronotype & social jetlag**: midpoint-of-sleep, weekdays vs free
      days
- [x] **Bedtime target v2**: anchors on real median bed times when a
      provider sends them; the manual wake-time setting stays for everyone
      else
- [x] **Nap handling**: multiple sleep sessions per day summed honestly
      (`napAware`)
- [x] **Desktop shell**: responsive app shell (sidebar nav ≥lg, two-column
      dashboard, wider content) replacing the phone-stripe-on-a-monitor
      `max-w-lg` layout; the bottom tab bar stays on small screens

**Done when:** a Whoop/Oura athlete sees stages and a consistency score; a
manual athlete sees exactly what they saw before — nothing invented; and
the dashboard uses a laptop screen instead of the middle 512px of it. ✅

## ✅ v0.13 — Deep Biology

Long-horizon health metrics. Deferred twice because the data wasn't there
(the live DB had 0/368 days of blood pressure); v0.11's Withings connector
and this release's blood-test extraction fixed the input side.

- [x] **Health Records**: upload blood test PDF/photo (or paste text) → the
      user's own LLM extracts biomarkers with per-value confidence → review
      screen → `biomarkers` table; nothing enters the DB unconfirmed. A
      deterministic line parser covers the no-LLM path.
- [x] **Biological Age**: a transparent composite of RHR, HRV, sleep
      consistency, VO₂max, and body composition offset from chronological
      age — with an honest "insufficient inputs" state that lists what's
      missing (no birth year or < 3 signals → no number)
- [x] **Blood Pressure**: manual entry + Withings sync; classified against
      the 2017 ACC/AHA bands with a recent-average trend
- [x] **Coach visibility**: `get_biomarkers` tool; the coach references
      bloodwork trends but never diagnoses

**Done when:** a blood test is parsed, reviewed, and appears as trends —
and a missing biomarker shows as missing, not interpolated. ✅

## ✅ v0.14 — Race Ready

The adaptive week manages training; race day is why it exists. Everything
here stands on v0.10's honest load engine — forecasting from fabricated CTL
would be fabrication with extra steps.

- [x] **Race calendar**: A/B/C races as first-class entities (coach memory
      already knows them informally); countdown on the dashboard
- [x] **Taper engine**: the final skeleton weeks reshape into a taper from
      current CTL and race distance; the ramp guard learns to taper
- [x] **Readiness forecast**: projected TSB and readiness band for race day
      from the planned week — clearly labelled a projection, with honest
      uncertainty
- [x] **What-if simulator**: "what does moving Thursday's intervals to
      Friday do to Sunday's form?" — plan changes preview their load impact
      before they're saved
- [x] **Race-day report**: morning-of readiness brief, and a post-race
      debrief comparing plan against execution

**Done when:** an athlete with a race in 8 weeks watches the plan taper into
it and gets a defensible form projection that updates daily. ✅

## v0.15 — Cycle-Aware Readiness

Half of athletes have a baseline variable the score silently ignores. Cycle
phase shifts HRV, RHR, and temperature enough to move readiness bands —
treating it as noise is fabrication by omission.

- [ ] **Cycle tracking**: manual phase logging in the journal; automatic
      where a connector provides it (Oura temperature deviation)
- [ ] **Phase-aware baselines**: readiness compares against same-phase
      history once enough cycles are logged — `calibrating` until then, same
      as readiness itself was
- [ ] **Pattern surfacing**: how readiness, HRV, and sleep actually behave
      per phase for _this_ athlete — reported with the v0.9.4 confidence
      machinery, "inconclusive" when thin
- [ ] **Coach awareness**: opt-in per athlete; cites the athlete's own
      patterns, never generic population advice

**Done when:** a luteal-phase HRV dip reads as "normal for this phase" —
backed by the athlete's own history — instead of a red alert.

## v0.16 — The Coach Remembers

Coach memory holds structured facts; it still can't recall what you actually
talked about, and every hard session ends in silence.

- [ ] **Recall over history**: search across past threads, journal notes,
      and weekly reviews (Postgres full-text search first; embeddings only
      if FTS demonstrably isn't enough) — the coach cites past conversations
      ("three weeks ago you said the knee…")
- [ ] **Session debriefs**: after a hard or flagged workout syncs, the coach
      opens a short debrief — how did it feel, anything hurt — and files the
      answers into memory
- [ ] **Monthly report**: the weekly review's big sibling — load, recovery,
      adherence, milestones, biomarker deltas, written by the coach
- [ ] **Voice input**: the coach mic goes live via on-device speech
      recognition (Web Speech API) — the last dead control gets wired for
      real
- [ ] **Token transparency**: per-user LLM usage visible in settings

**Done when:** the coach quotes a real past conversation unprompted, and a
month-end report shows up without being asked.

## v0.17 — Stronger Together

Recover already runs as an owner plus invited friends; the accounts just
can't see each other. Opt-in sharing — sober, like the milestones.

- [ ] **Sharing model**: explicit per-pair consent, per-surface scope
      (readiness band only / trends / full), revocable, off by default
- [ ] **Group view**: readiness bands and streaks across consenting
      housemates and teammates — bands, not scores; no leaderboard mechanics
- [ ] **Coach seat**: grant another user (a real human coach) read access to
      the same surfaces the AI coach sees
- [ ] **Weekly group digest**: opt-in summary push
- [ ] **Shareable cards**: privacy-safe milestone and race images rendered
      server-side for posting elsewhere — data-minimal, no score by default

**Done when:** two consenting users see each other's bands, a third user
sees nothing, and revoking consent takes effect immediately.

## v0.18 — Good Self-Hosted Citizen

Recover behaves like the rest of the homelab expects it to. Clears the
operations track.

- [ ] **Sync-jobs admin UI**: queue, failures, retries, manual kick
- [ ] **Prometheus `/metrics`** and richer health: sync staleness, job
      failures, backup age, push delivery
- [ ] **Outbound webhooks**: readiness computed / band changed / backup
      completed → Home Assistant, ntfy, whatever's listening
- [ ] **Data export (GDPR)**: full-history download — the read side of
      v0.8's import; export → wipe → import must round-trip
- [ ] **Native `ubuntu-24.04-arm` release runners**: restore the arm64
      image dropped in v0.8 (QEMU builds took ~50 min)
- [ ] **Vercel + Neon deployment guide refresh**

**Done when:** readiness lands in Home Assistant via webhook, and a full
export re-imports into a clean instance losslessly.

## v0.19 — 1.0 Hardening

The last 0.x. Nothing new — everything trustable.

- [ ] **Auth hardening**: passkeys + TOTP 2FA, session management UI
      (list/revoke devices), audit log for auth and token events
- [ ] **Accessibility sweep**: ScoreRing aria labels, contrast, focus
      order, button roles — the polish-backlog item, done properly
- [ ] **Upgrade guarantees**: migrations tested against real dumps,
      documented rollback, backup compatibility matrix
- [ ] **Performance pass**: dashboard cold-load budget, query audit
- [ ] **API/MCP stability**: freeze tool names and schemas, publish a
      deprecation policy
- [ ] **Docs reviewed end-to-end**: self-hosting, connectors,
      troubleshooting
- [ ] **Security review**: full pass before the tag

**Done when:** v1.0.0 tags the next commit.

## Ongoing — operations track

All items scheduled into **v0.18 — Good Self-Hosted Citizen** by the v0.9.6
replan. Anything cheap can still ship earlier alongside any release.

## Ongoing — honesty debt

Fabrications v0.9.0 found but did not fix. All pre-existing; all the same
defect class as the sleep/energy cards that release cleaned up. **Emptied
by v0.10 — Honest Load.**

- [x] **Recovery & Strain are invented for manual-only athletes**: `recoveryScore`/`strainFraction` came from `latest?.atl ?? 0` / `latest?.ctl ?? 0`, and `atl`/`ctl` were written only by the intervals.icu sync. Fixed in v0.10: native load engine + `calibrating` treatment through `ScoreRing`, `StrainBudget`, and the narrative.
- [x] **"This Week" rings hardcoded**: `ringOuter={0.7}` / `ringInner={0.8}` for every athlete, forever. Fixed in v0.10: real plan/trailing-average targets, rings hidden without one.
- [x] **The logging "streak" is a count, not a streak**: `Math.min(window30.length, 30)` renders "22-day streak" for 22 scattered days. Folded into Achievements (v0.9.4). Fixed in v0.9.4: real consecutive runs on dashboard and journal.
- [x] **Sparklines flat-line on no data**: `sparkPath` returned `"M0 10 L100 10"` for <2 points — a visual claim of stability made from nothing. Fixed in v0.9.1: empty path, no SVG rendered.

## Ongoing — polish backlog

Cheap; pick up alongside any release. The v0.9.6 replan gave most items a
scheduled home.

- [ ] Data export (GDPR): full history download — the read side of v0.8's import. → v0.18
- [ ] Default journal entries: pre-toggle frequent behaviors so only exceptions get marked
- [ ] Accessibility: ScoreRing aria labels, contrast, button roles. → v0.19
- [ ] Performance log filters: wire up the month/sport controls
- [x] Dead UI sweep: remove non-functional settings controls (v0.9.0 cleared the dashboard's sleep/energy share). Closed in v0.10 — audit found the settings/log/coach/journal controls already wired or removed; the dashboard's fabricated captions were the last stragglers.
- [x] Sleep Score sparkline plotted `sleepSecs` under a "Sleep Score" label — real data, wrong series. Fixed in v0.9.1.

## Ongoing — design & UX

Added by the v0.9.6 replan's UI/UX pass. The visual layer is not the
problem — the structural UX is. The two big items are scheduled (first-run
→ v0.11, desktop shell → v0.12); everything here is the small continuous
kind that never earns its own release. Pick up alongside any release, same
as the polish backlog.

- [ ] Empty states: every page says something useful (and honest) when its
      data doesn't exist yet, instead of rendering a blank card
- [ ] Loading skeletons: layout-stable placeholders instead of pop-in
- [ ] Settings information architecture: one long page currently feeds
      seven action domains (LLM, push, Strava, tokens, body, coach, …) —
      split into sections or sub-pages
- [ ] Chart consistency: one visual grammar (axes, bands, tooltips, colors)
      across dashboard sparklines, fitness PMC, wellness trends, and coach
      artifacts
- [ ] Accessibility as-you-go: new UI ships with labels/contrast/focus
      handled, so the v0.19 sweep is a check, not a cliff

## Not planned

- **Garmin direct** — no open consumer API; the approval-gated program and unofficial
  scraping libraries are both poor fits for a self-hosted project. Garmin users
  are well served via intervals.icu sync today.
- **Cloud-hosted SaaS version** — Recover is self-hosted on purpose.
- **Nutrition tracking** — out of scope for an endurance recovery app; users already have MyFitnessPal/Cronometer. May integrate read-only nutrition data from Apple Health in a future version if there's demand.
- **Strength Builder / Watch app** — intervals.icu and Garmin/Apple Watch handle workout execution; Recover focuses on recovery intelligence, not workout delivery.
