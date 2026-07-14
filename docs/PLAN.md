# Recover — Definitive Plan (v3: post-audit roadmap)

## Status & audit — 2026-07-14

P0–P2 shipped with CI green. P3 (AI coach) and P4 (MCP endpoint) were then built in a separate session and pushed. A full audit of those commits against this plan found solid mechanics (55/55 tests, clean typecheck/build, migration present, persona faithful, keys encrypted) **but the phase gates were not honored** — the defects below block P5. A large uncommitted UI redesign (dark glassmorphic theme, journal/log pages, bottom nav) is also in the working tree with its own fix list.

**Nothing new starts until P4R (remediation, below) is done.**

### Blocking defects found

1. **MCP endpoint unreachable** — `src/proxy.ts` doesn't exclude `/api/mcp` (or `/api/cron`), so bearer requests without a session cookie 307-redirect to `/login` before the handler runs. Verified live. The P4 DoD (claude.ai + Claude Code connect end-to-end) can't have been run.
2. **Scope enforcement is dead code** — the only scope check guards a `log_wellness` tool that doesn't exist in the registry; `read` is never checked. Any valid token can call every tool.
3. **Ollama coach path has no tools** — chat route passes tools only for `providerType === "anthropic"`; the OpenAI-compatible path answers from nothing (P3 DoD "cites real numbers on local Ollama" unmet). Chat also duplicates tool wiring by hand instead of consuming the registry through one path.
4. **Registry incomplete** — 6 of 9 planned tools (`log_wellness`, `get_activity`, `get_training_load_summary` missing).
5. **Journal silent data loss** — the new journal form collects mood, behavior tags, and notes but never persists them (mood/tags never enter FormData; notes stripped by the zod schema); sleep/stress inputs the action supports aren't in the form.
6. **Hygiene** — `cookies.txt` with a live session token was in the repo root (deleted, now gitignored); Postgres published on host port 5434; `trustedOrigins`/`allowedDevOrigins` hardcode a LAN IP instead of env config.
7. **Dead/fake UI** — settings appearance/push/export/edit-profile controls, coach mic, journal media buttons, log-page month/filter controls are non-functional; log page renders hardcoded fake PMC/load SVGs as if they were data.
8. **Accessibility regressions** — new ScoreRing lost `role="img"`/aria-label; emoji-as-button controls without accessible names; push "toggle" is a plain div; `text-white/20–/40` labels fail contrast on `#0a0a0a`.
9. **Missing P4 tests** — revoked token→401, missing-scope rejection, cross-user isolation, auth-before-handleRequest ordering.
10. **Security-review gate skipped** — required before exposure; still not run.

### P4R — Remediation (the only active phase)

Fix in this order: (a) proxy matcher excludes `/api/mcp` + `/api/cron` **with regression tests**; (b) implement `log_wellness`, `get_activity`, `get_training_load_summary`; enforce scopes in dispatch (+ the four missing security tests); (c) one registry→AI-SDK path shared by chat and MCP, tools wired for OpenAI-compatible providers (prefer `@ai-sdk/openai-compatible`), verify on real Ollama; (d) journal: persist mood/tags/notes (schema migration: add `mood`, `tags jsonb`, `notes` to wellness_daily) or remove the controls; add sleep/stress inputs; (e) infra: unpublish db port (or bind 127.0.0.1), env-driven trusted origins; (f) remove or wire every dead control, replace fake log-page SVGs with real `daily_metrics`/`activities` data; (g) restore aria labels + fix contrast; (h) purge orphaned components (old wellness-form, unused charts) — or delete the redesign pieces not worth keeping; (i) run `/security-review`; only then commit the redesign and proceed to tunnel exposure + P5.

**P4R DoD:** claude.ai connector *and* Claude Code list tools and fetch readiness through the tunnel; Ollama coach cites real numbers; scope/isolation/regression tests green; zero non-functional controls; security review passed.

---

## Vision

Recover is a free, self-hostable alternative to Whoop/Bevel-style recovery apps: one calm dashboard unifying training load with recovery signals (HRV, resting HR, sleep), built for an owner plus roughly ten invited friends. It runs on your own hardware with `docker-compose up` (app + Postgres, optional Cloudflare tunnel); a Vercel + Neon deployment stays possible via env-driven config. Zero mandatory paid services. AGPL-3.0.

Data arrives from intervals.icu (primary source: wellness + activities + precomputed CTL/ATL), later directly from Strava, and from manual entry. A daily readiness score is computed against _your own_ rolling baselines — not population norms — with an honest "calibrating" state until enough history exists.

Two AI surfaces sit on the same foundation: an in-app coach chat using your own LLM key (Anthropic, or any OpenAI-compatible endpoint including local Ollama — encrypted per user), and a built-in MCP server: a **bridge between your Claude and your training data**, so claude.ai or Claude Code can query your readiness directly.

## Principles

1. **No broken imports.** Code is never copied from other projects on trust. The three files already ported from KOM-Wars (`src/lib/crypto.ts`, `src/lib/db/index.ts`, `src/lib/connectors/intervals.ts`) stay only if P0 lands unit tests proving them. Everything else suspect is rewritten from scratch: the readiness engine (KOM-Wars' has an inverted TSB sign), the Strava layer (Redis-coupled token refresh), the logger (trivial, ~30 lines). The P6 PWA port arrives with tests or not at all.
2. **One tool registry, two consumers.** Every data capability is a `{name, description, zod inputSchema, execute({userId, db})}` object serving both the AI coach and the MCP endpoint. New capability = one file.
3. **Provenance everywhere.** Every activity/wellness row records its source; Strava rows are excluded from AI contexts by default.
4. **Boring operations.** One container + Postgres. No Redis, no external queue. Idempotent jobs; health endpoint exposes staleness.
5. **Secrets encrypted at rest** (AES-256-GCM), decrypted per request, never logged.

## Architecture

Next.js 16 (App Router) + Drizzle + Postgres 16. Background sync runs in-process: `instrumentation.ts` starts a tick loop that takes a pg advisory lock (single runner) and claims due rows from `sync_jobs`; a `CRON_SECRET`-guarded `/api/cron` route offers the same tick for serverless deployments. The db layer is dual-driver (`DATABASE_DRIVER=pg` for node-postgres, otherwise Neon HTTP); advisory-lock paths are pg-only.

```text
intervals.icu ──┐ (pull, scheduler)          claude.ai / Claude Code
Strava (P5) ────┤                                   │ (per-user bearer token)
manual entry ───┤                                   ▼
                ▼                            /api/mcp (streamable HTTP)
          sync runner ──► Postgres ◄──── shared tool registry ◄── /api/chat (AI SDK)
          (sync_jobs +    wellness_daily,          ▲                     │
           pg advisory    activities,              │                     ▼
           lock)          daily_metrics      readiness engine   Anthropic / OpenAI-compat
                               │                                (per-user encrypted keys)
                               ▼
                     Next.js dashboard (Recharts)
```

## Data model (15 tables, already migrated)

- **Auth (Better Auth):** `users` (role owner|member), `sessions`, `accounts`, `verifications`; `invites` for closed signup.
- **Integrations:** `connections` — one row per user+provider, encrypted tokens, athlete identity, sync status.
- **Training:** `activities` (provider ∈ intervals_icu|strava|manual doubles as provenance; unique per user+provider+externalId), `activity_streams` (jsonb per stream type).
- **Wellness:** `wellness_daily` — HRV (rMSSD), resting HR, sleep secs/score, CTL/ATL, eFTP, weight, subjective energy/soreness/stress (1–10), source.
- **Derived:** `daily_metrics` — readiness, band, `component_scores` jsonb, baselines, TSB.
- **Coach:** `chat_threads`, `chat_messages`; `llm_settings` (anthropic | openai_compatible, encrypted key, model).
- **MCP:** `api_tokens` (SHA-256 hash, label, revoked_at; **P4 adds `scopes` + lookup-prefix columns by migration** — they don't exist yet).
- **Jobs:** `sync_jobs` (backfill|incremental|compute_metrics, run_after, status, attempts).

## Readiness formula (v1, from scratch)

60-day rolling personal baselines; <14 days of data → band `calibrating`, no number shown.

| Component  | Basis                                    | Weight |
| ---------- | ---------------------------------------- | ------ |
| HRV        | z-score of ln(HRV) vs baseline           | 0.40   |
| Resting HR | inverted z-score                         | 0.25   |
| Sleep      | provider sleepScore, else duration curve | 0.20   |
| Form       | TSB = CTL − ATL                          | 0.15   |

z-components → `clamp(50 + 20z, 0, 100)`; TSB → `clamp(50 + 2.5·TSB, 10, 90)`. Missing components renormalize remaining weights. Bands: green ≥ 67, amber 34–66, red < 34. Component breakdown persists to `daily_metrics.component_scores` so UI and coach can explain every score.

## Coach persona (fixed)

Evidence-based endurance coach that cites the actual numbers returned by its tools. Tone adapts to the readiness band; in the red band it never prescribes intensity. No medical diagnoses; refuses to program through injury/illness; on sustained HRV suppression (>7 days) or resting-HR spikes says "consider seeing a professional." Admits when data is missing rather than guessing. Per-thread memory only; user profile from settings interpolated into the system prompt.

## MCP design

`@modelcontextprotocol/sdk` — **must be added as a direct dependency** (currently only transitive via shadcn) — `WebStandardStreamableHTTPServerTransport`, stateless per-request, in `POST /api/mcp`. Bearer auth resolved _before_ `handleRequest`; SDK `AuthInfo` carries userId/scopes into every tool. Tokens: plaintext shown once, SHA-256 + short lookup prefix, scoped `read` | `write:wellness`, revocable. Rate limiting: in-memory token bucket on `/api/mcp`; Better Auth built-in `rateLimit` on auth routes. Nine v1 tools: `get_athlete_profile`, `get_wellness`, `log_wellness`, `get_readiness`, `get_readiness_history`, `get_fitness_summary`, `list_activities`, `get_activity`, `get_training_load_summary`.

## Phases

**P0 — Bootstrap & hygiene.** Fix `src/app/page.tsx:66` (`asChild` → base-ui `<Button render={<Link href="/settings" />} nativeButton={false}>`); package.json scripts (`db:generate`, `db:migrate`, `db:studio`, `typecheck`, `test`, `format`); Vitest + Prettier; ~30-line structured JSON logger from scratch; `/api/health` (db ping + last-sync age); GitHub Actions CI (lint/typecheck/test/build; run `gh auth refresh -s workflow` first — current token lacks the scope); branch protection. **Tests (Principle-1 gate):** crypto round-trip + tamper/wrong-key rejection; intervals connector fixtures **pinning the two found defects** (UTC `ymd()` off-by-one for non-UTC users; empty `date:""` when a wellness row lacks `id`) — fix both; db/index via integration test. **DoD:** CI green on main.

**P1 — Docker, from scratch.** Rewrite the broken Dockerfile (references nonexistent files, ships drizzle-kit): multi-stage build (standalone output already configured); `scripts/migrate.mjs` via `drizzle-orm/node-postgres/migrator` `migrate()` + `pg` (no drizzle-kit at runtime); `docker-entrypoint.sh`; `docker-compose.yml` (postgres:16 healthcheck, `service_healthy`, named volume, cloudflared under `--profile tunnel`); SELF-HOSTING.md. **DoD:** clean-volume `compose up` → login → connect real intervals.icu key → real data on dashboard. CI builds the image.

**P2 — Readiness engine + scheduler.** Engine from scratch per formula; manual wellness form; `instrumentation.ts` tick + advisory lock + `sync_jobs`; `/api/cron`; backfill metrics for all synced days. **DoD:** today's score + breakdown on dashboard; unattended nightly update. **Tests:** hand-computed fixtures (calibrating, renormalization, band edges); lock-safety (two concurrent tickers, each job processed once).

**P3 — AI coach.** `/api/chat` AI SDK streaming; persisted threads; tool registry as AI SDK tools; persona prompt; LLM settings UI (encrypted BYO key). **DoD:** cites real numbers on both Anthropic key and local Ollama. **Tests:** registry (schema validation, userId scoping); provider resolution; prompt snapshot.

**P4 — MCP endpoint** _(security-review gate before exposure)_. Migration adding `scopes` + lookup prefix to `api_tokens`; token UI; `/api/mcp`; token bucket; add SDK as direct dep. **DoD:** claude.ai connector and Claude Code list tools and fetch readiness end-to-end. **Tests:** revoked → 401; missing scope rejected; cross-user isolation; auth-before-handleRequest ordering.

**P5 — Multi-user + Strava** _(second security review)_. Invite flow, admin page; Strava OAuth **from scratch** (KOM-Wars as API reference only): refresh serialized with pg advisory lock, hourly jittered polling, lazy streams; `provider='strava'` excluded from AI/MCP by default (Nov 2024 Strava AI clause), own-data opt-in, "Powered by Strava" attribution. **DoD:** friend onboards via invite; complete data isolation. **Tests:** isolation across web + MCP; refresh race; AI-exclusion proof.

**P6 — PWA + push.** Serwist service worker, manifest, install prompt; daily readiness push (web-push VAPID), per-user subscriptions (KOM-Wars as reference; tests required). **DoD:** installed on phone; morning notification arrives. **Tests:** subscription lifecycle, payload, unsubscribe.

**P7 — Depth & ops.** Activity streams detail; fitness page; sync-jobs UI; TSS/EMA fallback; nightly `pg_dump` + restore drill; Vercel+Neon doc; extended MCP tools (curves/best efforts); then Whoop API / Apple Health. **DoD:** a month of unattended operation with restorable backups.

## Risks & mitigations

- **Strava AI clause** → provenance + default AI/MCP exclusion + own-data opt-in + attribution.
- **Rate limits** → Strava ~200/15min shared: hourly jittered polling, lazy streams, 429 backoff.
- **Neon HTTP driver** → no advisory locks/transactions: scheduler requires `DATABASE_DRIVER=pg`; serverless uses `/api/cron`.
- **In-process cron** → idempotent re-claimable jobs; `/api/health` exposes last-tick age.
- **Secrets** → `.env*` gitignored (verified untracked); never rotate `ENCRYPTION_KEY` without re-entering stored keys (GCM fails closed); BYO keys decrypted per request, never logged.
- **MCP exposure** → hashed scoped tokens, rate limit, stateless transport, security-review gate before the tunnel goes public.

## Execution on approval

1. Replace `docs/PLAN.md` with this document; commit + push (plan visible on GitHub).
2. P0 in order, starting with the TS fix and the Principle-1 test gate for the three ported files (fixing the two connector defects).
3. Each phase ends with its DoD verified before the next begins; commits in small logical units.
