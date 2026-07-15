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

## v0.5 — Training Intelligence

AI-generated structured training — the feature no WHOOP/Bevel competitor has with intervals.icu data.

- [ ] **Training Plan Generation**: periodized multi-week plans from current CTL + target race date; stored as structured blocks in DB; coach tracks progress weekly
- [ ] **Calendar Integration**: OAuth to Google Calendar; coach knows busy times and adjusts training suggestions ("You have meetings until 18:00 — I'd suggest an evening zone-2 ride")
- [ ] **Artifacts**: coach can output inline SVG charts in chat (HRV trends, load vs recovery correlations, PMC projections) — rendered client-side from structured tool output
- [ ] **Proactive Weekly Review**: scheduled job generates coach-written weekly summary comparing planned vs actual load, recovery trends, and next-week outlook

**Done when:** a training plan is generated from a race goal; calendar blocks are visible to the coach; inline charts render in chat; weekly review arrives automatically.

## v0.6 — Body Intelligence

Longer-term health metrics that keep users engaged beyond the daily score.

- [ ] **Energy Bank / Body Battery**: cumulative daily energy curve derived from morning readiness + intraday strain; depletes with training load, partially recovers with rest; displayed as the existing BodyBatteryCurve component with real data
- [ ] **Biological Age**: weekly score calculated from RHR baseline trend, HRV percentile-for-age, sleep consistency, VO2max estimate (from intervals.icu), body composition; 20-year projection chart
- [ ] **Health Records**: upload blood test PDF/photo → LLM extracts biomarkers → stored in a `biomarkers` table; enriches readiness model and biological age calculation
- [ ] **Blood Pressure**: manual entry or auto-import; tracked in a biology/vitals section

**Done when:** energy bank shows a real intraday curve; biological age updates weekly; a blood test PDF is parsed and biomarkers appear in the app.

## v0.7 — Journal Evolution

Make the daily check-in smarter with less manual input.

- [ ] **Auto-tags from activity data**: detect "Hard session", "Double day", "Rest day", "Late training" from intervals.icu and inject into journal without manual entry
- [ ] **Sleep debt + bedtime targets**: show recommended bedtime based on accumulated sleep debt + tomorrow's planned training intensity
- [ ] **Default entries**: pre-toggle frequent behaviors so user only marks exceptions (Bevel's "set default entries" pattern)
- [ ] **Correlation engine V2**: factor in time-of-day, distinguish weekday/weekend patterns, show confidence intervals on impact scores

**Done when:** auto-tags appear without user input; bedtime recommendation shows on the journal page; defaults reduce daily tap count.

## v0.8 — Data-source freedom

intervals.icu stops being a hard requirement.

- [ ] Manual-first onboarding: fully usable with zero integrations
- [ ] CSV import for wellness history
- [ ] Apple Health: file-export upload + Health Auto Export-style webhook
- [ ] Google Health / Fitbit connector (if demand materializes)

**Done when:** a user with no intervals.icu account gets a readiness score.

## v0.9 — Wearable connectors

- [ ] Whoop OAuth (recovery, HRV, sleep)
- [ ] Oura OAuth
- [ ] Fitbit direct — if demand shows up

**Done when:** HRV/sleep flows in from a real Whoop or Oura account with full data isolation.

## Ongoing — operations track

Small chunks, shipped alongside feature phases.

- [ ] Nightly `pg_dump` backup + documented restore drill
- [ ] Sync-jobs admin UI
- [ ] Vercel + Neon deployment guide refresh

## Not planned

- **Garmin direct** — no open consumer API; the approval-gated program and unofficial
  scraping libraries are both poor fits for a self-hosted project. Garmin users
  are well served via intervals.icu sync today.
- **Cloud-hosted SaaS version** — Recover is self-hosted on purpose.
- **Nutrition tracking** — out of scope for an endurance recovery app; users already have MyFitnessPal/Cronometer. May integrate read-only nutrition data from Apple Health in a future version if there's demand.
- **Strength Builder / Watch app** — intervals.icu and Garmin/Apple Watch handle workout execution; Recover focuses on recovery intelligence, not workout delivery.
