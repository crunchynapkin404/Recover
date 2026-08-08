# Baseline — 2026-08-08

A point-in-time statement of what Recover actually is, written after the
v0.55–v0.64 audit and the cleanup that followed. It exists so the next
roadmap starts from measured reality rather than from what the changelog
claims. Refresh it at the next baseline; do not let it drift silently.

**Marker:** `v0.65.0` · commit `e0720e9` · live and verified.

## By the numbers

|                    |                                         |
| ------------------ | --------------------------------------- |
| Version            | 0.65.0                                  |
| Tags               | 98 (`v0.1.0` → `v0.65.0`)               |
| Tracked files      | 952                                     |
| Source             | ~82,300 lines TS/TSX                    |
| Pages / API routes | 12 / 23                                 |
| MCP tools          | 57                                      |
| Migrations         | 40 (head `0039_demand_knows_its_sport`) |
| Tests              | 2044 passing, 1 skipped                 |
| Lint               | 0 problems                              |

Every gate — typecheck, lint, `format:check`, tests, production build — is
green at this commit, and `drizzle-kit generate` reports no pending schema
changes.

## What is live

The instance runs `v0.65.0` (deployed by Watchtower at 08:44 UTC on
2026-08-08, verified serving: `/login` 200, `/body` 307 when signed out,
migrations applied on boot). Live database holds 2 active training plans and
4 archived; one athlete plus invited users.

## What changed about how releases work

Until 2026-08-08, `docs/RELEASING.md` required a green `main` before tagging
and nothing enforced it. `release.yml` builds from the tag and never looked at
test results, so v0.63.0 and v0.64.0 were both tagged from a commit whose
suite had already failed — and both point at that same commit, meaning
`git diff v0.63.0..v0.64.0` is empty and one of the two numbers describes no
artifact of its own.

Two things now enforce the rule mechanically:

- `release.yml` has a `verify` job that `build` depends on. It refuses to
  publish unless the tagged commit's CI concluded success, waits up to 15
  minutes if CI is still running, and fails outright if no CI run exists for
  that SHA.
- `main` is protected: the `checks` context is required and `strict` is on.

## Known-open work

Nothing here is scheduled. This is the honest inventory the next roadmap
should choose from.

**Parked on a branch, unreviewed.** `feat/v0.65-mcp-contract-hardening` holds
~200 lines plus six new files: push quiet hours (migration `0040`), two new
MCP tools (`get_backup_status`, `get_recommendation_scorecard`),
`icu-update-wellness` changes and a race-demand tweak. It was found
uncommitted on a pre-v0.65 base that would have silently restored the v0.61
autopilot; it is now committed and rebased, but never reviewed, never
verified, and not ready to merge.

**Withdrawn, needs a real design.** The v0.61 adaptive week autopilot was
reverted for removing the ±20% ramp clamp it claimed to respect. The idea may
be sound; the implementation switched off a safety rail to get it. Any return
needs a design that composes with the rails instead of bypassing them.

**Off, pending a decision.** The Train week quick actions (Ease / Deload /
Boost / Skip, v0.56–v0.60) are built but not rendered. They wrote
`trainingBlocks.targetLoadTotal`, which the open week never reads — it is
recomputed from `periodize()` on the spot. Re-enabling requires choosing:
either the action re-materializes the open week, or the copy stops promising
percentages it does not deliver.

**Long-standing conditionals**, unchanged for months: Fitbit / Google Health
direct integration, Cycle-Aware Readiness, and the whole "Stronger Together"
sharing lane (per-pair consent, group view, coach seat, weekly digest,
shareable cards).

**Deferred UI work.** Quick-action failures are logged but not surfaced to the
athlete; showing them needs a `useActionState` refactor those switches do not
have.

## Structural lessons worth carrying forward

These are the patterns the audit found, not one-off bugs. They describe how
this codebase fails.

1. **A green suite after a behaviour change means nothing if the assertion
   moved with the code.** v0.61 did not add a test around the ramp clamp — it
   rewrote the test that protected it, changing `expect(220)` to
   `expect(340)`. New safety-relevant tests should be mutation-checked:
   break the code deliberately and confirm the test fails.
2. **A test that constructs the props it asserts on cannot detect that
   nothing constructs them in production.** Twice in three releases a feature
   was proven at the component boundary and never connected. One of those
   components had no render site at all.
3. **Dead code with passing tests is worse than dead code.** The seven-file
   sleep-card chain looked covered and maintained while being unreachable
   since the v0.23 redesign.
4. **Release notes drift toward intent.** "Bounded autopilot", "threaded
   sleep debt into the modeled starting charge" — each was contradicted by
   the code shipped under it. Notes should be written from the diff.
5. **Layer confusion is this codebase's recurring bug.** A rigorous target
   layer feeds a naive generator; stored values get written where recomputed
   values are read. The week quick actions are the fourth instance.

## How to re-measure

```bash
npm run typecheck && npm run lint && npm run format:check
set -a; . ./.env; set +a && npx vitest run && npm run build
npx drizzle-kit generate --name _drift_check   # expect "No schema changes"
```

The dev test database is the container `recover-devdb` on `127.0.0.1:5435`
(`.env` points at it). The live database is `recover-db-1` on `:5434` — never
point tests at it.
