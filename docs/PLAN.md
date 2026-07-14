# Self-Hosted Health & Training App — "Recover" (working title)

## Context

A free, self-hostable Whoop/Bevel-style app for the owner + up to ~10 friends: one calm dashboard unifying training data (Strava, intervals.icu) with recovery data (HRV, resting HR, sleep), a Whoop-style readiness score, an AI coach chat (BYO LLM — Anthropic API or any OpenAI-compatible endpoint incl. Ollama), and an MCP server endpoint so any user can connect their own Claude (claude.ai connector / Claude Code) to their data. New standalone repo with its own UI identity; proven integration code is ported from the owner's existing KOM-Wars project (`/home/vscode/KOM-Wars`). Docker-first on home hardware; Vercel+Neon stays possible via env-driven config.

**Locked decisions:** greenfield repo · docker-compose (app + Postgres, optional cloudflared) · zero mandatory paid services (no Redis/Inngest/Upstash/Stripe/Sentry) · v1 sources = intervals.icu (primary) + Strava + manual entry; Whoop API & Apple Health are later phases · AI = Vercel AI SDK with `@ai-sdk/anthropic` + `@ai-sdk/openai-compatible`, per-user encrypted keys · Stack = Next.js App Router + TS + Drizzle + Postgres + Tailwind + shadcn + Recharts (matches KOM-Wars conventions for maximal porting).

## Architecture

Two containers: `app` (Next.js standalone) + `db` (Postgres 16 + volume); optional `cloudflared` for ingress. No Redis, no separate worker: background sync runs in-process, started from `instrumentation.ts`, guarded by Postgres advisory locks.

```
intervals.icu ──┐ (pull, cron)              claude.ai / Claude Code
Strava API ─────┤                                  │ (per-user bearer token)
manual entry ───┤                                  ▼
                ▼                            /api/mcp (streamable HTTP)
          sync runner ──► Postgres ◄──── shared tool registry ◄── /api/chat (AI SDK)
          (sync_jobs +    wellness_daily,         ▲                     │
           pg advisory    activities,             │                     ▼
           lock)          daily_metrics     readiness engine    Anthropic / OpenAI-compat
                              │                                 (per-user encrypted creds)
                              ▼
                        Next.js dashboard (Recharts)
```

### Key design decisions
1. **Auth: Better Auth** (email/password + invite-only signup, Drizzle adapter). Strava/intervals.icu are data *connections* (rows in `connections`), never login identity. KOM-Wars' `auth.config.ts` is NOT ported.
2. **Sync: jobs table + in-process poller.** `instrumentation.ts` starts a 60s tick → `pg_try_advisory_xact_lock` (single-runner) → claim due `sync_jobs` with `FOR UPDATE SKIP LOCKED`. Same tick logic also exposed at `POST /api/jobs/tick` guarded by `CRON_SECRET` (the Vercel-cron path). One code path, two triggers; idempotent via `runAfter`.
3. **Strava strategy: intervals.icu as the primary relay.** Friends connect Strava→intervals.icu once and paste an intervals API key (non-expiring, no OAuth quota, includes wellness + precomputed CTL/ATL). Direct Strava OAuth ships in Phase 5, reusing the KOM-Wars Strava app client_id/secret — the callback *domain* on that Strava app gets repointed to the new home domain (existing KOM-Wars tokens keep refreshing; only *new* KOM-Wars OAuth grants would break — acceptable, document it).
4. **Strava AI clause (Nov 2024 API Agreement):** Strava bars feeding its API data to AI models and requires attribution. Mitigation: tag provenance per row (`source` column); rows with `source='strava'` are excluded from AI-coach/MCP context by default; "Powered by Strava" attribution where Strava data renders.
5. **Ingress: cloudflared tunnel** to owner's domain — covers friends' browsers, Strava OAuth callback/webhooks, and claude.ai MCP connector, with free TLS and no port forwarding. MCP uses per-user bearer tokens, so no IP allowlisting needed (unlike the old nginx intervals-mcp deploy). Fallback: Tailscale Funnel.

## Repo layout

```
src/
  app/                     # (dashboard)/, activities/, coach/, settings/, admin/
    api/chat/route.ts      # AI SDK streamText + shared tools
    api/mcp/route.ts       # @modelcontextprotocol/sdk streamable HTTP, bearer auth
    api/jobs/tick/route.ts # CRON_SECRET-guarded tick (Vercel path)
    api/connections/strava/callback/route.ts
  lib/
    db/          # index.ts (dual-driver, ported verbatim), schema.ts, migrations
    auth.ts      # Better Auth config
    connectors/  # intervals.ts (port), strava.ts (port), strava-token.ts (adapt)
    sync/        # tick.ts, jobs.ts, intervals-sync.ts, strava-sync.ts
    readiness/   # baselines.ts, score.ts
    tools/       # registry.ts + one file per tool — SINGLE source for MCP + AI coach
    ai/          # provider.ts (per-user Anthropic | OpenAI-compatible resolution)
    crypto.ts    # ported verbatim
  components/
instrumentation.ts · docker-compose.yml · Dockerfile
```

**Keystone: the tool registry.** Each tool = `{ name, description, inputSchema (zod), execute(ctx: {userId, db}) }`. The MCP route serves them via JSON-schema conversion; the chat route passes the same objects to AI SDK `tools:`. ~8–10 v1 tools: `get_wellness`, `get_readiness`, `get_readiness_history`, `list_activities`, `get_activity`, `get_fitness_summary`, `get_athlete_profile`, `log_wellness`. (Naming/response-size discipline modeled on `/home/vscode/intervals-icu-mcp/src/intervals_icu_mcp/tools/`.)

## Core schema (~13 tables)

- `users`, `sessions`, `accounts`, `verifications` — Better Auth (+ `role: owner|member`)
- `invites` — code, email, invitedBy, expiresAt, usedByUserId
- `connections` — userId, provider (`intervals_icu|strava`), encrypted credentials, externalAthleteId, expiresAt, status, lastSyncAt; unique (userId, provider)
- `activities` — userId, provider, externalId, startDate, sport, name, durationS, distanceM, load/tss, avgHr, avgPower, `raw jsonb`; `source` provenance
- `activity_streams` — activityId, type (hr/watts/velocity/altitude/time), `data jsonb` (lazy fetch)
- `wellness_daily` — userId + date (unique), hrvMs, restingHr, sleepSecs, sleepScore, ctl, atl, weightKg, energy1_10, soreness1_10, stress1_10, source (`intervals|manual|strava`), `raw jsonb`
- `daily_metrics` — userId, date, readiness 0–100, band, componentScores jsonb, hrv/rhr baseline mean+sd, tsb, computedAt
- `chat_threads`, `chat_messages` (role, content, toolCalls jsonb)
- `api_tokens` — userId, tokenHash (sha256, plaintext shown once), label, lastUsedAt
- `llm_settings` — userId, providerType, baseUrl, encryptedApiKey, model
- `sync_jobs` — userId, provider, kind, runAfter, status, attempts, lastError

## Readiness score v1

Baseline = trailing 60 days (minimum 14 to score; below that show "calibrating"). rMSSD is log-normal → use `ln` for HRV z-scores.

- **HRV (weight 0.40):** `z = (ln(hrv) − mean₆₀(ln hrv)) / sd₆₀(ln hrv)` → `score = clamp(50 + 20z, 0, 100)`
- **RHR (0.25, inverted):** `z = (mean₆₀ − rhr_today) / sd₆₀` → same mapping
- **Sleep (0.20):** provider sleepScore if present, else port `normalizeSleep(hours)` curve from KOM-Wars
- **Load/TSB (0.15):** `TSB = CTL − ATL` (conventional sign!) → `score = clamp(50 + 2.5·TSB, 10, 90)` — capped so tapering can't mask poor HRV

`readiness = Σ(wᵢ·scoreᵢ) / Σ(wᵢ over available components)`; bands: green ≥ 67, amber 34–66, red < 34. Store the component breakdown in `daily_metrics.componentScores` — feeds both the UI ring and the coach's `get_readiness` tool.

⚠️ Do NOT port `calculateReadiness`'s training-load handling from KOM-Wars `readiness-scoring.ts:32-34` — its CTL/ATL labels are swapped and its comment defines `TSB = ATL − CTL` (inverted sign). (Separate fix task spawned for KOM-Wars itself.)

## Port / adapt / skip (from /home/vscode/KOM-Wars)

| Action | Files |
|---|---|
| Port verbatim | `src/lib/crypto.ts`; `src/lib/db/index.ts` (dual-driver proxy); `src/lib/strava.ts` API wrappers; `src/lib/connectors/intervals-icu.ts` (`validateKey` + wellness fetch; drop the EnhancedWearableConnector half); `normalizeSleep`/`normalizeSubjective` from `readiness-scoring.ts` |
| Adapt | `src/lib/strava-auth.ts` (Redis lock → `pg_try_advisory_xact_lock`; user columns → `connections` table); `src/lib/inngest/intervals-sync.ts` (extract `runIntervalsSyncForUser` logic into jobs runner, drop Inngest); Strava webhook route pattern (later phase); chart theming |
| Skip | `auth.config.ts`, redis/Upstash, Inngest client, Sentry/Stripe/entitlements, the 70-table schema, all competitive/social features |

## Phases

**P1 — Solo intervals.icu dashboard** (immediate owner value): scaffold, docker-compose, Better Auth with seeded owner account, intervals API-key connection, manual "sync now", ingest wellness_daily + activities, dashboard charts.
*DoD:* owner's real HRV/RHR/sleep/CTL render from live intervals.icu, running in Docker at home. *Verify:* cross-check 5 dates against intervals.icu web UI.

**P2 — Readiness engine + scheduled sync:** baselines, daily_metrics, readiness ring + 30-day trend, manual wellness form, sync_jobs + instrumentation tick + `/api/jobs/tick`.
*DoD:* score appears each morning unattended for 3 straight days. *Verify:* unit-test formula on fixtures; hand-verify one day's z-scores against stored componentScores; kill/restart container mid-sync to prove lock safety.

**P3 — AI coach:** llm_settings (encrypted BYO key/baseURL), tool registry, streaming chat with threads.
*DoD:* "Should I train hard today?" answered with tool-cited readiness on BOTH Anthropic API and local Ollama. *Verify:* inspect persisted toolCalls; swap provider mid-thread.

**P4 — MCP endpoint + ingress:** `/api/mcp` (streamable HTTP, same registry), api_tokens settings page, cloudflared tunnel + domain.
*DoD:* claude.ai custom connector AND Claude Code both list tools and answer from owner data over the public URL. *Verify:* MCP inspector; revoked token → 401.

**P5 — Multi-user + direct Strava:** invites, admin page, per-user isolation, staggered sync, Strava OAuth (callback-domain repoint executed; Strava rows AI-excluded by default + attribution).
*DoD:* one real friend onboards via invite, connects intervals, sees only their data. *Verify:* two-account isolation test across web + MCP tokens.

**P6 — Depth + ops:** activity detail with lazy stream charts, own TSS/EMA fallback for users without intervals, nightly `pg_dump` sidecar + restore drill, `/api/health` (reports last tick), documented Vercel+Neon deploy proof (`DATABASE_DRIVER` swap).
*DoD:* real ride renders power/HR streams; backup restores into a fresh container. *(P7+: Whoop API, Apple Health import — new `connections` providers.)*

## Risks

- **Strava AI/display ToS** — mitigated via intervals-relay-first + provenance tagging + default AI exclusion of Strava rows.
- **Strava rate limits** (~200/15min, 2k/day shared across the app): hourly summary polling with jitter ≈ 264 req/day for 11 users — fine; streams strictly lazy.
- **Neon-http driver has no transactions/session state** → advisory-lock + SKIP LOCKED paths are pg-driver-only (guard on `DATABASE_DRIVER`); Vercel tick processes one job per invocation. Integration tests run against real Postgres.
- **In-process cron dies with the container** → jobs are idempotent by `runAfter`; `/api/health` exposes last-tick age.
- **Callback repoint breaks *new* KOM-Wars Strava sign-ins** — accepted, documented.

## Verification (overall)

Each phase gates on its DoD with the owner's live intervals.icu/Strava accounts. Unit tests: readiness math, token encryption round-trip, job claiming. Integration: docker-compose up from clean volume → migrate → seed owner → sync → dashboard renders. P4 verified with real claude.ai connector + Claude Code session against the tunnel URL.
