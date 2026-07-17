<p align="center">
  <img src="public/logo.svg" width="88" alt="Recover logo">
</p>

<h1 align="center">Recover</h1>

<p align="center"><b>Your training and recovery, in one calm place — self-hosted and free.</b></p>

<p align="center">
  <a href="https://github.com/crunchynapkin404/Recover/actions/workflows/ci.yml"><img src="https://github.com/crunchynapkin404/Recover/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/crunchynapkin404/Recover/releases"><img src="https://img.shields.io/github/v/release/crunchynapkin404/Recover" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License: AGPL-3.0"></a>
</p>

<p align="center">
  <img src="docs/screenshots/dashboard.png" width="24%" alt="Dashboard with readiness score">
  <img src="docs/screenshots/coach.png" width="24%" alt="AI coach chat citing real metrics">
  <img src="docs/screenshots/log.png" width="24%" alt="Performance log with training stress balance">
  <img src="docs/screenshots/journal.png" width="24%" alt="Behavior journal with wellness sliders">
</p>

Recover is a health and training companion you run on your own
hardware: readiness scoring, training load, a behavior journal, and an AI coach
— without the subscription, the wearable lock-in, or anyone else holding your
data. Start with **manual entry alone**, import a CSV, or connect
intervals.icu / Strava — your choice. Recover computes a daily readiness score
from _your_ personal baselines — not population norms — and shows it on one
calm dashboard.

## Your Claude, your training data

The part we care most about: Recover ships a **built-in MCP server**, so
claude.ai, Claude Code, or any MCP client can read your readiness, wellness,
and training load with a scoped, revocable token.

> **You:** How has my week been? Should I still do intervals tomorrow?
>
> **Claude** _(via your Recover MCP connector)_: Your readiness is 66 (amber)
> — HRV 63.8 ms against a 65 ms baseline, TSB −1.9 after Saturday's long ride…

The in-app coach uses the same tools with your own LLM key — Anthropic, or any
OpenAI-compatible endpoint including a fully local Ollama. Keys are encrypted
(AES-256-GCM) in your database; nothing phones home.

## Features

- **Readiness score** from 60-day rolling personal baselines: HRV (40%),
  resting HR (25%), sleep (20%), form/TSB (15%) — with an honest
  "calibrating" state until enough history exists, and a component breakdown
  explaining every score.
- **Data freedom** — no integrations required. Log HRV, resting HR, sleep, and
  activities manually; import CSV data from any source (Apple Health, Garmin,
  Whoop, spreadsheets); or connect intervals.icu / Strava for automatic sync.
  Your readiness score unlocks after 14 days of data regardless of source.
- **intervals.icu sync** — wellness, activities, and training load, kept fresh
  by an in-process scheduler. **Strava OAuth** as a second source, with
  provenance tracking (Strava data is excluded from AI context by default, per
  Strava's API terms).
- **Analytics depth** — open any activity for stream charts (HR, power, pace,
  elevation) and laps; track fitness with CTL/ATL/TSB over 30–365 day ranges;
  watch HRV, resting HR, and sleep trend against your personal baselines.
- **Living week plan** — your training plan materializes into a concrete,
  adaptive week: set which days you're available, let poor readiness move or
  shrink sessions instead of pretending the plan still fits, and track
  planned-vs-actual drift. One tap on `/plan` starts the week.
- **Deeper insights** — the journal correlates behaviors against next-day
  readiness with honest 95% confidence intervals: manual tags plus auto-tags
  derived from your activities (hard sessions, double days, rest days,
  morning/late training), weekday/weekend splits, and rows that say
  "inconclusive" instead of asserting an impact the data can't back. Plus
  real logging streaks (consecutive runs, not counts) and sober milestones.
- **AI coach** — evidence-based endurance-coach persona that cites the actual
  numbers from your data, adapts its tone to your readiness band, and refuses
  to program through injury or illness. BYO key: Anthropic or any
  OpenAI-compatible endpoint (Ollama included). Features:
  - **Coach Memory** — persistent knowledge store (goals, injuries, race calendar) injected into every conversation
  - **Thinking Modes** — Quick (haiku/flash) or Deep (opus/sonnet) per message
  - **Proactive Insights** — morning message generated from overnight sync data, visible on dashboard
  - **Ghost Mode** — ephemeral threads that auto-purge after 24h
  - **Personalities** — Analytical, Encouraging, or Direct tone presets
  - **Overtraining Warnings** — automatic alerts on sustained HRV suppression or RHR spikes
  - **Training plans** — periodized multi-week plans from your current fitness and a target race date; the coach tracks planned-vs-actual load each week
  - **Calendar awareness** — optional Google Calendar (FreeBusy) so suggestions fit around work and life
  - **Artifacts** — the coach can draw inline SVG charts (HRV trends, load vs recovery, PMC) right in the chat
  - **Weekly review** — a proactive written summary comparing this week's load and recovery to last week
- **Strava AI descriptions** — opt-in write-back that appends an emoji-rich
  metrics block (load, IF, TRIMP, form, PRs — from intervals.icu data only)
  below a separator on your Strava activities. Strava-sourced data is never
  fed to the AI coach or MCP, per Strava's API terms.
- **MCP server** — stateless streamable-HTTP endpoint at `/api/mcp` with
  hashed, scoped (`read` / `write:wellness` / `write:plan` / `write:memory` /
  `write:strava`), revocable bearer tokens and rate limiting. 24 tools:
  readiness (+ history), wellness, log-wellness, fitness & training-load
  summaries, power/pace curves, best efforts, activity list & detail, athlete
  profile, planned workouts, calendar availability, coach memory
  (remember/forget), chart rendering, training-plan generate/get/update,
  Strava description write-back, and the living week (get plan / set
  availability / drift).
- **Installable PWA** — add it to your phone's home screen; a push
  notification delivers your readiness score every morning, and
  pull-to-refresh or the sync chip pulls fresh data on demand.
- **Behavior journal** — mood, energy, soreness, stress, tags, and notes
  alongside synced vitals.
- **Multi-user, invite-only** — built for one owner and a handful of friends,
  with complete data isolation.
- **Boring operations** — one app container plus Postgres. No Redis, no queue,
  idempotent sync jobs, health endpoint, migrations applied automatically on
  boot.

## Quickstart

```bash
git clone https://github.com/crunchynapkin404/Recover.git
cd Recover
cp .env.example .env   # then set ENCRYPTION_KEY, BETTER_AUTH_SECRET, OWNER_EMAIL, OWNER_PASSWORD
docker compose up -d
```

Open http://localhost:3000, sign in with your owner credentials, and start
logging — or connect intervals.icu under **Settings** for automatic sync.
Details, tunnel setup, upgrading, and troubleshooting:
[docs/SELF-HOSTING.md](docs/SELF-HOSTING.md).

Want to poke around without real data? `SEED_DEMO=1 npm run db:seed-demo`
fills a demo account with 90 days of plausible training history (see
[CONTRIBUTING.md](CONTRIBUTING.md)).

## Connect Claude

1. **Settings → MCP API Tokens** → create a token (shown once).
2. Expose your instance (Cloudflare tunnel profile is built in) or use it on
   your LAN.
3. Add a custom connector in claude.ai (or `claude mcp add --transport http`)
   pointing at your instance's `/api/mcp` endpoint with the token as a bearer
   token.

**Live demo instance:** [recover.bartabraas.nl](https://recover.bartabraas.nl/) 4. Ask Claude about your training.

## Status & roadmap

**Current release: v0.9.4 — Deeper Insights.** The v0.9 series made the app
honest and adaptive: v0.9.0 deleted every metric the data couldn't back,
v0.9.2–0.9.3 turned static training plans into a living week that adapts to
your availability and readiness, and v0.9.4 added auto-tags, correlation
insights with real confidence intervals, and true logging streaks. All on
top of the full stack: manual entry and CSV import, intervals.icu sync,
readiness scoring, dashboard, journal, analytics depth, installable PWA
with morning push, AI coach with memory/personalities/proactive insights,
training plans, Google Calendar awareness, chart artifacts, weekly reviews,
Strava AI descriptions, and 24 MCP tools. Next up: infrastructure hardening
(v0.9.5 — nightly backups), deep biology (v0.10 — blood work, biological
age), and wearable connectors (v0.11 — Whoop, Oura). The full plan lives in
[docs/ROADMAP.md](docs/ROADMAP.md).

An honest hobby project built for one owner and about ten friends. If it's
useful to you, self-host it and make it yours. Issues and PRs welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Stack

Next.js 16 · TypeScript · Postgres + Drizzle · Better Auth · Tailwind + shadcn
· hand-rolled SVG charts · Vercel AI SDK · @modelcontextprotocol/sdk

## License

AGPL-3.0 — see [LICENSE](LICENSE).
