# The devbox Actions runner

`soak.yml` and `finish-release.yml` run here. Nothing else does, and nothing
else should.

## Why it exists

GitHub's hosted runners cannot reach the prod box, and they cannot reach the RC
soak stack, the seeded dev database, or the backup volumes the drills restore
from. Everything in the release path that touches a real machine has to run on
devbox, so devbox has to be a runner. `promote.yml` says the same thing about
itself: a green promote does not prove a deployed prod.

## Why it is dangerous, and the one rule that contains it

**This repository is public.** A pull request from a fork runs _that fork's_
workflow file. If a self-hosted runner ever serves `pull_request`, anyone on the
internet gets code execution on this box — a box with SSH access to production,
to the nightly dumps, and to the athlete's real data.

**The rule: no workflow may pair a self-hosted runner with `pull_request` or
`pull_request_target`.** Only `workflow_dispatch` and tag pushes on the base
repository may target it, and a fork can trigger neither. That asymmetry is
GitHub's own documented mitigation and it is the entire safety story here.

A written rule that nothing enforces is a rule broken by accident — the same
reasoning that produced the `:latest` flavor guard and the `v*-rc.*` trigger
guard. So `tests/release-gate.test.ts` fails the suite if any workflow file
pairs them. It is mutation-checked: a probe workflow with that pairing fails it.

**The runner is persistent, not `--ephemeral`, and that is a deliberate
retreat.** It was registered `--ephemeral` first, on the reasoning that a job
should not be able to leave state for the next one. That configuration works
exactly once: the runner de-registers after its job and `svc.sh`'s service
**stops itself** rather than re-registering —

```
Job soak completed with result: Succeeded
√ Removed .credentials
√ Removed .runner
Runner listener exit with 0 return code, stop the service, no retry needed.
```

Found on v0.115.0's own release: the soak ran, and `finish-release.yml` then
queued against nothing. (Queueing rather than failing is the safe direction —
a release stalls visibly instead of a step being skipped quietly — but it is
still a release that does not finish.)

Keeping `--ephemeral` means re-registering before every job, and registration
tokens expire after an hour, so it needs a long-lived PAT stored on this box.
On a machine with SSH to production that is a worse trade than the state
isolation is worth. **The containment that actually matters is the
`pull_request` rule below, which is enforced by a test; ephemeral was
defence-in-depth on top of it, not the control itself.**

What this costs: the work directory now persists between jobs.
`actions/checkout` cleans the workspace each run and `soak.yml` tears its stack
down before bringing one up, so the exposure is small — but it is no longer
zero, and a job that leaves something behind will now be inherited.

## What must be on the box

`.env.rc` is gitignored, so it is **not** in the runner's fresh checkout.
`soak.yml` restores it from a stable path:

```bash
mkdir -p ~/.recover-ops
cp /home/bart/projects/recover/.env.rc ~/.recover-ops/env.rc
chmod 600 ~/.recover-ops/env.rc
```

Override with `RC_ENV_FILE` if it lives elsewhere. The job deletes its copy from
the workspace when it finishes, pass or fail.

The runner also needs: docker (for the RC stack and the drills), SSH to `PROD`
under the runner user's key (for `verify-deploy.sh`), and the
`recover-dev_backups` volume the drills read.

## Registering it

```bash
mkdir -p ~/actions-runner && cd ~/actions-runner
curl -fsSL -o actions-runner-linux-x64.tar.gz \
  "$(gh api repos/crunchynapkin404/Recover/actions/runners/downloads \
     --jq '.[] | select(.os=="linux" and .architecture=="x64") | .download_url')"
tar xzf actions-runner-linux-x64.tar.gz
./config.sh --url https://github.com/crunchynapkin404/Recover \
  --token "$(gh api -X POST repos/crunchynapkin404/Recover/actions/runners/registration-token --jq .token)" \
  --labels devbox --name devbox --unattended --replace
sudo ./svc.sh install && sudo ./svc.sh start
```

Confirm:

```bash
gh api repos/crunchynapkin404/Recover/actions/runners \
  --jq '.runners[] | "\(.name) \(.status) \([.labels[].name]|join(","))"'
# devbox online self-hosted,Linux,X64,devbox
```

A healthy runner shows `online` between releases. **Zero registered runners is
a fault, not a resting state** — an earlier version of this page claimed the
opposite, on the assumption that an ephemeral runner would be re-registered by
its service. It is not; see above.

## Removing it

```bash
cd ~/actions-runner
sudo ./svc.sh stop && sudo ./svc.sh uninstall
./config.sh remove --token "$(gh api -X POST \
  repos/crunchynapkin404/Recover/actions/runners/remove-token --jq .token)"
```

`soak.yml` and `finish-release.yml` will then queue forever rather than fail,
which is the safe direction: a release stalls visibly instead of a step being
skipped quietly.

## If you are reviewing a change to this setup

Ask one question: **can a fork cause this to run?** If the answer is anything
other than a clear no, the change is wrong regardless of how convenient it is.
