# Environments

Recover runs on two Proxmox LXCs. This file is the only place that records
which is which; the repository otherwise cannot see either.

|             | dev                                                    | prod                                                              |
| ----------- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| Host        | `devbox`, 10.0.10.50                                   | `prod`, 10.0.10.100                                               |
| Reached by  | you are on it                                          | `ssh PROD` from devbox                                            |
| App         | `npm run dev` on :3000, RC soak on :3100               | container on :3000                                                |
| Postgres    | `recover-db-1`, 127.0.0.1:5434                         | `recover-db-1`, 127.0.0.1:5434                                    |
| Stack file  | `/home/bart/projects/recover/docker-compose.yml` (git) | `/opt/stacks/recover/docker-compose.yml` (Portainer, **not** git) |
| Ingress     | none                                                   | cloudflared tunnel, **and** `0.0.0.0:3000` on the LAN             |
| Auto-update | none                                                   | watchtower, scope `recover`, 300s poll, follows `:latest`         |
| Connectors  | **none, by rule**                                      | Strava                                                            |

## The rule about dev's credentials

**Dev never holds real connector credentials.** No Strava, Whoop, Withings or
Google client secrets in devbox's `.env`, ever.

This matters most once prod dumps are restored here. Dev's `ENCRYPTION_KEY`
differs from prod's, so connector tokens restored from a prod dump cannot be
decrypted on dev — connectors appear broken here, and that is correct. It is
what guarantees a dev instance can never sync against the athlete's real Strava
account. Do not "fix" it by copying prod's key.

## Rollback target

Prod's running image digest, recorded whenever it changes:

| Date       | Version  | Digest                                                                    |
| ---------- | -------- | ------------------------------------------------------------------------- |
| 2026-08-14 | v0.103.0 | `sha256:8c0b451ad7f752ff72d304e2de394cedd9417dac13584d1aca970fa62c42fbb2` |

To roll back, retag `:latest` to the previous row's digest — see
`docs/RELEASING.md`. **Read the migration caveat there first: rolling the image
back does not roll the schema back.**

Reading the running digest is fiddlier than it looks: `RepoDigests` is a
property of the image, not the container, so the container's image must be
resolved first.

```bash
ssh PROD 'docker image inspect $(docker inspect recover-app-1 --format "{{.Image}}") --format "{{index .RepoDigests 0}}"'
```

## The pre-release gate, proven 2026-08-16

`release.yml` tags images through `docker/metadata-action` with the `latest`
flavor left at its default `auto`, which excludes pre-releases. Verified
empirically rather than assumed, because prod's safety rests on it:

| Tag            | Digest after pushing `v0.104.0-rc.0` |
| -------------- | ------------------------------------ |
| `0.104.0-rc.0` | `sha256:51661bb9…` — newly published |
| `latest`       | `sha256:8c0b451a…` — **unchanged**   |
| `0.104`        | **does not exist**                   |

Both the `latest` flavor **and** the `{{major}}.{{minor}}` pattern are skipped
for a pre-release, so an RC publishes under exactly one tag and no floating tag
moves. `:latest` is the only tag prod's watchtower follows.

**Any `vX.Y.Z-rc.N` tag is therefore a staging build prod will not pick up.**
Re-verify this the first time it is relied on after any edit to `release.yml`;
`tests/release-gate.test.ts` guards the static half.

## The RC soak stack

`docker-compose.dev-rc.yml` runs a published release candidate on devbox the way
prod runs a release — same base compose file, same entrypoint, same
`scripts/migrate.mjs` at boot.

```bash
docker compose -p recover-rc --env-file .env.rc \
  -f docker-compose.yml -f docker-compose.dev-rc.yml up -d db app

docker compose -p recover-rc --env-file .env.rc \
  -f docker-compose.yml -f docker-compose.dev-rc.yml down -v   # incl. volumes
```

**The project name is not optional.** Without `-p recover-rc` these commands
recreate `recover-db-1` — the seeded database
`docs/axe-baseline-2026-08-11-seeded.md` is measured against — and the baseline
quietly stops being comparable.

It needs an untracked `.env.rc` beside it (`.env*` is gitignored), holding
`POSTGRES_PASSWORD`, `ENCRYPTION_KEY` (a throwaway, **never** prod's),
`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=http://localhost:3100`,
`TRUSTED_ORIGINS`, `OWNER_EMAIL`, `OWNER_PASSWORD`, `TZ`. No connector
credentials. Generate the two secrets rather than inventing them —
`BETTER_AUTH_SECRET` must be ≥32 characters and `ENCRYPTION_KEY` exactly 64 hex,
and the app's env-validation refuses to boot otherwise:

```bash
openssl rand -base64 32   # BETTER_AUTH_SECRET
openssl rand -hex 32      # ENCRYPTION_KEY
```

After first boot, seed it so axe numbers stay comparable to the baseline:

```bash
export DATABASE_URL="postgres://recover:recover@127.0.0.1:5435/recover" DATABASE_DRIVER=pg
SEED_DEMO=1 npm run db:seed-demo
```

## Dumps and secrets on the dev box

`scripts/live-dump-sync.sh` (untracked, per `.gitignore`'s `scripts/live-*.sh`)
pulls prod's newest dump into the `recover-dev_backups` volume and prod's `.env`
into `~/recover-secrets/prod-env.gpg`, encrypted with the passphrase in
`~/.recover-backup-passphrase`. Nightly at 04:15 via cron, after prod's 03:30
rotate.

**A restore needs both halves.** The dump holds the rows; `ENCRYPTION_KEY` from
that `.env` is what makes the connector tokens inside them readable, and
`BETTER_AUTH_SECRET` goes with it. Restore one without the other and you get an
instance whose Strava/Whoop/intervals.icu credentials are permanently
unreadable. **Keep the passphrase somewhere that is neither box** — it is the
only thing that is not backed up by this process, by design.

The passphrase file sits on the same machine as the ciphertext, so this protects
the copy if it travels further, not devbox itself. That is a deliberate trade
for a sync that has to run unattended.

With the volume populated, both drills run here — this is what
`migration-drill.sh` Phase A was built for and could never do on this box:

```bash
RECOVER_BACKUP_VOLUME=recover-dev_backups scripts/restore-drill.sh
RECOVER_BACKUP_VOLUME=recover-dev_backups scripts/migration-drill.sh
```

### The restore is proven, not assumed

`scripts/live-restore-proof.sh` restores the newest dump into a scratch
Postgres, pulls one encrypted connector token out of it, and decrypts it with
the key from the encrypted `.env` — using the app's own `src/lib/crypto.ts`, so
it proves the real code path reads the real data. It prints PASS or FAIL and
nothing else about the secrets.

Verified in both directions on 2026-08-16: PASS with the real key, and FAIL
(exit 1) when the backed-up key was replaced with a random one. Re-run it
whenever the pair's shape changes — a new encrypted column, a key rotation.

## Freezing deploys

```bash
ssh PROD 'docker stop recover-watchtower-1'    # prod stops following :latest
ssh PROD 'docker start recover-watchtower-1'   # resume
```

Do this before any experiment that pushes tags. Prod keeps serving while frozen;
it simply stops picking up new images.

## Running the test suite on a dev box

`docs/RELEASING.md` gives this for running what CI runs:

```bash
set -a; . ./.env; set +a; npx vitest run
```

**It writes to whatever database `.env` names.** The DB-gated suites create real
rows — on 2026-08-16 that run added seven `*@example.invalid` users to devbox's
seeded database, among them `test-coach-inbox-user` and
`test-coach-inbox-other-user`.

Those two names are the pair that appeared **in production** on 2026-07-27,
which `docs/ROADMAP.md` recorded as an unexplained defect: "Something pointed a
test run at production… deleting the rows removed the evidence without removing
the cause." The cause is this command, run on a box whose `.env` pointed at the
live database. On the two-box setup it is safe, because devbox's `.env` can only
reach devbox's Postgres — and that is now a property worth protecting rather
than a coincidence.

Clean the debris out afterwards; the seeded baseline should contain two users:

```sql
delete from users where email like '%@example.invalid';
```
