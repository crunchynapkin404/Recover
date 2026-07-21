# Upgrading Recover

This is the rollback procedure and the backup-compatibility matrix. For the
routine (forward, non-rollback) upgrade path — `git pull && docker compose
pull app && docker compose up -d`, migrations run automatically at
container start — see [SELF-HOSTING.md's Upgrading
section](SELF-HOSTING.md#upgrading). This doc is what to do when a forward
upgrade needs to be undone, and how far a given backup travels.

## The honest rollback story: there are no down-migrations

`drizzle-kit generate` in this repo has only ever produced forward
migrations — there is no `db:migrate:down` script, no `down.sql` files,
nothing to "run in reverse." Every migration shipped so far (`drizzle/0000`
through `drizzle/0021` at the time of writing) is additive by deliberate
repo convention: new tables, new nullable columns, or new columns with a
server-side default — never a dropped table, dropped column, or
`NOT NULL`-with-no-default added to a populated table. This was confirmed
across the v0.20 "Final Sweep" tasks and is the reason
`scripts/migration-drill.sh` (below) can meaningfully assert "the chain
applies cleanly against real data" — additive migrations are exactly the
kind that can silently regress this way, and non-additive ones are exactly
the kind this repo's convention forbids.

That means **rollback does not mean "run the previous migration set
backwards."** It means:

> Restore the last pre-upgrade `pg_dump` + redeploy the previous image tag.

Nothing more clever than that exists, and this doc will not pretend
otherwise.

## Rollback procedure

**Before upgrading** (so a rollback is possible at all):

1. Confirm a recent backup exists, or force one on demand:
   ```bash
   docker compose exec backup sh /backup.sh
   ```
   (Nightly backups already run at 03:30 UTC into the `recover-backups`
   volume, 14 kept — see [SELF-HOSTING.md's Backups &
   restore](SELF-HOSTING.md#backups--restore). This just doesn't make you
   wait for 03:30.)
2. Note the image tag/digest you're currently running, before you pull the
   new one:
   ```bash
   docker compose images app
   ```

**If something goes wrong after upgrading:**

1. Stop the app so nothing writes to the DB mid-restore:
   ```bash
   docker compose stop app
   ```
2. Restore the pre-upgrade dump — this is destructive (`--clean --if-exists`
   drops and recreates every object), which is exactly what's needed: it
   puts the schema back to the pre-upgrade shape too, since a `pg_dump -Fc`
   is a full schema+data snapshot, not a data-only one.
   ```bash
   docker compose cp ./<pre-upgrade-name>.dump db:/tmp/restore.dump
   docker compose exec db pg_restore -U recover -d recover \
     --clean --if-exists --single-transaction --no-owner /tmp/restore.dump
   ```
   (Same command as SELF-HOSTING.md's "Real disaster recovery" — this
   is that procedure, invoked for a rollback instead of a disaster.)
3. Redeploy the previous image tag. `docker compose pull app` will not get
   you the old image once `latest` has moved forward — pin the explicit
   version tag you noted above (edit `image:` in `docker-compose.yml`, or
   `docker pull ghcr.io/crunchynapkin404/recover:<prev-tag>` then bring
   `app` up against that pinned tag) so the running code matches the schema
   you just restored.
4. Start the app back up:
   ```bash
   docker compose up -d app
   ```
5. Verify: `GET /api/health` returns 200, and spot-check that the data
   you'd expect (e.g. today's wellness entry, if it existed pre-upgrade) is
   there.

**What backs this procedure:**

- `scripts/restore-drill.sh` proves the _restore_ mechanic itself (step 2
  above) works — it restores the newest real dump into a disposable
  scratch Postgres, checks core tables have data, and exits 0. Run it any
  time to prove your latest backup is restorable, independent of any
  upgrade.
- `scripts/migration-drill.sh` (new, this task) proves the _forward_
  direction — that `npm run db:migrate` applies the full migration chain
  cleanly on top of a real production dump's data shape, in an isolated
  scratch DB, never touching the live database. This is what makes
  _staying_ on the new version (not rolling back) the normal, low-risk
  outcome: a green migration drill on a recent dump is your evidence that
  the upgrade you're about to do is safe before you touch the live DB at
  all.

## Backup-compatibility matrix

A `pg_dump -Fc` dump is a full schema+data snapshot at the exact migration
state the app was at the moment the dump was taken. What restoring it
elsewhere does depends on where "elsewhere" is on the migration timeline:

| Dump taken at schema state...   | Restored into an app running schema state... | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| N (some migration, e.g. `0021`) | **same** N                                   | Restores cleanly, 1:1 — no migration step needed. This is the case `scripts/restore-drill.sh` exercises every time it runs.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| N                               | **newer**, M > N                             | Restores cleanly, then needs `npm run db:migrate` (or just starting the app — `docker-entrypoint.sh` runs migrations automatically at boot, per [SELF-HOSTING.md's Upgrading section](SELF-HOSTING.md#upgrading)) to bring the schema from N up to M. This is the normal "restore an old backup into a newer install" case, and it's exactly what `scripts/migration-drill.sh` proves works: it restores a real dump and runs the current migration chain against it in a scratch DB, asserting a clean exit and the schema landing on the latest migration. |
| N                               | **older**, L < N                             | **Not supported.** A dump taken at a newer schema state can contain tables, columns, or data shapes the older app's code doesn't know how to query or serve. This is the rollback scenario in reverse, and this repo does not attempt it — if you need to run an old app version, restore a dump that was actually taken while that old version's schema was current (which is precisely what the rollback procedure above does: it pairs an old dump with the old image tag, not with `latest`).                                                            |

**One honesty caveat on the middle row:** "restore an old dump, then
migrate forward" being safe rests on the additive-only convention described
above — it is a _repo convention_, not something Postgres enforces. If a
future migration ever needs to be genuinely destructive (a dropped column,
a `NOT NULL` with no default on a populated table), that specific migration
would need its own documented data-migration story, and this matrix's
middle row would no longer be a blanket "just run migrate" for dumps taken
before it. As of `drizzle/0021`, no migration on this branch requires that
caveat — `scripts/migration-drill.sh` is the regression guard that will
catch it if one ever does, since it re-runs the full chain against real
data before every release this drill is checked as part of.

## See also

- [SELF-HOSTING.md — Upgrading](SELF-HOSTING.md#upgrading) and
  [Backups & restore](SELF-HOSTING.md#backups--restore) — the routine
  (non-rollback) paths this doc assumes.
- [RELEASING.md](RELEASING.md) — how image tags are cut and published;
  what "the previous image tag" in the rollback procedure actually refers
  to.
- `scripts/backup.sh` — the nightly dump job.
- `scripts/restore-drill.sh` — proves a dump restores.
- `scripts/migration-drill.sh` — proves the migration chain applies
  cleanly against a real dump's data shape, and from empty.
