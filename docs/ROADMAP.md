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
      deviation (which the deferred Cycle-Aware Readiness would want). Ships
      token-first (PAT) rather than OAuth — the API supports it and it's the
      boring intervals.icu flow; OAuth can reuse Whoop's framework later if
      multi-user demand shows up
- [x] **Apple Health**: Health Auto Export webhook + JSON file upload
      (cut from v0.8, promised here since). Health Auto Export's REST
      automation turned out to be a paid feature; v0.33 added the free
      Intervals.icu Companion route (HealthKit → intervals.icu → Recover)
      as an alternative that costs nothing but cannot carry bed/wake times
- [x] **Withings OAuth**: weight, body composition, blood pressure
- [x] **Conflict policy**: explicit per-field source priority when two
      providers report the same morning, recorded in `field_sources`
- [x] **First-run experience**: guided source picker (connect / manual /
      CSV) and a "day N of 14" calibrating progress bar with a next-step
      prompt instead of a bare label
- [ ] Fitbit / Google Health direct — if demand shows up (still conditional)
- [ ] **Cycle-Aware Readiness** — cycle phase logging, phase-aware baselines
      against same-phase history, per-phase pattern surfacing, opt-in coach
      awareness. Deferred — nobody on a running instance generates cycle data
      today; building phase-aware baselines against synthetic cycles would be
      fabrication with extra steps. Returns when a real athlete needs it.

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

## ✅ v0.15 — The Coach Remembers

Coach memory held structured facts; it still couldn't recall what was
actually said, and every ride ended in silence.

- [x] **Recall over history**: `recall_history` coach tool — Postgres
      full-text search (`simple` config, for mixed Dutch/English) across past
      conversations, weekly/monthly reviews, ride debriefs, and journal
      notes; the coach cites results with dates and says so when it finds
      nothing. Ghost threads excluded — they were promised to vanish.
- [x] **Post-ride loop**: a 15-minute intervals.icu activity poll (no
      webhooks exist; quiet 23:00–06:00) detects a fresh ride, a debrief card
      asks RPE / feel / notes, and the coach writes a ride review reconciling
      the numbers with the athlete's own words — quoted, never paraphrased.
      Skipped or expired debriefs get a data-only review that says no
      feedback was given.
- [x] **Monthly report**: the weekly review's big sibling — load, recovery,
      adherence, milestones, biomarker deltas, written by the coach — at
      most once per calendar month
- [x] **Voice input**: the coach mic goes live via the Web Speech API —
      dictation fills the box, never auto-sends, with an honest note that
      the browser vendor may process the audio (the old "on-device" claim
      was wrong, and dies here)
- [x] **Token transparency**: per-user LLM usage visible in settings

**Done when:** the coach quotes a real past conversation unprompted, a
month-end report shows up without being asked, and a synced ride produces a
debrief prompt within ~15 minutes. ✅

Design: [docs/specs/2026-07-19-v0.15-coach-remembers-design.md](specs/2026-07-19-v0.15-coach-remembers-design.md)

## v0.16 — Stronger Together

→ deferred to the new roadmap. v0.20's final-sweep spec
(`docs/specs/2026-07-21-v0.20-final-sweep-design.md`) scoped this out
explicitly: Stronger Together is a real social subsystem — per-pair
sharing, group view, coach seat, digest, shareable cards — that deserves
its own brainstorm and spec, not a line item in a closing sweep. Nothing
below shipped in v0.20; the section is unchanged and carries forward.

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

## ✅ v0.17 — Good Self-Hosted Citizen

Recover behaves like the rest of the homelab expects it to. Clears the
operations track. Shipped as Track 2 of **v0.20.0 — Final Sweep**.

- [x] **Sync-jobs admin UI**: queue, failures, retries, manual kick —
      owner-only panel on `/admin` (queue/running/failed, retry + kick
      controls)
- [x] **Prometheus `/metrics`** and richer health: sync staleness, job
      failures, backup age, push delivery — token-gated Prometheus text
      endpoint plus a shared ops snapshot backing both `/api/health` and
      `/api/metrics`
- [x] **Outbound webhooks**: readiness computed / band changed / backup
      completed → Home Assistant, ntfy, whatever's listening — HMAC-signed
      per-subscription delivery with retry/backoff and a fetch timeout
- [x] **Data export (GDPR)**: full-history download — the read side of
      v0.8's import; export → wipe → import must round-trip — export now
      covers every user table (journal, biomarkers, coach memories, chat
      messages, connections/settings, races, plans, tokens metadata); a
      matching import path lands data back into the caller's own account;
      the round trip is proven losslessly on a scratch DB
- [x] **Native `ubuntu-24.04-arm` release runners**: restore the arm64
      image dropped in v0.8 (QEMU builds took ~50 min) — native
      `ubuntu-24.04-arm` runner + manifest merge, no QEMU
- [x] **Vercel + Neon deployment guide refresh** — brought current against
      Next 16 and the current schema, with corrected driver guidance

**Done when:** readiness lands in Home Assistant via webhook, and a full
export re-imports into a clean instance losslessly. ✅

## ✅ v0.18 — 1.0 Hardening

The last 0.x. Nothing new — everything trustable.

**v0.18.0 (2026-07-21) shipped the security slice**: HTTP security
headers, login rate-limiting + boot-time secret validation, Apple Health
ingest hardening, a dependency audit, an owner-viewable auth/token/
connection audit log, and an exhaustive 101-surface per-user isolation &
input audit (zero gaps found — `docs/security/2026-07-20-isolation-audit.md`).
Design: `docs/specs/2026-07-20-v0.18-security-hardening-design.md`.
**v0.20.0 (2026-07-21) closed the rest of this list as Track 3 of
Final Sweep**: the accessibility sweep, session-management UI, upgrade
guarantees, the performance pass, the API/MCP stability freeze, the
end-to-end docs review, and a final security review re-confirming every
new v0.20 surface (`docs/security/2026-07-21-v0.20-review.md`, zero gaps).
Passkeys/TOTP 2FA is the one item **not** carried forward — see the note
below; everything else on this list is now closed.

- [x] **Session-management UI**: list/revoke active sessions/devices
      (Better Auth's `sessions` table) — shipped v0.20.0. **Passkeys/TOTP
      2FA deliberately stays out of scope**, not deferred-pending-work: per
      `docs/specs/2026-07-21-v0.20-final-sweep-design.md`, the deployment
      model (self-hosted, invite-only, no public signup, ~10 friends,
      behind a Cloudflare tunnel, single owner) already gets login
      rate-limiting and an auth/token audit log from v0.18.0; 2FA/passkeys
      would be real work defending against a threat that model already
      blunts. Revisit only if the deployment model itself changes.
- [x] **Accessibility sweep**: ScoreRing aria labels, contrast, focus
      order, button roles — the polish-backlog item, done properly.
      `docs/a11y-sweep-2026-07.md`
- [x] **Upgrade guarantees**: migrations tested against real dumps,
      documented rollback, backup compatibility matrix. `docs/UPGRADING.md`
- [x] **Performance pass**: dashboard cold-load budget, query audit.
      `docs/perf-pass-2026-07.md`
- [x] **API/MCP stability**: freeze tool names and schemas, publish a
      deprecation policy. `docs/API-STABILITY.md` (54 tools frozen)
- [x] **Docs reviewed end-to-end**: self-hosting, connectors,
      troubleshooting
- [x] **Security review**: full pass before the tag.
      `docs/security/2026-07-21-v0.20-review.md`

**Done when:** every item on this list ships or is deliberately scoped
out. Closed in **v0.20.0** (2026-07-21), the roadmap's closing release —
not the v1.0.0 tag this section originally envisioned; see
`docs/specs/2026-07-21-v0.20-final-sweep-design.md` for why the release
plan changed (v0.19's design pass and this sweep both slotted in ahead of
a 1.0 tag, same pattern as the v0.9.x patch releases earlier in this
file). ✅

## ✅ v0.19 — Design Refresh

A Superdesign pass (`docs/flow-export-1784540566598/`, project
`feee3bd4-a46d-4c81-93eb-16107ffebbcf`) rethought the dashboard, coach, log,
journal, and settings screens around progressive disclosure — collapsed
sections instead of everything rendered flat at once. It's a restyle, not a
rebuild: the underlying data and features are unchanged, and several of its
patterns directly close items already sitting in "Ongoing — design & UX"
below.

- [x] **Dashboard hero simplification**: one animated Readiness ring as the
      page's single focal metric; Recovery/Sleep/Strain demoted to a compact
      stat row (the mockup's "BRI Score" was dropped — no such metric exists
      in the codebase); "Recovery Metrics" and "Recent Sessions" become
      collapsed-by-default accordions instead of always-expanded sections
- [x] **Settings information architecture**: one accordion per domain
      (Integrations, AI & Tech, Advanced/API, App, About), only Profile open
      by default — closes the "Settings information architecture" item below
- [x] **Log page time navigation**: Today/Week/Month segmented toggle plus a
      month strip, replacing the current Training/Wellness-only toggle; both
      the PMC ("Performance Trends") and Wellness Trends panels wrapped in
      collapsible sections, always present (the old toggle's wellness-trends
      view is preserved as a collapsed section, not dropped) — a first step
      on "Chart consistency" below, not a full resolution (restyles the
      wrapper, not the underlying chart grammar)
- [x] **Journal restructure**: stepped check-in (one open step, completed
      steps collapse with a checkmark) instead of one long flat form;
      correlation insights promoted above the form instead of below it;
      5-day calendar strip with a streak indicator
- [x] **AI Coach chat chrome**: collapsible chat-history and quick-context
      panels, inline structured data cards in coach replies, quick-reply
      chips — voice input in the composer shipped as part of v0.15, not
      duplicated here

Explicitly not carried over: the mockups' floating nav includes a
"Login"/"Exit" tab (even on the login screen itself) — a Superdesign
flow-navigation artifact linking between draft pages, not an intended
logout control. The settings mockup's light/dark toggle is decorative;
Recover stays dark-only until a real light theme is scoped. Coach-header
search/bookmark/archive icons and composer image/mic buttons beyond voice
are dropped, not built as stubs. Login itself was out of scope for this
release (the mockup export includes a login draft, but the roadmap above
never named it, and it's a flow-tool artifact rather than a real target).
Also shipped beyond the original scope: honest empty states and
layout-stable loading skeletons on all five touched pages, and a semantic
heading wrapper on every new collapsible trigger (found during the
whole-branch review — the shared primitive had dropped screen-reader
heading navigation across all five pages).

**Done when:** the dashboard, coach, log, journal, and settings pages match
the export's structural pattern (collapsed-by-default sections, restyled
charts), and the "Settings information architecture" backlog item is
checked off. ✅

## ✅ v0.21 — Design Consistency

A second Superdesign pass (project `feee3bd4-a46d-4c81-93eb-16107ffebbcf`;
design spec `docs/specs/2026-07-21-full-design-update-design.md`,
implementation spec `docs/specs/2026-07-22-full-design-update-implementation.md`)
extends the dark-glass visual language to every remaining route, including
the five pages v0.19 already restyled. A restyle, not a rebuild: no new
data, metrics, features, or migrations.

- [x] **Dashboard hero rebuilt**: the single Readiness ring replaced with
      concentric Apple-Watch-style `ReadinessRings` (center number + nested
      Recovery/Sleep/Strain rings, each independently calibrating);
      `StrainBudget` deleted as a duplicate of `strainFraction`; the
      now-fully-superseded `ScoreRing` deleted
- [x] **Hairline-restraint tier** (Settings, Health, Admin, Import): a
      `.hairline-list` utility flattens nested glass-in-glass card stacks
      into hairline-divided rows on Settings and Import; Health and Admin's
      existing structure was judged already consistent and left unchanged
- [x] **Glass-tile tier** (Log, Activity detail, Coach, Journal, Plan): dedup + header-consistency pass — Log's duplicate TSB display, Journal's
      duplicate logging streak (now hidden on the shared `MilestonesCard`
      via a `hideStreak` prop, kept visible on Dashboard), consistent
      page-header treatment across all seven hairline/glass-tile pages
- [x] **Login copy fix**: dropped the invented "Premium Athlete Edition" /
      "Forgot Access Key?" language that didn't correspond to any real
      feature; Join was already honest and left as-is
- [x] **Final whole-branch review fixes**: `sync-chip.tsx`'s pre-existing
      SSR/hydration relative-time mismatch closed
      (`useSyncExternalStore`-backed mount gate); the now-orphaned
      `GlassTile` primitive deleted alongside `ScoreRing`

**Done when:** all 11 route surfaces (`/`, `/login`, `/wellness`, `/coach`,
`/settings`, `/log`, `/health`, `/import`, `/plan`, `/admin`,
`/activity/[id]`) share one consistent dark-glass visual language. ✅

## ✅ v0.22 — Wellness Fitness Metrics

intervals.icu's daily wellness payload has carried `vo2max`, `rampRate`,
and per-sport `pMax`/`wPrime` since the v0.11 wearable-connectors work —
none of the four were ever extracted into a typed column. Design:
`docs/specs/2026-07-22-v0.22-wellness-fitness-metrics-design.md`.

- [x] **Bio-Age VO2max wired**: `health/page.tsx`'s hardcoded `vo2max: null`
      replaced with the athlete's latest real reading; `biological-age.ts`'s
      existing scoring factor needed no changes
- [x] **Log page fitness stats row**: eFTP / max power / W′ plus a
      rampRate-derived trend label, inside the existing Performance Trends
      panel next to the PMC chart
- [x] **Data layer**: additive migration on `wellness_daily`; connector,
      merge-policy (`vo2max` → physiology ladder, the other three →
      intervals.icu-only load ladder), and sync wiring extended to match
      `eftp`'s existing treatment

**Done when:** any athlete with Garmin-synced VO2max data sees it feed a
real Bio-Age score, and eFTP/pMax/wPrime/rampRate are visible on the Log
page. ✅

## ✅ v0.23 — IA & Navigation Redesign

Navigation off `Home / Plan / Log / Coach / Journal / Menu` and onto
`Today / Train / Coach / Body / Menu` — one job per screen, one home per
duplicated module. Handoff:
`docs/design_handoff_ia_redesign/README.md`.

- [x] **Today rebuilt**: single glass hero, 2×2/4-across vitals grid, a
      real **Mark done** action (`markDayDone`, status only — no invented
      load or activity)
- [x] **`/plan` + `/log` → `/train`**: Week (grouped hairline-row surface),
      History (7-day stat strip + compact rows), Fitness (CTL/ATL/TSB
      tiles above the PMC chart). Old routes retired as 308s.
- [x] **`/journal` + `/health` + `/log`'s wellness half → `/body`**: Trends
      against the athlete's own baseline band, Sleep with real stages/
      consistency/chronotype/bedtime, Journal, Labs. Old routes retired
      as 308s.
- [x] **Coach inbox**: `Chat | Inbox · n`, sourced from existing
      morning/weekly/debrief/monthly system-thread messages — no new
      tables. Migration `0024`: one additive column,
      `chat_messages.read_at`.
- [x] **Two URL-driven bottom sheets** (`?sheet=checkin`,
      `?sheet=debrief&activity=…`) replace the inline check-in and debrief
      forms; both push notifications deep-link into them.
- [x] **Menu + activity detail restyled**: collapsed groups carry real
      summary lines; activity detail gets a 3×2 stat grid and an
      emerald-tinted debrief card.
- [x] **Desktop layout**: Today splits 7fr/5fr at `lg+`; sidebar at its
      spec'd 216px with a pinned account row.
- [x] **Duplicate data removed**: PMC chart's own CTL/ATL/TSB readout,
      biological age's double headline, the next race appearing as both a
      chip and a list row.

**Done when:** every screen in the handoff renders from the app's own live
data, on both viewport sizes, with no duplicated figure anywhere on a
single screen. ✅

## ✅ v0.28 — Race-Driven Volume (Phase 1)

Weekly training hours derived from the event you are training for, instead of
a number typed once at plan creation. Spec:
`docs/specs/2026-07-28-race-driven-volume-design.md`. Evidence base and
per-constant confidence: `docs/specs/2026-07-28-training-volume-evidence.md`.

- [x] **Event demand model**: days, distance and climbing (optionally per
      stage) priced into riding hours, then `weeklyHours = totalHours /
(0.60 × days^0.686)`. Multi-day events price **per day** — riders sleep
      between stages — and cumulative cross-day fatigue is deliberately not
      modelled rather than faked.
- [x] **Bounded by measured history in both directions**: ceiling at 1.3×
      the rolling 12-week peak (ACWR safe-zone bound), floor at 0.6× it
      (detraining research). A null ceiling **suppresses** race demand rather
      than being bypassed — no history means no race-driven target.
- [x] **Availability is a ceiling, never a target.** `materializeWeek`
      remains the single place it lowers a week's load, and it says so.
- [x] **Wired into the weekly rollover**: the skeleton is recomputed each
      week rather than read from `training_blocks` as authority.
- [x] **Legibility**: `WeekRationale` surfaces the reasons the engine was
      already logging; `EventReadiness` gives a ready / on-track / tight /
      not-realistic verdict judged on volume **and** longest ride. Informs,
      never blocks.
- [x] **Race form captures the demand** — days, distance, elevation, per-day
      stages — and the races list shows what was stored, with an edit path.
- [x] Migration `0033`: additive only (`races.event_days/distance_km/
elevation_m`, new `race_stages`). Existing rows keep today's behaviour.

**Done when:** a logged event moves the prescribed week, bounded by the
athlete's own history, and the screen explains every number it shows. ✅

**Deliberately deferred to Phase 2** (no plan yet): the workout generator
caps individual sessions, so a week saturates around 9.8h regardless of
target. The engine now emits an adjustment when the generated week falls
short; lifting the cap means the structured-workout-template and
`fitToBlock` rewrite. **The ACWR ceiling is therefore unreachable in practice
today — an accident, not a design, and it becomes load-bearing the moment
those caps are raised.**

**Fast-follows**: a minimum-session-count threshold before trusting a peak as
a capacity signal (one 40-minute ride in 12 weeks currently yields a
ceiling-bound 0.87h target, i.e. more evidence can produce a _lower_ number
than none at all); an FTP sanity floor; a horizon on target-race selection;
and `EventReadiness` / `RaceChip` can name different races (priority-first vs
date-first selection).

## ✅ v0.29 — Next-Week Preview

The planning horizon collapsed to zero every Sunday — nothing showed what
Monday held until the week actually rolled over. Spec:
`docs/specs/2026-07-29-next-week-preview-design.md`. Deferred work and
research notes: `docs/plans/2026-07-29-HANDOFF-next-week-preview.md`.

- [x] **`projectWeek(userId, weekStart, now)`**: one derivation renders any
      week, stored or not, without persisting it. `computeWeekRepair` is now
      a thin caller of the same pipeline it always should have shared; no
      `week_plans` row is ever created for a week that hasn't happened.
- [x] **`/train`'s day list rolls into next week**: today through the end of
      next week, one list, a visible boundary between them. Days before
      today drop off; today never does.
- [x] **The projection assumes this week closes to plan.** It deliberately
      does not react to this week's actuals-so-far — doing so would drift
      the forecast downward early in the week for reasons unconnected to
      anything the athlete decided. Unpinned days render provisional and say
      so; pinned days render firm. It firms up for real at Monday's
      rollover.
- [x] **Availability gets a horizon of its own**: a `This week | Next week`
      switcher (`?availability=next`) edits next week's own resolved
      availability, pinned days, and verdict — not a copy of this week's.
      Submitting a future week writes overrides and replans nothing; only
      the current week's submission replans.
- [x] **The next-week entry point stays reachable all week**, even once this
      week's own availability has frozen (unchanged: this week locks the
      moment it's underway) — an early entry point that disappeared by
      Wednesday would defeat the point of it.

**Done when:** an athlete on Sunday evening can see next week's sessions and
set next week's availability, and neither creates a stored row for a week
that hasn't happened yet. ✅

**Deliberately deferred:** projecting more than one week ahead (each week's
shape depends on how the previous one actually closed, so the assumptions
would stack); editing next week's individual sessions; the replan "fill"
rung that adds training back once availability opens up mid-week;
reconciling a week's plan against load that arrives after it closed; and the
stale-open-week / multiple-active-plan cleanup. See the handoff doc above.

## ✅ v0.30 — Cycling Session Distribution

The weekly hours target has been carefully derived since v0.28 — race demand
bounded by the ACWR ceiling, floored at maintenance — and then the session
generator threw away roughly 30% of it against constants that arrived in a
single 2026-07-15 commit with no rationale, no citation and no test. Spec:
`docs/specs/2026-07-29-cycling-session-distribution-design.md`.

- [x] **Event-relative long-ride bound**: the long ride's cap now derives
      from `queenStageHours` — the hardest single day the athlete's own
      event demands — clamped to a documented 120–360 minute range,
      replacing an unsourced flat 240. No target race or no FTP keeps the
      old 240-minute behaviour exactly, the same "no evidence, no invented
      bound" principle `weeklyTargetHours` already applies to its own
      ceiling.
- [x] **Clamped minutes are redistributed, not dropped**:
      `distributeRemainder` pushes whatever a bound removes onto sessions
      that still have headroom. Intervals and Tempo are excluded from
      this — stretching an intensity session to absorb volume changes what
      the session is.
- [x] **The fix reaches the materialized week, not just the skeleton**:
      `materializeWeek` calls the generator independently, so
      `queenStageHours` had to thread there too — without that the athlete
      would still have seen 240.
- [x] **The next-week preview states what it planned against its target**,
      matching the line `WeekRationale` already renders for the open week.
- [x] **Verified end-to-end** on a real page render: "11.7h planned against
      a 11.8h target," where the same athlete previously saw a 30% gap.

**Done when:** a real 12.5h target produces a real ~12.5h week for an
athlete with a target race. For one without a race, only the long-ride
bound itself is unchanged — still the old 240-minute cap — while
redistribution still schedules more of that athlete's target than before,
since it applies whether or not a race exists. ✅

**Deliberately not touched:** `generateRunningWorkouts` and
`generateTriathlonWorkouts` carry the identical discard-the-remainder
defect. Running's correct rule is athlete-relative (exceeding your own
recent longest run by 10–30% raises injury risk 64% in a study of 5,200+
runners) rather than event-relative, so reusing this release's fix across
sports would repeat the mistake that produced the original bug. See
`docs/plans/2026-07-29-HANDOFF-next-week-preview.md`.

## ✅ v0.37 — The Week Can Grow

Every rung of `replanWeek`'s ladder could only shrink a week — an athlete who
freed up time mid-week got nothing back for it.

- [x] **A fifth rung, fill**, runs last on the settled result of the other
      four: it grows an endurance session into the room its own block
      gained, then adds at most one new endurance session into a free
      admitting block. One availability edit yields at most one new
      session.
- [x] **Bounded by the live `assembleWeeklyTarget` figure** — the same number
      already shown on the dashboard and `/train` — not the stored
      `effectiveTarget`, which goes stale.
- [x] **Endurance only**: intensity is never added or grown. Running never
      gets a long run and swimming is untouched, both because no defensible
      duration bound exists for them yet.
- [x] **Pre-race rest day marked** with `restIntent: "pre_race"` so fill
      leaves it alone — fixing, along the way, a latent gap where the mark
      was never set for A-priority races.

**Done when:** an athlete who clears a block mid-week sees the week grow to
fill it, bounded by the same target figure the app already shows, with
intensity sessions and the taper untouched.

No migrations.

## ✅ v0.38 — The Week's Target Follows the Week

A week's target load was written once, at materialization, and never
updated — but the replan ladder kept reshaping that week all week long, so
the stored number drifted away from the week it described. Three readers
were still trusting it as current: the race-day forecast, the CTL
projection on `/train`, and the taper stat in the race debrief.

- [x] **A new column, `materialized_mins`**, records the week's planned
      minutes alongside the target load already captured at
      materialization, so `effective_target / materialized_mins` is a
      load-per-minute rate fixed to what the week was actually built at.
- [x] **The forecast, the CTL projection, and the taper stat** now derive
      from that rate applied to the week as it stands, so a day's projected
      load depends only on that day's own minutes — not on a frozen total
      redistributed across whatever days happen to remain.
- [x] **Adherence and next week's progression still read the frozen
      target**, deliberately: that number gates the low-adherence safety
      rail, and scoring it against a rate would let a week that shrank
      mid-week read back as fully met.
- [x] **Account import carries the column through** as well, so an
      imported account's weeks are not stranded on the fallback path.

**Done when:** a week containing completed days projects less future load
than before, because future days no longer inherit the load share of days
already completed.

One additive migration, `materialized_mins`, nullable, no backfill.

> **v0.39 through v0.43 have no section here.** They shipped and are recorded
> in `CHANGELOG.md`; the roadmap simply never caught up. Closing that gap is
> its own item — see `docs/specs/2026-08-04-outstanding-work-roadmap.md`.

## ✅ v0.44 — No Training Is Lost

The week of 2026-07-27 closed at a training load of 314 against a real 783.
Load was booked only for yesterday, only for five of `DayStatus`'s seven
members, and only when the activity's sport matched the plan's — so a day
marked done through the app's own "Mark done" button booked nothing at all.

- [x] **One derivation of what happened per local day**, shared by the daily
      adaptation pass, the week close, `/train`, and the repair script,
      replacing two divergent copies of the same query.
- [x] **Booking is status-blind and sport-blind**, and covers every past day
      of the week rather than yesterday alone, so a completed day, a missed
      day, a cross-sport day, a second session and a late-syncing activity all
      book. Whether the planned session happened is now a separate question,
      asked only where it is needed.
- [x] **The close re-derives the week** instead of summing what the day slots
      already held. The final day was not merely racy but unbookable by the
      daily pass, so every week closed with its last day at zero.
- [x] **`scripts/repair-week-actuals.ts`** replays the derivation over stored
      weeks — dry run by default, mandatory user scope, both writes in one
      transaction.

**Done when:** a week the athlete marked done by hand closes at the load they
actually trained, and re-running the pass changes nothing.

No migration; `actual_load` and `unplanned_load` already existed on the day
slot.

**Deliberately still open, carried to v0.45:** whether the planned session
happened is judged once, on the morning that day is yesterday. If the sync has
not settled by then, no later pass asks again.

## ✅ v0.45 — Every number has a source

`periodize()` was the last unsourced engine in the plan pipeline — a 40/30/15
phase split, 8%/7%/2% progression rates, a 60% recovery fraction, and a taper
that decayed two contradicting ways at once, all picked by feel and never
written down. This release does not make the generator smarter; it makes it
honest, fixes three real defects it was hiding, and gives the one
athlete-facing figure that still had no source — the weekly review's load —
the same provenance as the rest of the app.

- [x] **Every constant sourced and CI-enforced**: `src/lib/plan-constants.ts`
      plus `docs/specs/2026-08-06-periodize-evidence.md`, one summary-table
      row and one confidence rating per constant. `plan-constants.test.ts`
      fails CI on an undocumented constant and is deliberately not
      database-gated, so it actually runs on every PR. It proves a constant
      is **named**, not that its value or confidence rating is honest.
- [x] **Recovery cadence survives phase boundaries**: the loading-week
      counter used to reset to zero at every phase change, so a 3-week base
      phase produced six straight loading weeks with no recovery between
      them. Fixed without changing how hard anyone trains — an earlier draft
      also lengthened every mesocycle by a week; caught in review and
      reverted before it shipped.
- [x] **One taper ladder instead of two**: the skeleton's own contradicting
      25%/week load decay (against a separate 0.7→0.6→0.5 hours decay) is
      gone; `periodize()` now reads the same three fractions
      `race/taper.ts` already owns. Closes a double-apply gap along the way,
      in the fallback case with no previous week's actual load and no synced
      CTL.
- [x] **A B or C race's missing taper is recorded, not silent**: a logged
      adjustment names the gap. **Not fixed** — a real B/C mini-taper is
      v0.47's scope.
- [x] **A CTL ramp bound** on the skeleton's week-over-week compounding
      (`CTL_RAMP_PER_WEEK`, floored at `MIN_WEEKLY_LOAD`), measurably
      reachable only from `startingCtl ≈ 68` upward in a real plan length —
      not the algebraic crossover at 50.
- [x] **The weekly review's load figure reads the same calendar-week
      derivation** `rolloverWeekPlan` uses, replacing an ungated rolling
      7-day window. Its CTL delta still compares against the old rolling
      window — one message, two window definitions, not fixed here.
      `actualSessions` keeps two different meanings (activity count in the
      message, plan sessions completed in `training_blocks`) by design; the
      review's own write to `training_blocks` is deleted so there is exactly
      one writer left.
- [x] **The ACWR anchor is downgraded, not the numbers**: `HEADROOM` and
      `RAMP_CLAMP_PCT` keep their values; their confidence drops High → Low
      because the acute:chronic workload ratio they cited doesn't hold up in
      the literature, and `HEADROOM` was never actually an ACWR to begin
      with.
- [x] **`scripts/repair-plan-blocks.ts`** recomputes an active plan's
      not-yet-started weeks against the fixed generator — dry run by
      default, mandatory `--user`/`--all` scope. Weeks already started or
      completed are untouched by design; they back adherence numbers already
      recorded against the old skeleton.

**Done when:** every constant `periodize()` uses carries a source and a
confidence, the recovery cadence and taper no longer contradict themselves,
a runaway skeleton is bounded against the athlete's own CTL trajectory, and
the weekly review's load figure has the same provenance as the number
`/train` already shows.

No migrations.

**Deliberately still open:** the B/C taper gap (recorded, not filled) and
`startingCtl`'s `?? 30` default are both carried to **v0.47**, per the
sequenced roadmap in `docs/specs/2026-08-05-ai-coaching-landscape.md` §9,
which this release does not change. The weekly review's CTL delta reading a
different window than its own load figure is carried to **v0.46**.

## ✅ v0.46 — Demand knows its sport

`eventDemand` priced every event with `estimateRidingHours` — the cycling drag
equation — regardless of what sport the race was, even though `races.sport`
has been a stored, validated enum since v0.42 and nothing on the demand path
read it. A runner with an FTP had their marathon priced as ~1.2 h of cycling
against a real 3–4 h run; a runner without one got `null`, and the whole
race-driven volume feature reverted to a stored constant with no word on any
screen. Closes **F3** and **F7** from the v0.42 audit, plus **F3b**, found
while writing the spec: `longestRideHoursOf` returned the longest activity of
_any_ kind, so a triathlete's marathon readiness was answered by their longest
bike ride.

Demand now dispatches on `races.sport`: cycling unchanged, running through
Riegel's endurance formula against a threshold-pace anchor (set in Settings or
derived from the athlete's own runs), triathlon as swim + bike + run summed
from standard leg distances. An athlete-stated `expected_finish_hours` wins
over all three and needs no anchor. `eventDemand` returns a discriminated
result instead of `null`, so a refusal reaches the screen and the coach as a
sentence naming the fix rather than disappearing into a fallback. Every figure
carries a confidence (high / medium / low) and its reason, from one source, so
`/train` and the coach cannot describe the same number differently.

Migration **0039** adds `body_prefs.threshold_pace_sec_per_km` and
`races.expected_finish_hours`, both nullable and additive-only.

**Named, not fixed:** `LONGEST_RIDE_FRACTION` (0.8) and
`EVENT_TO_WEEKLY_1DAY` (0.6) are both cycling-calibrated and are now applied
to running and triathlon without validation in either sport — recorded at Low
confidence in `docs/specs/2026-08-07-race-demand-evidence.md` rather than
re-derived, because inventing replacements with no better evidence would trade
a documented weak assumption for an undocumented one. A triathlete with no
swim history and no stated finish time gets no figure at all, by design.

Also carried from v0.45: the weekly review's CTL delta now reads the same
calendar week as the load figure beside it in the same sentence.

**Deliberately still open, carried to v0.47:** the B/C taper gap and
`startingCtl`'s `?? 30` default, per
`docs/specs/2026-08-05-ai-coaching-landscape.md` §9.

## ✅ v0.47 — The plan knows how you start

Opening-week planning now reads real starting state and applies explicit safety
branching when form is negative.

- [x] **Start-state provenance** for opening CTL/ATL/TSB.
- [x] **Opening-week form branching** (red/amber/green) with safer first-72h
      workout rules under negative form.
- [x] **Illness comeback mode** with conservative load and intensity caps.
- [x] **B/C race mini-taper behavior** so non-A races no longer rely on silent
      partial reductions.
- [x] **Acceptance matrix suite** and follow-up regression coverage.

Released as tag `v0.47.0` from merged PR #53.

## ✅ v0.48 — The season on one screen

Train gained a Season view that overlays weekly target and actual on one
mobile-first timeline.

- [x] **Season tab** in Train navigation.
- [x] **Target vs actual weekly timeline** using existing week-plans and
      activity-load derivations.
- [x] **Season adherence stat strip** with explicit empty states.
- [x] **Coverage tests** for timeline rendering and chart helpers.

Released as tag `v0.48.0` from merged PR #55.

## ✅ v0.49 — Fuelling Lite

Breadth starts with deterministic, session-aware fuelling guidance that is
advisory only.

- [x] **Shared fuelling engine** (duration + intensity + optional body mass,
      confidence-labeled output).
- [x] **Train session fuelling card** for today's planned sessions.
- [x] **Coach parity**: same engine output exposed in tool responses.
- [x] **Verification gate**: lint, typecheck, tests, build.

Released as tag `v0.49.0` from merged PR #56.

## ✅ v0.50 — Workout export v1

Export breadth now includes deterministic `.zwo` generation for planned bike
sessions.

- [x] **Pure exporter core** for planned bike sessions.
- [x] **Deterministic output contract** (same inputs, byte-identical output).
- [x] **Explicit unsupported-sport refusal path**.
- [x] **Weekly batch helper** with deterministic naming and ordering.
- [x] **Verification gate**: lint, typecheck, tests, build.

Released as tag `v0.50.0` from merged PR #57.

## ✅ v0.51 — Plan styles and blocks

Next breadth release introduces selectable planning style (balanced vs
block-lite) while preserving deterministic safety constraints.

- [x] **Style selector** persisted in plan constraints.
- [x] **Deterministic style-aware week materialization**.
- [x] **No regression in readiness safety precedence**.
- [x] **Verification gate**: lint, typecheck, tests, build.

Design: `docs/specs/2026-08-07-v0.51-plan-styles-and-blocks-design.md`.
Plan: `docs/plans/2026-08-07-v0.51-plan-styles-and-blocks.md`.

## ✅ v0.52 — Off-season mode

Maintenance mode introduces reduced intensity density with explicit staged
re-entry, while preserving deterministic safety precedence.

- [x] **Season mode contract** (`normal` / `off_season`) with explicit
      `reentryStage` state.
- [x] **Deterministic off-season shaping** (quality density caps + session
      count reduction).
- [x] **Explicit re-entry progression** (`week_1` -> `week_2` -> `none`) on
      rollover.
- [x] **Tool/API parity** for setting and reading season mode and re-entry.
- [x] **No regression in safety precedence** (race-day and legality behavior
      preserved).
- [x] **Verification gate**: lint, typecheck, tests, build.

Design: `docs/specs/2026-08-07-v0.52-off-season-mode-design.md`.
Plan: `docs/plans/2026-08-07-v0.52-off-season-mode.md`.

Released as tag `v0.52.0` from merged PR #59.

## ✅ v0.53 — Planning surface parity lock

Stabilization release that locks one shared effective planning-state contract
across tools and UI surfaces, without changing planning algorithms.

- [x] **Shared effective-state resolver** for `effectiveStyle`,
      `effectiveSeasonMode`, and `reentryStage`.
- [x] **Tool parity lock**: `get_week_plan`, `get_training_plan`, and
      `update_training_plan` return consistent effective-state fields.
- [x] **UI parity lock**: Train planning surface consumes the shared resolver
      instead of deriving state independently.
- [x] **No regression in planning behavior**: materialization/adaptation logic
      unchanged; parity only.
- [x] **Verification gate**: format, typecheck, tests, build.

Design: `docs/specs/2026-08-07-v0.53-planning-surface-parity-lock-design.md`.
Plan: `docs/plans/2026-08-07-v0.53-planning-surface-parity-lock.md`.

Released as tag `v0.53.0` from merged PR #61.

## ✅ v0.54 — Plan style quick switch

Expose the existing planning style system directly in Train so athletes can
switch between balanced and block-lite without a coach/tool round-trip.

- [x] **Week surface style chip** in Train showing current effective style.
- [x] **One-tap style switch** from Train with explicit confirmation and
      deterministic response messaging.
- [x] **Immediate week refresh path** so style changes are visible without
      requiring a manual page reload.
- [x] **No planning algorithm change**: materialization rules remain exactly
      the same; this is an access and UX release.
- [x] **Verification gate**: format, typecheck, tests, build.

Design: `docs/specs/2026-08-07-v0.54-plan-style-quick-switch-design.md`.
Plan: `docs/plans/2026-08-07-v0.54-plan-style-quick-switch.md`.

Released as tag `v0.54.0` from merged PR #63.

## ✅ v0.55 — Season mode quick switch

Expose season mode controls directly in Train so athletes can move between
normal training, off-season, and explicit re-entry without leaving the week
surface.

- [x] **Week surface season chip** showing current effective season mode and
      re-entry stage.
- [x] **One-tap season mode switch** in Train using the existing planning
      update path.
- [x] **Explicit re-entry starter** that moves an athlete from off-season
      into `week_1` re-entry.
- [x] **Immediate week refresh path** so season-mode changes are visible
      without a manual reload.
- [x] **No planning algorithm change**: off-season and re-entry shaping stay
      exactly as shipped; this is a Train access release.
- [x] **Verification gate**: format, typecheck, tests, build.

Design: `docs/specs/2026-08-07-v0.55-season-mode-quick-switch-design.md`.
Plan: `docs/plans/2026-08-07-v0.55-season-mode-quick-switch.md`.

Released as tag `v0.55.0` from merged PR #64.

## ✅ v0.56 — Week adjustment quick actions

Expose existing week-level adjustment controls directly in Train so athletes
can ease, boost, or skip the current materialized week without a coach/tool
round-trip.

- [x] **Week action control** in Train for `ease`, `boost`, and `skip`.
- [x] **Open-week targeting** using the current `skeletonWeek` only.
- [x] **Immediate week refresh path** so load adjustments are visible without
      a manual reload.
- [x] **No planning algorithm change**: this only exposes existing
      `update_training_plan` week actions.
- [x] **Verification gate**: format, typecheck, tests, build.

Design: `docs/specs/2026-08-07-v0.56-week-adjustment-quick-actions-design.md`.
Plan: `docs/plans/2026-08-07-v0.56-week-adjustment-quick-actions.md`.

Released as tag `v0.56.0` from merged PR #65.

## ✅ v0.56.1 — Train server-action render hotfix

Patch release restoring production-safe direct server-action wiring in Train
week controls.

- [x] Removed local non-exported async wrappers around form actions in the
      Train server component path.
- [x] Restored direct exported server action usage with void-return submit
      wrappers.
- [x] Revalidated `/train` server render via build and focused control tests.

Released as tag `v0.56.1` from merged PR #67.

## ✅ v0.57 — Deload week quick action

Extend Train week controls with a deterministic deload option that lets
athletes halve current-week load without leaving the week surface.

- [x] **Week action control** adds `deload` alongside existing `ease`,
      `boost`, and `skip`.
- [x] **Open-week targeting** remains constrained to the current
      `skeletonWeek`.
- [x] **Deterministic load rule** sets selected week target load to 50% of
      the current value and records a deload note.
- [x] **Tool/API parity** adds `deload_week` support to
      `update_training_plan` surface and validation.
- [x] **Verification gate**: format, typecheck, tests, build.

Design: `docs/specs/2026-08-07-v0.57-deload-week-quick-action-design.md`.
Plan: `docs/plans/2026-08-07-v0.57-deload-week-quick-action.md`.

Released as tag `v0.57.0` from merged PR #68.

## ✅ v0.58 — Week action freshness guardrails

Protect Train week quick actions from stale-tab submissions so actions never
apply to a week that is no longer open after rollover.

- [x] **Open-week freshness guard** in `setWeekAdjustmentQuick` that
      requires posted week number to match current open `skeletonWeek`.
- [x] **Deterministic stale refusal** with explicit
      `stale_week_adjustment` result when a mismatch is posted.
- [x] **No wrong-week mutation**: stale submissions leave week targets
      unchanged.
- [x] **No planning algorithm change**: reduce/deload/boost/skip behavior for
      fresh submissions is unchanged.
- [x] **Verification gate**: format, typecheck, tests, build.

Design: `docs/specs/2026-08-07-v0.58-week-action-freshness-guardrails-design.md`.
Plan: `docs/plans/2026-08-07-v0.58-week-action-freshness-guardrails.md`.

## Ongoing — operations track

All items scheduled into **v0.17 — Good Self-Hosted Citizen** by the v0.9.6
replan. Anything cheap can still ship earlier alongside any release.
**Closed** — every item shipped in v0.17 (v0.20.0). See that section above.

## Ongoing — honesty debt

Fabrications v0.9.0 found but did not fix. All pre-existing; all the same
defect class as the sleep/energy cards that release cleaned up. **Emptied
by v0.10 — Honest Load**, then reopened by v0.27.0: the same class of defect
recurred somewhere v0.10 never looked.

- [x] **"Last week was fully missed" about a week with 13.9 hours of riding**: the completion matcher compared the plan's `Bike` to the provider's `Ride` with a raw equality and never matched, so `actualLoad` stayed empty and every week closed at zero. The plan then cut the next week to 60% — compounding — while logging a reason that read as fact. Fixed in v0.27.0: one shared sport vocabulary, plus a backfill for days already passed.
- [x] **Weekly hours are a number typed once and never revisited**: `constraints.hoursPerWeek` is set by the coach at plan creation and no code path updates it. Availability can only ever cap it (`Math.min`), so the plan silently ignores the time you offer, and a race carries no demand to derive it from. Fixed in v0.28.0: weekly hours derive from the event being trained for, bounded by measured capacity (ACWR ceiling 1.3× rolling peak, floor 0.6×) and suppressed entirely without history. `constraints.hoursPerWeek` survives only as the fallback for an athlete with no measured ceiling.

- [x] **Recovery & Strain are invented for manual-only athletes**: `recoveryScore`/`strainFraction` came from `latest?.atl ?? 0` / `latest?.ctl ?? 0`, and `atl`/`ctl` were written only by the intervals.icu sync. Fixed in v0.10: native load engine + `calibrating` treatment through `ScoreRing`, `StrainBudget`, and the narrative.
- [x] **"This Week" rings hardcoded**: `ringOuter={0.7}` / `ringInner={0.8}` for every athlete, forever. Fixed in v0.10: real plan/trailing-average targets, rings hidden without one.
- [x] **The logging "streak" is a count, not a streak**: `Math.min(window30.length, 30)` renders "22-day streak" for 22 scattered days. Folded into Achievements (v0.9.4). Fixed in v0.9.4: real consecutive runs on dashboard and journal.
- [x] **Sparklines flat-line on no data**: `sparkPath` returned `"M0 10 L100 10"` for <2 points — a visual claim of stability made from nothing. Fixed in v0.9.1: empty path, no SVG rendered.

## Ongoing — polish backlog

Cheap; pick up alongside any release. The v0.9.6 replan gave most items a
scheduled home. **Fully closed as of v0.20.0** (final-sweep Track 1).

- [x] Data export (GDPR): full history download — the read side of v0.8's import. → v0.17. Closed in v0.17 (v0.20.0) — full-table export plus a matching import path, round-trips losslessly.
- [x] Default journal entries: pre-toggle frequent behaviors so only exceptions get marked. Closed in v0.20.0 — behavioural tags only; subjective sliders (energy/soreness/stress) still write nothing unanswered, per the v0.7 honesty contract.
- [x] Accessibility: ScoreRing aria labels, contrast, button roles. → v0.18. Closed in v0.18 (v0.20.0) — `docs/a11y-sweep-2026-07.md`.
- [x] Performance log filters: wire up the month/sport controls. Closed in v0.20.0 — verified end-to-end against the shared `view/month/range/sport` href-builder v0.19 already wired; no gap found, confirmed with a regression test on the filter href-builder.
- [x] Dead UI sweep: remove non-functional settings controls (v0.9.0 cleared the dashboard's sleep/energy share). Closed in v0.10 — audit found the settings/log/coach/journal controls already wired or removed; the dashboard's fabricated captions were the last stragglers.
- [x] Sleep Score sparkline plotted `sleepSecs` under a "Sleep Score" label — real data, wrong series. Fixed in v0.9.1.

## Ongoing — design & UX

Added by the v0.9.6 replan's UI/UX pass. The visual layer is not the
problem — the structural UX is. The two big items are scheduled (first-run
→ v0.11, desktop shell → v0.12); everything here is the small continuous
kind that never earns its own release. Pick up alongside any release, same
as the polish backlog.

- [x] Empty states: every page says something useful (and honest) when its
      data doesn't exist yet, instead of rendering a blank card. Done for
      the 5 pages v0.19 restructured (dashboard, settings, log, journal,
      coach); closed for the rest of the app (plan, activity, health,
      import) in v0.20.0 — every page now uses the shared `EmptyState`
      primitive
- [x] Loading skeletons: layout-stable placeholders instead of pop-in.
      Done for the same 5 pages v0.19 restructured; closed for the rest in
      v0.20.0 — including a fix for `plan/loading.tsx`'s always-rendered
      add-race bar
- [x] Settings information architecture: one long page currently feeds
      seven action domains (LLM, push, Strava, tokens, body, coach, …) —
      split into sections or sub-pages. → v0.19 (accordion-per-domain) ✅
- [x] Chart consistency: one visual grammar (axes, bands, tooltips, colors)
      across dashboard sparklines, fitness PMC, wellness trends, and coach
      artifacts. v0.19 restyled chart wrappers on log/dashboard; v0.20.0
      closed the item at the scope the final-sweep spec deliberately
      capped it to — one shared token + axis/legend grammar across
      `stream-chart`, `wellness-trends`, `weekly-load-bars`, dashboard
      sparklines, and the coach artifact card (not a full chart-engine
      rewrite; charts stay hand-rolled SVG)
- [ ] Accessibility as-you-go: new UI ships with labels/contrast/focus
      handled, so the v0.18 sweep is a check, not a cliff. Standing
      practice, not a one-time deliverable — stays open by nature; the
      v0.20.0 a11y sweep (`docs/a11y-sweep-2026-07.md`) found the
      commitment had mostly held since v0.19

## Not planned

- **Garmin direct** — no open consumer API; the approval-gated program and unofficial
  scraping libraries are both poor fits for a self-hosted project. Garmin users
  are well served via intervals.icu sync today.
- **Cloud-hosted SaaS version** — Recover is self-hosted on purpose.
- **Nutrition tracking** — out of scope for an endurance recovery app; users already have MyFitnessPal/Cronometer. May integrate read-only nutrition data from Apple Health in a future version if there's demand.
- **Strength Builder / Watch app** — intervals.icu and Garmin/Apple Watch handle workout execution; Recover focuses on recovery intelligence, not workout delivery.
