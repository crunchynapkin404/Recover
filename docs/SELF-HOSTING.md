# Self-hosting Recover

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

| Variable                           | Required    | Purpose                                                                                        |
| ---------------------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `ENCRYPTION_KEY`                   | yes         | 64 hex chars (32 bytes). Encrypts connector/LLM keys at rest. Generate: `openssl rand -hex 32` |
| `BETTER_AUTH_SECRET`               | yes         | Session signing secret. Generate: `openssl rand -base64 32`                                    |
| `BETTER_AUTH_URL`                  | yes         | Public URL of the app (`http://localhost:3000`, or your domain)                                |
| `OWNER_EMAIL` / `OWNER_PASSWORD`   | first boot  | Seeds the owner account when the users table is empty (min 8 char password)                    |
| `POSTGRES_PASSWORD`                | no          | DB password (compose default: `recover`)                                                       |
| `APP_PORT`                         | no          | Host port (default 3000)                                                                       |
| `DATABASE_URL` / `DATABASE_DRIVER` | managed     | Set by compose. For Vercel+Neon deploys: Neon URL + omit `DATABASE_DRIVER`                     |
| `CLOUDFLARED_TOKEN`                | tunnel only | Cloudflare tunnel token for public access                                                      |

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

## Operations

- **Health:** `GET /api/health` → `{status, db, lastSyncAgeS}` (200/503) — point your uptime monitor here.
- **Migrations:** run automatically at container start (`scripts/migrate.mjs`).
- **Backups:** nightly at 03:30 to the `recover-backups` volume, 14 dumps kept — see [Backups & restore](#backups--restore).
- **Logs:** `docker compose logs -f app` — structured JSON lines.

## Backups & restore

The `backup` service (default-on, no profile needed) runs `pg_dump -Fc`
every night at 03:30 into the `recover-backups` volume and keeps the
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
docker compose exec db pg_restore -U recover -d recover --clean --if-exists --no-owner /tmp/restore.dump
docker compose start app
```
