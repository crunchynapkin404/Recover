# Self-hosting Recover

This guide covers the Docker Compose path. For a serverless deployment on
Vercel with Neon as the managed Postgres, see
[Deploying to Vercel + Neon](DEPLOY-VERCEL.md) instead — the scheduler and
backup story both work differently there.

## Quickstart

```bash
git clone https://github.com/crunchynapkin404/Recover.git
cd Recover
cp .env.example .env
# Edit .env: set ENCRYPTION_KEY, BETTER_AUTH_SECRET, OWNER_EMAIL, OWNER_PASSWORD
docker compose up -d
```

This pulls the prebuilt multi-arch image (amd64/arm64) from GHCR. To build
from source instead:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Open http://localhost:3000, sign in with `OWNER_EMAIL` / `OWNER_PASSWORD`
(the owner account is created automatically on first boot of an empty database),
then go to **Settings → intervals.icu** and paste your API key
(intervals.icu → Settings → Developer).

## Environment variables

| Variable                                        | Required      | Purpose                                                                                                                                                                                                                                                                               |
| ----------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENCRYPTION_KEY`                                | yes           | 64 hex chars (32 bytes). Encrypts connector/LLM keys at rest. Generate: `openssl rand -hex 32`                                                                                                                                                                                        |
| `BETTER_AUTH_SECRET`                            | yes           | Session signing secret. Generate: `openssl rand -base64 32`                                                                                                                                                                                                                           |
| `BETTER_AUTH_URL`                               | yes           | Public URL of the app (`http://localhost:3000`, or your domain)                                                                                                                                                                                                                       |
| `OWNER_EMAIL` / `OWNER_PASSWORD`                | first boot    | Seeds the owner account when the users table is empty (min 8 char password)                                                                                                                                                                                                           |
| `POSTGRES_PASSWORD`                             | no            | DB password (compose default: `recover`)                                                                                                                                                                                                                                              |
| `APP_PORT`                                      | no            | Host port (default 3000)                                                                                                                                                                                                                                                              |
| `DATABASE_URL` / `DATABASE_DRIVER`              | managed       | Set by compose. For Vercel+Neon: `DATABASE_DRIVER=pg` + Neon's **pooled** connection string (not the HTTP/unpooled one) — the scheduler needs Postgres advisory locks, which only the pooled Postgres-protocol endpoint supports. See [Deploying to Vercel + Neon](DEPLOY-VERCEL.md). |
| `METRICS_TOKEN`                                 | no            | Bearer token to scrape `GET /api/metrics` (Prometheus text format). Unset = the endpoint 404s (no metrics exposed). Generate: `openssl rand -hex 32`                                                                                                                                  |
| `BACKUP_NOTIFY_SECRET`                          | no            | Shared secret for `POST /api/internal/backup-complete`, which `scripts/backup.sh` calls after a successful nightly rotate so `/api/health` and `/api/metrics` can report backup freshness. Generate: `openssl rand -hex 32`                                                           |
| `CLOUDFLARED_TOKEN`                             | tunnel only   | Cloudflare tunnel token for public access                                                                                                                                                                                                                                             |
| `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET`     | Strava only   | OAuth app creds for the Strava connector (developers.strava.com)                                                                                                                                                                                                                      |
| `WHOOP_CLIENT_ID` / `WHOOP_CLIENT_SECRET`       | Whoop only    | OAuth app creds for the Whoop connector (developer.whoop.com); redirect → `/api/connections/whoop/callback`                                                                                                                                                                           |
| `WITHINGS_CLIENT_ID` / `WITHINGS_CLIENT_SECRET` | Withings only | OAuth app creds for the Withings connector (developer.withings.com); redirect → `/api/connections/withings/callback`                                                                                                                                                                  |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`     | Calendar only | OAuth app creds for Google Calendar FreeBusy awareness (console.cloud.google.com); redirect → `/api/connections/google/callback`                                                                                                                                                      |

**Connectors needing no env config:** intervals.icu and Oura use a personal
API key / access token pasted in Settings; Apple Health pushes via a
per-user webhook URL (or a JSON file upload) — no OAuth app, so nothing to
configure at the instance level. The OAuth connectors above are each
optional: leave the vars unset and the connector shows a "set …" hint
instead of a Connect button.

⚠️ Never rotate `ENCRYPTION_KEY` casually: stored connector/LLM keys become
undecryptable (AES-GCM fails closed) and must be re-entered.

## Public access (optional)

Create a [Cloudflare tunnel](https://one.dash.cloudflare.com/) pointing your
hostname at `http://app:3000`, put its token in `.env` as `CLOUDFLARED_TOKEN`,
then:

```bash
docker compose --profile tunnel up -d
```

Set `BETTER_AUTH_URL` to your public URL afterwards.

## Install on your phone

Recover is a PWA. Open your instance in the phone's browser (via the tunnel —
push requires HTTPS), then:

- **iPhone (iOS 16.4+):** Share → Add to Home Screen, open the installed app,
  Settings → Notifications → Enable. Web push on iOS only works from the
  installed app.
- **Android:** accept the install prompt (or menu → Install app), then enable
  notifications in Settings.

The morning readiness notification is sent right after the overnight sync
computes your score (at most once per day). VAPID keys are generated and
stored in your database automatically — nothing to configure. Use **Send test
notification** in Settings to verify the pipeline, and the dashboard's sync
chip (or pull-to-refresh in the installed app) whenever intervals.icu is
lagging behind your watch.

## Upgrading

```bash
cd Recover
git pull                      # keeps compose file and docs in sync
docker compose pull app
docker compose up -d
```

Database migrations run automatically when the container starts
(`docker-entrypoint.sh` applies them before the server boots), so an upgrade
is just pulling the new image. Take a backup first for peace of mind (below).
Version pins are available if you prefer them: images are tagged `latest`,
`0.1`, and `0.1.0`.

Something go wrong after an upgrade? See [UPGRADING.md](UPGRADING.md) for
the rollback procedure (there are no down-migrations — rollback means
restoring the pre-upgrade backup) and the backup-compatibility matrix.

## Operations

- **Health:** `GET /api/health` → `{status, db, lastSyncAgeS}` (200/503) — point your uptime monitor here.
- **Metrics:** `GET /api/metrics` → Prometheus text exposition format, gated by `METRICS_TOKEN` (unset = 404, wrong/missing bearer = 401). Point Prometheus/Grafana at it for readiness, sync, and backup-freshness gauges.
- **Migrations:** run automatically at container start (`scripts/migrate.mjs`).
- **Backups:** nightly at 03:30 UTC to the `recover-backups` volume, 14 dumps kept — see [Backups & restore](#backups--restore).
- **Sync-job queue:** the owner-only `/admin` panel (linked from Settings) lists queued/failed sync jobs and lets you retry or kick a stuck one, alongside the security audit log.
- **Webhooks:** every user can add outbound webhook subscriptions in Settings — signed (`x-recover-signature`, HMAC-SHA256) HTTP POSTs on `readiness_computed`, `band_changed`, and (instance-wide) `backup_completed` events, for your own automation.
- **Logs:** `docker compose logs -f app` — structured JSON lines.

## Backups & restore

The `backup` service (default-on, no profile needed) runs `pg_dump -Fc`
every night at 03:30 UTC into the `recover-backups` volume and keeps the
newest 14 dumps. Set `BACKUP_KEEP` in `.env` to change retention. A
failed dump never deletes old backups. Watch it with
`docker compose logs backup`.

**Existing deployments:** compose changes arrive via git, not Watchtower —
run `git pull && docker compose up -d` once to create the service and
volume.

**Prove a backup restores** (unattended, ~30 seconds):

```bash
scripts/restore-drill.sh
```

It restores the newest dump into a disposable scratch Postgres, checks the
core tables have data, prints the newest wellness date, and cleans up
after itself. Exit 0 means your latest backup is restorable.

**Real disaster recovery** (restores INTO the live db — destructive):

First copy the chosen dump out of the volume:
`docker compose exec backup sh -c 'ls /backups'` then
`docker compose cp backup:/backups/<name>.dump ./`. Then:

```bash
docker compose stop app
docker compose cp ./<name>.dump db:/tmp/restore.dump
docker compose exec db pg_restore -U recover -d recover --clean --if-exists --single-transaction --no-owner /tmp/restore.dump
docker compose start app
```

## Personal data export & import

Separate from the whole-instance backup above: every account can export
and re-import _their own_ data (GDPR data portability), independent of
`pg_dump`/`pg_restore`.

- **Export:** `GET /api/export` (signed in) downloads a JSON file with
  every table you own — wellness, activities, chat history, training
  plans, biomarkers, and more. Secrets (connector tokens, API keys,
  webhook signing secrets) are never included. See
  `src/lib/export/export-user.ts`'s header comment for the full
  table-by-table inclusion/exclusion reasoning.
- **Import:** `POST /api/import-account` (signed in) restores a
  previously-exported JSON file into your account. It always imports into
  _your own_ signed-in account — there's no way to target anyone else's.
  Every row gets a freshly generated id; every internal reference (e.g. a
  chat message's thread, a race's linked activity) is rewritten to point
  at the newly-imported row, not the old exported one. Intended for
  restoring your own data into a fresh or freshly-wiped account (new
  install, migrated host), not for merging a backup into an
  already-active account — importing into an account that already has
  body/notification/journal/LLM preferences set fails the whole import
  cleanly (nothing partially applied) rather than overwriting them.
  Connector connections, API tokens, and webhook subscriptions are never
  re-imported — their secret/credential columns are dropped at export
  time by design and can't be reconstructed, so those rows would be
  useless (or, for tokens, impossible to insert at all — the columns are
  `NOT NULL`). Reconnect providers and re-issue tokens after an import.

**Prove export → import is lossless** (unattended, scratch Postgres —
never touches your real database):

```bash
scripts/export-import-drill.sh
```

It spins up its own disposable Postgres container (a random local port,
never your real `DATABASE_URL`), runs migrations, seeds a throwaway user
across every exported table, exports, wipes that user's data, imports the
export back in, exports again, and asserts the two exports match
(content-for-content, ids aside) — including that connections/api_tokens/
webhook_subscriptions correctly come back empty. Exit 0 means the round
trip is lossless. The container is torn down whether the drill passes or
fails.

## Active sessions

Settings lists every active session (device/browser) for the signed-in
account, with a **sign out** on any single one or **sign out everywhere
else** to revoke every other session at once — useful after a lost device
or a shared/borrowed browser. Revocation is immediate (Better Auth checks
the session on every request).
