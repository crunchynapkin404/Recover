# Deploying to Vercel + Neon

An alternative to the Docker Compose path in [SELF-HOSTING.md](SELF-HOSTING.md),
for running Recover on Vercel with [Neon](https://neon.tech) as the managed
Postgres. This mode trades the self-host operational bits (in-process
scheduler, `pg_dump` sidecar) for Vercel's serverless model and Neon's
managed database — read the whole page before your first deploy, the
scheduler and backup stories both work differently here than in
Docker Compose.

## 1. Create the Neon project

Create a project at [neon.tech](https://neon.tech) and grab its connection
string from the dashboard. Neon offers two forms — **use the pooled one**:

- **Pooled** (hostname contains `-pooler`, e.g.
  `...-pooler.us-east-2.aws.neon.tech`) — real Postgres wire protocol
  proxied through Neon's built-in PgBouncer. Supports session features
  including advisory locks and transactions.
- **Unpooled/direct** — also real Postgres wire protocol, but without the
  pooler; fine for one-off scripts, riskier for a serverless app that can
  spin up many concurrent function instances and exhaust Neon's direct
  connection limit.
- Neon also offers a separate **HTTP driver** (`@neondatabase/serverless`'s
  `neon()` function, for edge/stateless single-query use) — **do not use
  this one here**. It doesn't support advisory locks or multi-statement
  transactions, which Recover's background scheduler requires (see step 4).

## 2. Create the Vercel project

Import the repo in Vercel; Next.js is auto-detected.

- **Build command:** leave the default. `package.json`'s `build` script is
  a plain `next build` — nothing Vercel-specific to override.
- **Node.js version:** set to **22** in Project Settings → General →
  Node.js Version. `package.json` has no `engines` field pinning this, so
  Vercel won't infer it; the repo's own Docker image (`Dockerfile`, all
  three stages) targets `node:22-alpine`, and Vercel's project setting is
  the equivalent knob for that here.
- `next.config.ts`'s `output: "standalone"` is a Docker-image optimization
  and is harmless on Vercel — no action needed.

## 3. Environment variables

Start from the variable table in [SELF-HOSTING.md](SELF-HOSTING.md#environment-variables) —
the same variables apply (`ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL`, `OWNER_EMAIL`/`OWNER_PASSWORD`, the OAuth connector
credentials, `METRICS_TOKEN`). Set them in Vercel's Project Settings →
Environment Variables. Differences from the Docker Compose path:

| Variable                                               | On Vercel+Neon                                                                                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                         | Neon's **pooled** connection string from step 1.                                                                                   |
| `DATABASE_DRIVER`                                      | **`pg`** — required, not optional. See step 4 for why.                                                                             |
| `CRON_SECRET`                                          | **Required** here (optional in Docker Compose, where the in-process ticker doesn't need it). This guards `/api/cron` — see step 4. |
| `POSTGRES_PASSWORD` / `APP_PORT` / `CLOUDFLARED_TOKEN` | Not applicable — these only exist for `docker-compose.yml`. Skip them.                                                             |
| `BACKUP_NOTIFY_SECRET`                                 | Not applicable — see step 6. There's no backup sidecar on Vercel to call `/api/internal/backup-complete`; leave this unset.        |

None of `DATABASE_URL`, `DATABASE_DRIVER`, `CRON_SECRET` appear in
`.env.example` — that file is written for the Docker Compose path, where
the first two are injected by compose itself and the third is optional.
Set all three explicitly in Vercel's dashboard.

## 4. Run database migrations

Unlike the Docker image (whose entrypoint runs migrations automatically on
container start), Vercel's build step does not run them for you. Run them
yourself against the Neon pooled URL before traffic hits the new schema —
either from your machine or a CI step:

```bash
DATABASE_URL="<neon-pooled-url>" npm run db:migrate
```

Do this once before the first deploy, and again after pulling any commit
that adds a migration, before deploying that build.

## 5. Background sync: use `/api/cron`, not the in-process ticker

Recover's scheduler (`src/lib/sync/scheduler.ts`) claims and processes
`sync_jobs` rows — it's what drives morning insights, readiness pushes,
weekly/monthly reports, and near-real-time activity polling. Two things to
get right here, both required for it to actually run:

**`DATABASE_DRIVER=pg` is mandatory, not optional.**
`runSchedulerTick()` checks this itself and no-ops (returns
`{claimed: 0, failed: 0}` with only a `warn`-level log line, no visible
error) if `DATABASE_DRIVER !== "pg"`. The reason: it takes a Postgres
advisory lock so only one runner processes jobs at a time, and advisory
locks aren't available over Neon's HTTP-only driver — only over a real
Postgres wire-protocol connection, which is exactly what the pooled
connection string from step 1 gives you via `pg.Pool`.

**The in-process 60-second interval does not run on Vercel.**
`src/instrumentation.ts` starts a `setInterval` tick loop guarded by
`DATABASE_DRIVER === "pg"` — this is the self-host path, designed for a
single long-lived container process. Vercel's functions are stateless and
short-lived; there is no persistent process for a `setInterval` to live
in. Use `src/app/api/cron/route.ts` instead — its own comment describes it
as "the serverless alternative to the in-process interval."

**Verified nuance: this route won't be reached by Vercel's native Cron
Jobs feature as currently wired.** `/api/cron` only exports a `POST`
handler, and there's no `vercel.json` in this repo configuring a
`crons` entry. Vercel's native Cron Jobs (configured via `vercel.json`'s
`crons` array) always invoke via **GET**, so pointing that feature at this
route without changes would get a 405, not a scheduler tick. Until the
route gains a `GET` handler and a `vercel.json` crons entry (not present
in this codebase today), drive it with an **external** scheduler that can
issue an authenticated `POST`:

- [cron-job.org](https://cron-job.org) or a similar free pinger, configured
  to `POST` to `https://<your-app>.vercel.app/api/cron` with header
  `Authorization: Bearer <CRON_SECRET>`.
- A scheduled GitHub Actions workflow doing the same `curl -X POST`.

Pick an interval that fits your usage (every 5–15 minutes is reasonable —
the self-host default is 60 seconds, but that's a much cheaper in-process
loop than a serverless invocation). Verify it's working by checking
`GET /api/health`'s `lastSyncAgeS` field after a tick, or by tailing
Vercel's function logs for the route.

## 6. Backups: Neon PITR/branching, not `pg_dump`

The nightly `pg_dump` sidecar described in SELF-HOSTING.md's
[Backups & restore](SELF-HOSTING.md#backups--restore) section is a
Docker Compose service (`backup`, running `crond` + `pg_dump` into a
named volume) — there is no equivalent container on Vercel, and nothing
in this repo runs a scheduled `pg_dump` against Neon. **This is a real
gap relative to the self-host path, not an oversight to paper over.** The
honest equivalent on Neon is its own built-in
[point-in-time recovery and branching](https://neon.tech/docs/introduction/branching):
Neon retains a restorable history window (length depends on your Neon
plan) and lets you branch the database to any point within it. Enable/
configure retention in the Neon console, and treat "create a branch at
timestamp X" as your restore procedure instead of
`scripts/restore-drill.sh` (which assumes a local Postgres container and
doesn't apply here). `BACKUP_NOTIFY_SECRET` and `/api/internal/backup-complete`
stay unset and unused in this mode — there's no backup job to call them.

## 7. Verify the deploy

- `GET /api/health` → `{status, db, lastSyncAgeS}` should return 200.
- Sign in with `OWNER_EMAIL` / `OWNER_PASSWORD` — the owner account is
  seeded on first request regardless of `DATABASE_DRIVER` (the seeding
  step in `instrumentation.ts` runs unconditionally, only the scheduler
  tick itself is pg-gated).
- Manually trigger one tick to confirm the cron wiring end to end:
  `curl -X POST https://<your-app>.vercel.app/api/cron -H "Authorization: Bearer <CRON_SECRET>"`
  should return `{"claimed": ..., "failed": ...}`, not 401/405.
