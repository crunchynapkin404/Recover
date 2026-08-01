# Plan Identity — one active plan, one answer

**Date:** 2026-08-01
**Status:** design, approved for planning
**Target release:** v0.32.0 (migration 0034)

## The defect

The owner's account holds **three `active` training plans**, all created
2026-07-15 between 12:14 and 12:46, all titled "century training plan" for the
same 2026-09-13 race. They disagree with each other:

| plan       | `current_week` | `constraints.hoursPerWeek` |
| ---------- | -------------- | -------------------------- |
| `f580a980` | 1              | 11.5                       |
| `ada2d390` | 1              | 10                         |
| `fa8854f2` | 4              | 10                         |

Seven code paths ask "which is this athlete's active plan?". **Five of them ask
with `findFirst` and no `orderBy`**, so Postgres answers in heap order — which is
neither specified nor stable across updates and vacuums. The other two order by
`createdAt desc`.

Run against the live database, the unordered query returns `f580a980` on every
attempt. So today, on the running instance:

- **`get_training_plan` tells the coach the athlete is on week 1 of 9.** The
  week engine is on week 4. The open week row `5ef35b1b` carries
  `plan_id: fa8854f2` and `skeleton_week: 4`, so the engine's answer is the
  true one and the coach's is not.
- **`update_training_plan` writes to `f580a980`** — a row nothing else reads.
  Asking the coach to change the plan reports success and changes nothing the
  athlete will ever see.
- **The Today dashboard reads `hoursPerWeek: 11.5`** while the week-plan engine
  reads `10`.

This is the project's recurring defect class — duplicated data with no tie-break
— in the one place that decides what the athlete is training for.

### What is not the cause

The archive guard in `src/lib/training-plan.ts:813` ("there is always at most one
active plan per user") **has not failed**. It landed in `a263240` at 2026-07-15
23:07; all three rows were created that morning, roughly ten hours earlier. They
are pre-guard artifacts, and no duplicate has appeared since. Prevention is
working. Resolution is not.

## Decision: newest `active` by `createdAt`, one producer

`getActivePlan(userId)` becomes the single producer. It selects `status =
'active'` rows for the user ordered by `createdAt desc` and returns the first,
or `null`.

**Why this rule.** It is already the de-facto rule in the two consumers that
matter most — `week-plan/service.ts:96` and `weekly-review.ts:235`, the engine
paths. Adopting it everywhere means the five broken consumers converge onto what
the engine already does: the coach and the dashboard change to match the engine,
and the engine's behaviour does not change at all. On the live data it selects
`fa8854f2`, which is independently confirmed correct by the open week's
`plan_id`.

**Rejected: tie-break on the open week's `plan_id`.** More truthful in the
pathological case, but it couples plan resolution to `week_plans` and goes
circular at rollover — the engine reads the active plan in order to build the
week that would then define which plan is active. The week binding is better
used as evidence that the `createdAt` rule is right (it is, here) than as the
rule itself.

**Rejected: a partial unique index** `UNIQUE (user_id) WHERE status = 'active'`.
It would make the state structurally impossible, but
`src/lib/export/import-user.ts:452` inserts `status: r.status` verbatim, so the
owner's own export could not be restored under such an index. Deciding what
import _should_ do with a multi-active export is a real question and does not
belong as a rider on this release. Revisit separately.

## The resolver

New module `src/lib/active-plan.ts` — small and dedicated. Not
`training-plan.ts` (893 lines already, and this must not grow it), not
`week-plan/` (that package is about weeks, not plan identity).

```ts
type ActivePlan = typeof schema.trainingPlans.$inferSelect;

export async function getActivePlan(userId: string): Promise<ActivePlan | null>;
```

(The repo has no exported `TrainingPlan` type; `typeof schema.X.$inferSelect` is
the established convention — `strava-sync.ts:18`, `strava-describer.ts:259`.)

Implementation notes that are part of the contract:

- Query with `findMany` ordered `createdAt desc`, return `rows[0] ?? null`. The
  extra rows are not waste — they are how the function detects ambiguity.
- **When `rows.length > 1`, log a warning** `{ userId, count, chosen }`. The
  ambiguity was silent, which is why it survived two weeks in production and
  cost a session to find. v0.30.1 established the principle for exactly this
  class of defect: it leaves a trace.
- Returns the **whole row**. The dashboard currently projects
  `columns: { constraints: true }`; that projection is dropped deliberately.
  One shared shape beats saving four columns on one query, and a projection
  parameter would reintroduce per-call-site variation — the exact thing being
  removed.

## Call-site migration

All seven route through the resolver, including the two already correct, so
there is genuinely one producer rather than one producer and two lookalikes.

| file                                       | today                | change         |
| ------------------------------------------ | -------------------- | -------------- |
| `src/lib/tools/get-training-plan.ts:15`    | unordered            | use resolver   |
| `src/lib/tools/update-training-plan.ts:73` | unordered            | use resolver   |
| `src/lib/tools/get-plan-drift.ts:10`       | unordered            | use resolver   |
| `src/app/page.tsx:209`                     | unordered, projected | use resolver   |
| `src/app/train/page.tsx:246`               | unordered            | use resolver   |
| `src/lib/week-plan/service.ts:96`          | `createdAt desc`     | delegate to it |
| `src/lib/weekly-review.ts:235`             | `createdAt desc`     | delegate to it |

**Explicitly out of scope — these resolve by explicit id and are already
correct.** They must not be touched:

- `src/lib/week-plan/project.ts:177` — by the week row's `planId`
- `src/lib/race/service.ts:206` — by `week.planId`
- `src/lib/race/debrief.ts:50` — by `raceId`, a different question entirely
- `src/lib/export/export-user.ts:228` — `findMany` over all plans, correct for
  an export

## Data cleanup — migration 0034

Archive every `active` plan per user except the newest by `created_at`.

```sql
UPDATE training_plans p SET status = 'archived'
WHERE p.status = 'active'
  AND EXISTS (
    SELECT 1 FROM training_plans q
    WHERE q.user_id = p.user_id
      AND q.status = 'active'
      AND (q.created_at, q.id) > (p.created_at, p.id)
  );
```

Idempotent; a second run matches nothing. The `(created_at, id)` tuple keeps it
deterministic if two rows share a timestamp.

This ships as a migration rather than a scoped repair script because it enforces
exactly what the resolver already decides — it changes no observable behaviour,
it removes the ambiguity behind it — and every self-hosted instance carrying
this state deserves the same resolution. On the owner's account: `f580a980` and
`ada2d390` become `archived`; `fa8854f2` stays `active`, matching the open
week's existing binding.

## What changes for the athlete

- The coach stops reporting week 1 and reports week 4.
- `update_training_plan` writes to the plan the engine reads.
- The dashboard's fallback `hoursPerWeek` moves 11.5 → 10. **Latent, not
  visible**: `weeklyTargetHours` only consults `fallbackHours` when
  `ceilingHours` or `raceDemandHours` is null (`volume.ts:77`), and the owner
  has both a dated century and the history to derive a ceiling, so the live
  target resolves through the `race`/`ceiling` branch. The correction matters
  for the day that stops being true.

## Testing

- Unit tests for the resolver: zero / one / many active rows, ordering, the
  ambiguity warning, and the `null` case.
- **One regression test that seeds three active plans and asserts all seven
  consumers return the same plan id.** This is the test whose absence allowed
  the defect: every consumer was tested in isolation against exactly one active
  plan, so each passed while the set of them disagreed. Per
  `tests-passing-is-weak-evidence`, a green suite over single-plan fixtures was
  never evidence about plan identity.
- A migration test: a multi-active fixture converges to one active, and a second
  application is a no-op.
- Any new DB-touching test file needs `describe.skipIf(!hasDb)` or it crashes CI
  rather than skipping.

## Verification beyond the gate

Neither `/` nor `/train` is rendered by `next build`, so the five-command gate
cannot see a broken render on either page. `/train` says so explicitly with
`export const dynamic = "force-dynamic"`; `/` reaches the same state
implicitly, because `requireUser()` awaits `headers()` and everything below
that point is dynamic and cannot be prerendered. Both are in this change's blast radius. **A real authenticated page
load is required** — Playwright against `next dev` works in this sandbox.

Gate, in order:

```bash
npm run format:check && npm run typecheck && npm run lint && npm test && npm run build
```

## Bundled chores

Independent of the code change, shipped alongside it.

1. **Four missing GitHub release objects**: `v0.28.0`, `v0.28.1`, `v0.29.0`,
   `v0.30.0`. All four tags are pushed and image-built; only the release pages
   are absent, so `gh release list` jumps v0.27.0 → v0.30.1. Body is the
   CHANGELOG section verbatim minus its `## ` heading line; title is the tag
   annotation subject. **All four take `--latest=false`** — v0.31.0 is newer
   than every one of them and must keep the badge. `gh release create` is
   blocked by the permission classifier here, so this is staged as a script and
   handed over as one command, not attempted call by call.
2. **Roadmap reconcile**: `docs/ROADMAP.md`'s honesty-debt entry "Weekly hours
   are a number typed once and never revisited" is still `- [ ]` although
   v0.28.0 shipped exactly that fix. Tick it with a pointer to v0.28.0.
   `ROADMAP.md` needs **two** `prettier --write` passes to converge.

## Non-goals

- **The partial unique index** — see the rejection above; gated on deciding
  import's behaviour.
- **Beau's stale open week** (`2026-07-13`, three weeks old, marathon plan
  frozen at `current_week: 1`). A separate root cause, possibly rollover,
  possibly the running-volume path. Investigating it here would double the
  release.
- **The stale `trainingBlocks` seed row.** `get_training_plan` returns the
  persisted seed block, which is never regenerated, so the coach can still quote
  a stale figure for a week not yet rolled over. This change makes it read the
  _right plan's_ blocks — the bulk of the practical harm — but stale content
  within those blocks is its own defect.
- **The six-plus `runDebriefLifecycle` passes per ride.** Real redundant work,
  unrelated to plan identity.
