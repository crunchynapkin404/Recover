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
- **Backups:** `docker compose exec db pg_dump -U recover recover > backup.sql` (nightly job + restore drill land in a later phase).
- **Logs:** `docker compose logs -f app` — structured JSON lines.
