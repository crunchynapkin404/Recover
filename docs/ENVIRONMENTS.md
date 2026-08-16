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

## Freezing deploys

```bash
ssh PROD 'docker stop recover-watchtower-1'    # prod stops following :latest
ssh PROD 'docker start recover-watchtower-1'   # resume
```

Do this before any experiment that pushes tags. Prod keeps serving while frozen;
it simply stops picking up new images.
