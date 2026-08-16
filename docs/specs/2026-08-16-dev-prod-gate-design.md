# The gate between the boxes — dev-first release pipeline — design

**Date:** 2026-08-16
**Status:** Design, approved
**Release:** v0.104.0 — infrastructure, hygiene and measurement only
**Successor:** v0.105.0 — 2b.4 slice 5 (Settings), the first release to ship
through this gate and its real acceptance test

## Premise

The project moved onto two boxes and the release path did not move with it.

Since 2026-08-14 there is a **dev** box and a **prod** box. Nothing in the
repository knows this. `docs/RELEASING.md` describes a single machine where
"everything green locally" and "push the tag" are adjacent steps, and
`release.yml` still wires a `v*` tag directly to the image the athlete's
instance runs. A second box exists to be tested against, and no step in any
document tells anyone to test against it.

Two things follow, and the second is the one that matters:

**There is no gate.** Pushing `v0.104.0` publishes `:latest`, prod's watchtower
polls GHCR every 300s, and the athlete is running that image inside five
minutes. The only thing standing between a tag and production is CI — which is
real, and which is exactly the set of checks that cannot see a redesigned
surface, because `verify-surfaces.ts` is deliberately not a CI gate
(`CONTRIBUTING.md`, "Can this run in CI? Not as configured").

**There is no rollback.** Nothing in the repo or in `docs/RELEASING.md` names a
way back. The tag is one-directional: `:latest` moves forward and prod follows.

Phase 2b.4 makes both sharper than they would otherwise be. Every surface slice
so far has found defects that only a real browser caught — slice 3 found **26
confirmed axe violations on a surface previously reported clean**, slice 4 found
**46** — and the tooling that finds them runs on one machine, by hand, off a CI
path. That is precisely the class of defect that reaches prod unimpeded today.

## What exists today, measured 2026-08-16

### dev — `devbox`, 10.0.10.50

Proxmox LXC. node 22.23.2, npm 10.9.8, Docker, a Portainer agent on 9001.

| Item                  | State                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| Containers            | `recover-db-1` only — postgres:16-alpine, `127.0.0.1:5434`, healthy                                             |
| Compose project       | `recover`, from `/home/bart/projects/recover/docker-compose.yml`, `db` service only                             |
| Database              | 36 tables, all 42 `drizzle/*.sql` applied, 2 users — `dev@recover.local` (owner), `demo@recover.local` (member) |
| `.env`                | `BETTER_AUTH_URL=http://localhost:3000`, `DATABASE_URL` → 5434, `TZ=Europe/Amsterdam`                           |
| Connector credentials | **None.** No Strava, Whoop, Withings, Google, no `CLOUDFLARED_TOKEN`, no `METRICS_TOKEN`                        |
| App                   | Not running — no `next dev`, nothing on 3000                                                                    |
| `.screenshots/`       | Absent                                                                                                          |
| Headless Chromium     | **Absent** — no `~/.cache/ms-playwright`                                                                        |
| `playwright-core`     | **Absent** — no `~/.npm/_npx/` at all                                                                           |

The database being seeded matters and is not incidental: `docs/axe-baseline-2026-08-11-seeded.md`
is measured against a seeded database, and seeding alone moved the node count
1398 → 1687 (+20.7%). A dev box measured against an empty database produces
numbers that cannot be compared to the recorded baseline.

The absence of connector credentials also matters, and it should be preserved as
a rule rather than left as an accident of setup. See §1.

### prod — `prod`, 10.0.10.100

Same Proxmox host. Six containers, all up 2 days.

| Item                  | State                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------- |
| Stack location        | `/opt/stacks/recover/docker-compose.yml` — **Portainer-managed, not a git checkout**    |
| App image             | `ghcr.io/crunchynapkin404/recover:latest`                                               |
| Running digest        | `sha256:8c0b451ad7f752ff72d304e2de394cedd9417dac13584d1aca970fa62c42fbb2`               |
| Ingress               | `cloudflared` tunnel, **and** the app published on `0.0.0.0:3000`                       |
| Auto-update           | `watchtower`, scope `recover`, 300s poll, follows `:latest`                             |
| Connectors configured | Strava only (`STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_WEBHOOK_VERIFY_TOKEN`) |
| Backups               | `recover-backup-1`, 03:30 nightly, dumps present                                        |

`/api/health` at 17:30 UTC:

```json
{
  "status": "ok",
  "db": "up",
  "lastSyncAgeS": 6864,
  "jobsPending": 6,
  "jobsFailed": 0,
  "backupAgeS": null
}
```

**Two facts about prod that the repository cannot see, recorded here so they are
not rediscovered:**

The stack is Portainer-managed at `/opt/stacks/recover/`, with no repository
alongside it. `docker-compose.yml` in this repo and the file prod actually runs
are two files that nothing keeps in step. They may already differ.

The app is published on all interfaces, not only through the tunnel — the
compose file's `${APP_PORT:-3000}:3000` has no `127.0.0.1` prefix, unlike the
db service's. Prod's login page answers to anything on 10.0.10.0/24. This is
noted, not fixed, in this release: it is a deliberate topology decision for the
owner, and closing it would take prod down for a recreate.

### The backup question, answered

`backupAgeS: null` has been open on the roadmap since v0.93.0 — "no successful
backup has ever been recorded, so there was nothing to restore from had this
gone wrong." It followed the project to the new box, and it is **not** what it
looked like:

```
-rw-r--r--  1 root root  1769372  Aug 15 03:30  recover-20260815-033000.dump
-rw-r--r--  1 root root  1770875  Aug 16 03:30  recover-20260816-033000.dump

backup: done, 2 dump(s) retained (keep 14)
backup: BACKUP_NOTIFY_SECRET not set, skipping freshness notify
```

**The backups run.** They have run every night since the box came up, they are
1.7M, and `scripts/backup.sh` reports success. What is missing is one shared
secret, so the sidecar skips the notify and `/api/health` has nothing to report.
The data was never at risk; the instrument was blind. Recorded this way round
because the roadmap's phrasing invites the opposite reading, and a future reader
should not re-panic.

### The release path today

```
tag v* → release.yml verify (green CI for that exact SHA, else refuse)
       → build amd64 + arm64 by digest
       → merge into a manifest tagged {{version}}, {{major}}.{{minor}}, :latest
       → watchtower polls :latest (≤300s)
       → the athlete's instance
```

`release.yml`'s `verify` job is a genuine guard and stays exactly as it is. It
exists because v0.63.0 and v0.64.0 were both tagged from commits whose CI had
already failed.

## The gate that already exists and has never been used

`release.yml` tags images through `docker/metadata-action` with
`type=semver,pattern={{version}}` and leaves the `latest` flavor at its default,
`auto`. That default excludes pre-releases.

So a tag of the form **`v0.104.0-rc.1`**:

- passes through the same `verify` job — green CI for that SHA or no publish;
- builds both architectures from the same Dockerfile as any release;
- publishes a real, multi-arch, production-identical image at
  `ghcr.io/crunchynapkin404/recover:0.104.0-rc.1`;
- and **does not move `:latest`**, which is the only tag watchtower follows.

That is a staging channel, for free, with no workflow change. The whole design
below rests on it.

> **This claim is unproven and prod's safety rests on it.** It is read from
> `metadata-action`'s documented `latest=auto` behaviour, not observed in this
> repository. The implementation plan therefore records `:latest`'s digest from
> GHCR **before** the first RC tag push and re-checks it after. If `:latest`
> moved, the gate does not exist, and `flavor: latest=false` is added to both
> `meta` steps before anything else proceeds. No RC is soaked, and nothing is
> promoted, until that check has passed once.

## Decisions

Five, each with the reasoning that produced it.

**1. Promotion retags the tested digest; it does not rebuild.** The alternative —
tag `-rc.1`, test it, then push the final `v0.104.0` and let `release.yml`
rebuild — needs no new machinery and fits `RELEASING.md` as written. It was
rejected because prod would then run a _different build_ of the same source:
`npm ci` resolution and `node:22-alpine` drift are small risks but they are
exactly the risks a soak exists to eliminate, and a soak that does not test the
shipped bytes is theatre.

**2. Dev's main database stays seeded; prod's dumps feed the drills.** Restoring
prod into dev's main database would give the highest fidelity and would
invalidate the seeded axe baseline in the middle of a nine-slice redesign that
is measured against it. Keeping prod data out entirely would leave
`migration-drill.sh` Phase A — real dump plus pending migrations — runnable only
on the production host, which is the one place that discovery must not happen.
Hybrid: deterministic data where the redesign needs comparability, real data
shape where migrations need honesty.

**3. The gate ships before slice 5.** Slice 5 is the first customer, not the
co-passenger. Merging an infrastructure change with a surface redesign in one
release means a failure has two candidate causes and a changelog has two stories.

**4. `playwright-core` becomes a pinned devDependency.** This reverses a
deliberate deferral. `CONTRIBUTING.md` lists it as blocker 4 to running axe in
CI — "adding a dependency and pinning it to a browser revision, which is a
deliberate decision nobody has made yet." The move made the decision necessary:
the tooling resolved from `~/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core`,
a content-addressed cache path hardcoded at `scripts/verify-surfaces.ts:146`,
and it did not survive being moved to another machine. Undeclared tooling has
now cost real time. Declaring it also retires one of the four CI blockers, which
is a side benefit and not the justification.

**5. A dedicated devbox→prod key, not agent forwarding.** Agent forwarding was
attempted first and failed twice: the workstation runs no ssh-agent, and a VS
Code _window reload_ reuses the existing SSH session, so config changes do not
take effect. Even working, forwarded auth dies with the laptop, and §4's dump
sync must run unattended. An ed25519 key was generated on devbox and installed
on prod restricted to `from="10.0.10.50",restrict,pty`, which makes a copy of it
useless anywhere but this host. The key has no passphrase; that is the cost of
unattended operation and the `from=` restriction is what pays for it.

## Design

### 1. `docs/ENVIRONMENTS.md` — the topology, written down

New document. Records both boxes as measured above: addresses, what runs where,
which ports, where prod's stack actually lives, the running digest convention,
and how to reach each one.

It also states one standing rule that currently holds by accident:

> **Dev never holds real connector credentials.** No Strava, Whoop, Withings or
> Google client secrets in devbox's `.env`, ever.

The rule matters most when §4's dumps arrive. Dev's `ENCRYPTION_KEY` differs
from prod's, so connector tokens restored from a prod dump cannot be decrypted
here — connectors on dev appear broken, and that is the correct behaviour. It
guarantees a dev instance can never sync against the athlete's real Strava
account. The document says so, so nobody later "fixes" it by copying prod's key.

### 2. Real-browser verification, made reproducible

The blocker for slice 5, fixed at the cause rather than by recreating the cache.

- Add `playwright-core` to `devDependencies`, pinned.
- Add `npm run dev:browser-setup` — installs the Chromium revision matching that
  pin.
- `scripts/verify-surfaces.ts`: drop the hardcoded `~/.npm/_npx/...` default in
  favour of normal module resolution. The `PLAYWRIGHT_CORE` environment override
  stays, as an escape hatch for a mismatched local browser.
- `CONTRIBUTING.md`: update the setup instructions, and amend blocker 4 to
  record that it is now closed and why.

Acceptance: `npm run verify:surfaces -- <slice>` runs to completion on a freshly
provisioned box with no manual cache surgery.

### 3. RC → soak → promote

**Publish.** Tag `vX.Y.Z-rc.N` from the release branch. `release.yml` is
unchanged; `:latest` does not move.

**Soak.** New `docker-compose.dev-rc.yml` overlay, committed to the repo. It
pins `image:` to the exact RC tag and stands the RC up as a **self-contained
stack**, not as a modification of the running dev one:

- **Its own compose project** (`-p recover-rc`) and **its own database volume**.
  Sharing the `recover` project name would let a compose command aimed at the RC
  recreate or migrate `recover-db-1`, the seeded database the axe baseline
  depends on. The RC must not be able to touch it.
- **Port 3100**, so it cannot collide with `npm run dev` on 3000.
- **Its own `.env.rc`**, because devbox's `.env` cannot be reused as-is:
  `BETTER_AUTH_URL` is `http://localhost:3000` there, and better-auth rejects
  requests whose origin does not match. The RC file sets
  `BETTER_AUTH_URL=http://localhost:3100` and a matching `TRUSTED_ORIGINS`.
  It carries no connector credentials, per §1.
- **Seeded deterministically after first boot** — `npm run db:seed` and
  `SEED_DEMO=1 npm run db:seed-demo` against the RC database, both idempotent.
  This is what makes the soak's axe numbers comparable to
  `docs/axe-baseline-2026-08-11-seeded.md`.

The container's own entrypoint runs the real `scripts/migrate.mjs`, so the
deploy-time migration path is exercised as prod would exercise it.

**Why the soak uses seeded data and not the prod dump.** The two jobs are
separate and conflating them serves neither. The soak asks _does this image boot,
migrate, serve and look right_, and it needs deterministic data to compare
against the recorded baseline. `migration-drill.sh` asks _do these migrations
survive real production data shape_, and it needs the prod dump (§4). Each runs
against the data its question requires.

**Verify.** A written checklist in `RELEASING.md`, not a remembered one:

1. `/api/health` returns 200 with `db: "up"`.
2. Sign-in succeeds with the seeded owner.
3. The release's surface renders in both themes at both viewports.
4. `npm run verify:surfaces -- <slice>` reports zero confirmed findings.
5. `scripts/migration-drill.sh` passes against the synced prod dump.
6. `scripts/restore-drill.sh` passes.

**Promote.** New `.github/workflows/promote.yml`, `workflow_dispatch`, input =
the RC tag. It resolves that tag's digest and runs:

```
docker buildx imagetools create -t <image>:latest -t <image>:X.Y.Z <image>@<rc-digest>
```

No rebuild. Prod runs the bytes devbox tested. Watchtower picks it up within
300s.

**Roll back.** The same lever, backwards: retag `:latest` to the previous
release's digest and watchtower rolls prod back within 300s. `ENVIRONMENTS.md`
records the current digest (`sha256:8c0b451a…`) as the standing rollback target,
and the promote workflow logs the digest it replaces on every run, so the target
is never reconstructed from memory.

> **Rolling the image back does not roll the schema back, and this limits the
> whole mechanism.** `drizzle/` is forward-only — 42 `.sql` files, no `down`
> counterparts, only snapshots — and `scripts/migrate.mjs` runs on every
> container boot. So the moment a release with a migration reaches prod, the
> database is ahead of any older image, permanently. Retagging `:latest`
> backwards then puts old code in front of a newer schema.
>
> That is survivable or fatal depending on the migration, so the procedure
> branches rather than pretending otherwise:
>
> - **Additive migration** (new table, new nullable column, new index) — old
>   code ignores what it does not know about. Image rollback is safe and is the
>   whole procedure.
> - **Destructive migration** (dropped or renamed column, a new `NOT NULL`, a
>   type change) — old code queries what is no longer there. Image rollback
>   alone produces a broken instance, and recovery means restoring the nightly
>   dump, which costs every change since 03:30.
>
> **Therefore every release must classify its own migrations.** `RELEASING.md`
> gains the step, and a release carrying a destructive migration states in its
> notes that it has no cheap rollback. Knowing that _before_ shipping is the
> point; discovering it during an incident is what this clause exists to
> prevent.

### 4. Close the reporting gap, and bring the dumps to dev

**Fix the notify.** Generate a secret, set `BACKUP_NOTIFY_SECRET` in prod's
`/opt/stacks/recover/.env` for both the `app` and `backup` services, recreate
both, and confirm `/api/health` reports a non-null `backupAgeS` after the next
03:30 run. Verified by observation, not by the script's own output.

**Sync the dumps.** `scripts/live-dump-sync.sh` — pulls the newest dump from
prod's `recover-backups` volume to devbox and lands it in a local volume the
drills read via `RECOVER_BACKUP_VOLUME`.

Named `live-*` deliberately: `.gitignore` already excludes `scripts/live-*.sh`
as "deployment-specific operational wrappers… so a public clone never carries
this instance's topology". A script naming prod's address belongs in that
category.

With the dumps local, `migration-drill.sh` Phase A becomes real on devbox — real
production data shape, real pending migrations, on the box where failure is free.

**Also check for drift:** diff prod's `/opt/stacks/recover/docker-compose.yml`
against the repo's. Record any differences in `ENVIRONMENTS.md`. Do not
reconcile them in this release; knowing is the deliverable.

### 5. `tests/release-gate.test.ts` — so the gate cannot quietly vanish

Parses both workflow files and asserts:

- `release.yml`'s `meta` steps never force the latest flavor
  (`flavor: latest=true` or an explicit `type=raw,value=latest`);
- `promote.yml` is the only file in `.github/workflows/` that writes `:latest`.

Without this, one later edit re-arms the straight-to-prod path and nothing says
so. It is the same reasoning that put the `verify` job into `release.yml`: a
written rule that nothing enforces is a rule that gets broken by accident.

### 6. What the setup is missing, beyond the gate

Reviewing the whole topology rather than only the release path turned up five
gaps. The first two are more serious than anything the gate fixes.

**6a. Prod's secrets have no backup, which makes the dumps only half a
restore.** The nightly `pg_dump` captures the data. It does not capture
`/opt/stacks/recover/.env`, which holds `ENCRYPTION_KEY` — and per
`.env.example` that key "encrypts connector/LLM keys at rest". If the prod LXC
is lost, the dumps restore, and every encrypted connector token in them is
permanently undecryptable. `BETTER_AUTH_SECRET` goes with it, invalidating every
session. A disaster-recovery story that recovers the rows and loses the key to
them is not a disaster-recovery story.

Fix: prod's `.env` gets copied off-box, encrypted, as part of the same sync that
brings the dumps over (§4) — `age` or `gpg` to a passphrase the owner holds
outside both boxes. `ENVIRONMENTS.md` records where it lives and states plainly
that a restore needs both halves.

**6b. The app container has no healthcheck, and watchtower deploys anyway.**
`docker-compose.yml` gives `db` a `pg_isready` healthcheck (line 13) and gives
the app none. So watchtower pulls a new `:latest`, restarts the app, and reports
success whether or not the app can serve a request — the container being _up_ is
the only thing anyone checks. A crash-looping or migration-wedged app looks
identical to a healthy one until someone opens the site.

Fix: a healthcheck on the `app` service hitting `/api/health`. That single
addition is what makes both watchtower's auto-update and the §3 soak
self-reporting rather than assumed, and it costs four lines.

**6c. The dumps exist in exactly one place.** They live on prod's
`recover-backups` volume, on the same LXC, on the same Proxmox host as the
database they protect. §4's dump sync incidentally fixes this — but only if it
runs on a schedule rather than when someone remembers. Make it a nightly cron on
devbox, timed after prod's 03:30 rotate. The second copy is then a side effect
of a thing that has to happen anyway, which is the only kind of backup that
survives contact with routine.

**6d. Nothing verifies that a promotion actually landed.** `promote.yml` runs on
GitHub's runners, which cannot reach 10.0.10.100. So the workflow can succeed
while prod stays on the old digest — watchtower silently wedged, poll interval
misconfigured, image pull failing. Fix: `scripts/live-verify-deploy.sh` on
devbox, which SSHes to prod and asserts the running digest equals the promoted
one and `/api/health` returns 200. It is the closing step of the release
checklist, and the first thing that would have caught the 2026-08-07 incident
already recorded in `docker-compose.yml`'s comments, where the app was healthy
on its IP while the tunnel served 502s.

**6e. Prod's compose file is not under version control.** §4 measures the drift;
this is the option for ending it. Portainer can source a stack from a git
repository, which would make `/opt/stacks/recover/docker-compose.yml` a checkout
of this repo's file rather than a copy of it — drift becomes impossible instead
of merely measured. **Proposed, not decided**: it changes how prod is
administered, so it is the owner's call. If declined, the drift diff in §4
becomes a recurring checklist item rather than a one-off.

### 7. Documentation

- `docs/RELEASING.md` — the checklist gains the RC, soak and promote steps, the
  migration classification step (§3), the rollback procedure and its additive /
  destructive branch, and the post-promote verification (§6d). The existing five
  green checks are untouched.
- `CONTRIBUTING.md` — browser setup; blocker 4 marked closed.
- `docs/ENVIRONMENTS.md` — new, per §1. Also carries the standing rollback
  digest, the restore procedure's two halves (dump + secrets, §6a), and the
  recorded compose drift (§4).
- `docs/SELF-HOSTING.md` — the app healthcheck from §6b changes the documented
  compose file, so the page that teaches it must match.
- `docs/ROADMAP.md` — ticked, and the `backupAgeS` item under 2b.2's live-DB
  hygiene note corrected: backups were running, the notify was not configured.
- `CHANGELOG.md` — written from the diff.
- `.gitignore` — add `graphify-out/`. It is untracked local tooling output
  sitting in the repo root; unrelated to this release, one line, and it is in
  every `git status` until someone does it.

## Testing

Most of this release is operations, not application code. Stated plainly rather
than implied covered, per `RELEASING.md`'s own rule that an untestable surface
belongs in the release notes:

**Unit-tested:** §5's gate guard, and nothing else. It is the only piece with
logic that can regress silently.

**Verified by observation, recorded in the release notes:** the `:latest`
non-movement check on the first RC push; `backupAgeS` going non-null; the
promote workflow producing the expected digest on prod; both drills passing on
devbox against a synced dump; the §6b healthcheck reporting `healthy` on prod
and `unhealthy` when pointed at a deliberately broken container.

**Verified by drill, not in production:** §6a's secrets backup. Restoring a dump
plus the encrypted `.env` into a scratch instance and confirming a connector
token decrypts is the only thing that proves the pair is sufficient — and unlike
rollback, it costs nothing to prove, because it runs entirely on devbox. This is
the one disaster-recovery claim in this release that gets actual evidence.

**Not verified in this release:** rollback. Retagging `:latest` backwards is
designed and documented here but deliberately not exercised against prod —
proving it means deliberately regressing the athlete's live instance. It is
first exercised the day it is needed, which is a known weakness of this design
and is stated so it is not mistaken for coverage. The additive/destructive
branch in §3 is likewise reasoned, not demonstrated.

**The real acceptance test is v0.105.0.** Slice 5 ships through this gate, or
the gate does not work.

## Out of scope

- Closing prod's `0.0.0.0:3000` exposure — recorded in §"What exists today",
  owner's call, needs a recreate.
- Reconciling prod's compose file with the repo's — this release measures the
  drift and records it.
- Putting `verify-surfaces.ts` into CI. §2 retires one of four blockers; the
  ratchet, the seeded CI database and the running server remain.
- Connector credentials on dev. §1 forbids the real ones; whether dev gets its
  own OAuth apps is a separate question, and slice 5 will show whether Settings
  can be verified without them.
- Metrics scraping. Prod carries a `METRICS_TOKEN` and `/api/metrics` speaks
  Prometheus, but nothing scrapes it and standing up a monitoring stack is its
  own project. §6b's healthcheck is the minimum viable answer to "is it up",
  and it is deliberately the only one taken here.
- Moving prod's stack to a git-sourced Portainer deployment (§6e) — proposed for
  the owner's decision, not assumed.

## Acceptance

1. `npm run verify:surfaces` runs on devbox from a clean checkout.
2. An RC tag publishes an image and `:latest`'s digest is provably unchanged.
3. `docker-compose.dev-rc.yml` runs that image on devbox:3100 under its own
   compose project, migrations applied by the real entrypoint, `/api/health` 200,
   and `recover-db-1` demonstrably untouched.
4. `promote.yml` moves `:latest` to the RC digest without rebuilding, and
   `scripts/live-verify-deploy.sh` confirms prod's running digest matches within
   300s.
5. `/api/health` on prod reports a non-null `backupAgeS`, and prod's `app`
   container reports `healthy`.
6. Both drills pass on devbox against a synced prod dump, and the sync runs on a
   schedule rather than by hand.
7. A dump plus the encrypted `.env` restore into a scratch instance on devbox
   with a connector token that decrypts.
8. `tests/release-gate.test.ts` passes, and fails when the flavor is forced.
9. All five green checks pass; `docs/RELEASING.md` describes what was actually
   done.
