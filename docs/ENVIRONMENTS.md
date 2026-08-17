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

| Date       | Version  | Digest                                                                    | Soaked?                             |
| ---------- | -------- | ------------------------------------------------------------------------- | ----------------------------------- |
| 2026-08-17 | v0.106.0 | `sha256:2ed296b142bb3e3fd73d057296f3f7b896c7ff168d992e5f270d940997f52032` | **yes**                             |
| 2026-08-17 | v0.105.1 | `sha256:4f2abdc0124e139a776fe4710027fa1591763a6a6efa249b134bb1d4809661a2` | **yes**                             |
| 2026-08-16 | v0.104.0 | `sha256:d7771b840f313a5ce0b2054983077712cf90ab6642cb85cf06c425082621cc6f` | **no** — see below                  |
| 2026-08-16 | v0.104.0 | `sha256:473fc46f763739d0c014a4eff869a0219c111de09c5ba4e240d49f5830c45413` | yes, but superseded within the hour |
| 2026-08-14 | v0.103.0 | `sha256:8c0b451ad7f752ff72d304e2de394cedd9417dac13584d1aca970fa62c42fbb2` | pre-gate                            |

**Do not roll back to `d7771b84`.** It is a rebuild of v0.104.0's commit that
the final `vX.Y.Z` tag produced _after_ `473fc46f` had been promoted,
discarding it — the defect v0.105.1 closed. It ran in production for roughly
twelve hours and nothing is known to be wrong with it, but nothing ever ran it
anywhere else either. `473fc46f` is the soaked build of that same commit and is
the correct v0.104.0 target.

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

After first boot it needs data, and **`npm run db:seed` is not enough** — it only
creates the owner account, which the app has already done at boot, so it reports
"already exists — nothing to do" and the owner has no training data at all. A
soak seeded that way cannot run `verify:surfaces`, which signs in as the owner
(it must: `/admin` is one of the captured surfaces and redirects every other
role).

Copy the dev box's seeded database instead. That gives the owner real data and
keeps the axe numbers comparable to `docs/axe-baseline-2026-08-11-seeded.md`,
which is the reason for seeding in the first place:

```bash
docker exec recover-db-1 pg_dump -U recover -Fc recover > /tmp/dev-seeded.dump
docker exec -i recover-rc-db-1 psql -U recover -d recover \
  -c "drop schema public cascade; create schema public;"
docker exec -i recover-rc-db-1 pg_restore -U recover -d recover < /tmp/dev-seeded.dump
docker restart recover-rc-app-1
```

Sign in with **devbox's** `OWNER_PASSWORD` from `.env` afterwards, not the one in
`.env.rc` — the restore replaces the account the RC app seeded:

```bash
set -a; . ./.env; set +a
SCREENSHOT_BASE_URL=http://localhost:3100 npm run verify:surfaces -- <slice>
```

**Known gap, carried to a later slice:** `coach-thread` cannot be captured on a
seeded database at all. `scripts/seed-demo.ts` gives its six chat threads to
`demo@recover.local`, and the capture signs in as the owner, so
`a[data-chat-thread]` never appears and those four captures fail. Slice 4 got
coach captures because the old dev box's owner had real threads from actual use.
Closing it needs the owner seeded with threads.

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

## After a promotion

```bash
scripts/live-verify-deploy.sh sha256:<the digest promote.yml printed>
```

Untracked (`scripts/live-*.sh`). Exits non-zero unless prod is running exactly
that digest, its container reports `healthy`, and `/api/health` says
`status: ok`, `db: up` and a **non-null** `backupAgeS`.

The workflow cannot do this itself: it runs on GitHub's runners, which cannot
reach 10.0.10.100, so `promote.yml` can go green while prod sits on the old
image. Checked in both directions on 2026-08-16 — it passes on the running
digest and fails on a wrong one.

## Deploy drift — the guard on the gate itself

`scripts/live-drift-check.sh` (untracked, `scripts/live-*.sh`) runs every four
hours via cron and checks the one invariant the whole release gate exists to
protect: **prod runs a digest that was soaked on the dev box.**

That invariant broke **twice within 48 hours** of the gate being built, and
both times the only thing that noticed was a human comparing two digests by
eye — the final `vX.Y.Z` tag rebuilding the image and discarding the promoted
digest (v0.104.0), then a tag on an older commit resurrecting the old trigger
because GitHub runs the workflow file from the tagged ref. Every other property
in this project got a guard the moment it was understood; this one had none.

**It deliberately does not compare prod against `:latest`.** It cannot: in both
failures the rebuild moved `:latest` and prod _together_, so the two agreed
with each other while agreeing on an image nothing had ever run. The
expectation is instead an immutable record — `~/.recover-promoted`, written by
`scripts/live-verify-deploy.sh` at the moment a human verifies a promotion.

It also fails on a null `backupAgeS` (the freshness notify has stopped landing
again) and on a backup older than 48 hours (the dump itself has stopped).

```bash
scripts/live-drift-check.sh          # exit 0 = healthy, 1 = drift
cat ~/.recover-drift.log             # every run, appended
cat ~/RECOVER-DRIFT-ALERT            # exists only while something is wrong
```

The marker file is removed automatically once the state is good again, so its
presence always means "wrong right now" rather than "was wrong once".

**Known limitation, stated rather than papered over:** this alerts by writing
a file, a log line, and a non-zero exit. Nothing pushes to a phone. On a
single-owner instance that is proportionate — but it is the same shape as the
defect v0.105.0 fixed, an instrument nobody is looking at. Wire it to a real
channel before relying on it for anything busier.

Verified in both directions on 2026-08-17: OK against the real promoted digest,
and DRIFT (exit 1, marker written, both digests named) when the record was
replaced with the rebuilt digest from the v0.104.0 failure.

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
