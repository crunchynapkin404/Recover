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

## v0.4 — Coach & MCP depth

The coach stops waiting to be asked.

- [ ] Proactive weekly review: scheduled job → coach-written summary
- [ ] Overtraining warnings on sustained HRV suppression / RHR spikes
- [ ] Extended MCP tools: power/pace curves, best efforts, load summaries
- [ ] Coach memory: durable profile facts across threads

**Done when:** the weekly review arrives without being asked; new tools usable from claude.ai.

## v0.5 — Data-source freedom

intervals.icu stops being a hard requirement.

- [ ] Manual-first onboarding: fully usable with zero integrations
- [ ] CSV import for wellness history
- [ ] Apple Health: file-export upload + Health Auto Export-style webhook

**Done when:** a user with no intervals.icu account gets a readiness score.

## v0.6 — Wearable connectors

- [ ] Whoop OAuth (recovery, HRV, sleep)
- [ ] Oura OAuth
- [ ] Fitbit — if demand shows up

**Done when:** HRV/sleep flows in from a real Whoop or Oura account with full data isolation.

## Ongoing — operations track

Small chunks, shipped alongside feature phases.

- [ ] Nightly `pg_dump` backup + documented restore drill
- [ ] Sync-jobs admin UI
- [ ] Vercel + Neon deployment guide refresh

## Not planned

- **Garmin** — no open consumer API; the approval-gated program and unofficial
  scraping libraries are both poor fits for a self-hosted project. Garmin users
  are well served via intervals.icu sync today.
- **Cloud-hosted SaaS version** — Recover is self-hosted on purpose.
