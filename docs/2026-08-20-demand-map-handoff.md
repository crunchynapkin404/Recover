# Handoff — the demand map remainder, from v0.116.0

**Read this if you are picking up the next roadmap item.** Written 2026-08-20
after v0.116.0 reached production. Everything here was checked by running it or
reading the file that implements it, not by reading about it.

Authority order when documents disagree: **the code and the workflow files**,
then `docs/ROADMAP.md`, then this file.

---

## State of the world

|                   |                                                                        |
| ----------------- | ---------------------------------------------------------------------- |
| Version on `main` | **0.116.0**                                                            |
| Prod digest       | `sha256:e424e3d3…` — v0.116.0, healthy, `jobsFailed: 0`                |
| Rollback target   | `sha256:e9427387…` — v0.115.0. **Zero migrations between them**        |
| Tests             | **2895 with a database**, 2329 without (565 skip on no `DATABASE_URL`) |
| Surfaces          | 108 capture entries, ratchet ceiling **0** confirmed nodes             |
| Release path      | fully automated; **two real releases through it** (v0.115.0, v0.116.0) |

Two releases shipped on 2026-08-20: **v0.115.0** moved the whole release path
into GitHub Actions, and **v0.116.0** shipped race pacing.

---

## The demand map in `ROADMAP.md` is stale. Fix it before using it.

Its table says "Recover at **v0.65.0**" and was last read **2026-08-08**. The
project is fifty releases past that. At least one row is now wrong:

| Request                                        | Votes | Table says        | Actually                             |
| ---------------------------------------------- | ----: | ----------------- | ------------------------------------ |
| Choosing a new goal before the last one's done |   244 | **Gap** → Phase 3 | **Shipped v0.114.0** (multi-A-race)  |
| Availability beyond one week ahead             |   159 | Leads             | unchanged                            |
| Calendar                                       |   152 | Partial           | **no ICS export exists** — see below |
| Strength training                              |   121 | Absent            | unchanged                            |
| Different FTPs indoor/outdoor                  |   105 | Absent            | confirmed absent — see below         |

**Re-read the board before choosing.** The map's own header says it is updated
when the board is re-read, and twelve days plus two releases have passed. A
vote count is the one input here that goes stale on its own, without anybody
touching the repository.

---

## What actually remains, in vote order

### Calendar — 152 votes, the highest non-leading row

"Partial" is doing a lot of work in that table. What exists is Train's week
view; what does not exist is **any** calendar interchange:

```
grep -rn "text/calendar\|BEGIN:VCALENDAR\|\.ics" src/   # no hits
```

So the request is almost certainly "get my sessions into the calendar I already
use", and Recover has no answer to it. That is a real gap, and it is the kind
that is cheap to do badly: an ICS feed is easy to emit and hard to emit
_correctly_ (timezones, recurrence, stable UIDs across a replanned week, and a
feed URL that is a bearer credential in a query string).

**Check first whether the votes mean an ICS feed or an in-app month view.**
They are different products and the table does not say which.

### Strength training — 121 votes, genuinely absent

The largest of the three. It is not a feature so much as a second sport with
its own load model, and `src/lib/training-load` is built around duration and
intensity for endurance work. Treat any estimate under a release as optimism.

### Different FTPs indoor/outdoor — 105 votes, genuinely absent

```
src/lib/db/schema.ts:588   ftpWatts: integer("ftp_watts")   -- one column
```

There is no indoor/outdoor flag on activities either. **This one is more
entangled than it looks**, and v0.116.0 is why: `ftpWatts` is now read by the
demand model, the feasibility verdict, `riding-time.ts`, and — as of this
release — `racePacing`. Splitting it means every one of those has to decide
_which_ FTP it means, and the honest answer differs per caller (a race is
outdoors; a Tuesday turbo is not).

**My recommendation is this one anyway**, for two reasons. It is the only one
of the three whose machinery already exists — you are splitting a number, not
building a model. And it composes with what just shipped: `racePacing` already
carries `Figure<PacingTarget>` with a confidence, so "we used your outdoor FTP,
which you set 3 months ago" is a sentence the vocabulary can already say.

---

## Open gaps you are inheriting

- **`surfaces.yml` does not guard the race pacing line.**
  `src/app/train/page.tsx:376` returns `<PlanPreviewCard/>` when there is no
  confirmed plan, and the seeded athlete has a **draft** — so the `train`
  surface, in CI and in the soak alike, photographs a page the race card never
  renders on. A regression deleting the pacing line outright would pass 2895
  tests and a clean ratchet. Full detail and what would close it:
  `docs/2026-08-20-pacing-capture-gap.md`.
- **Triathlon and multi-day pacing refusals have never been seen rendered.**
  Unit-tested, and they go through the shared `<Unavailable>` component, so the
  risk is low — but low risk and verified are different words.
- **`scripts/repair-plan-sport.ts` refuses two-race plans** rather than handling
  them. Unchanged, and it names its own reason.

---

## Traps found on 2026-08-20, all cheap to hit again

- **`npm test` without a database skips 565 tests and still says green.** This
  cost a red CI on v0.116.0: a fourth hardcoded tool count lived in a DB-gated
  file, so it passed locally and failed only in CI. `RELEASING.md` documents
  this and I hit it anyway. Use the scratch-database command below.
- **`tsc --noEmit` and vitest disagree, in both directions.** vitest passed on
  code `tsc` rejected (union narrowing in tests — `expect(x.sport).toBe("Bike")`
  asserts but does not narrow). And `tsc` passed on code the runtime rejected
  (top-level `await` — tsx compiles to CJS, where it is a hard error). Run both.
- **Prettier does not always converge on markdown.** A list item with
  blank-line-separated paragraphs failed `--check` immediately after
  `--write`. The house pattern is one continuous 6-space block with
  `**Bold lead-in:**` markers and no blank lines inside the item.
- **The frozen MCP surface is a wire contract, not a snapshot to update.**
  `docs/API-STABILITY.md`: "A red freeze test does not mean 'fix the test.'"
  Adding a tool is allowed as additive — check the diff is insertions only
  before accepting it, and write the CHANGELOG entry the policy requires.
- **A tag pushed with `GITHUB_TOKEN` does not trigger another workflow.**
  `release-rc.yml` needs `RELEASE_TAG_TOKEN` for exactly this reason; without
  it the workflow goes green having built nothing.
- **The devbox runner is persistent, not ephemeral.** `--ephemeral` plus
  `svc.sh` runs exactly one job and then stops the service — it does not
  re-register. `docs/RUNNER.md` said the opposite until v0.115.0's own release
  proved it wrong.

---

## How to verify anything

**Everything CI runs:**

```bash
npm run lint && npm run typecheck && node scripts/migrate.mjs \
  && npm test && npm run format:check && npm run build
```

**With a database — do this before pushing, not after CI tells you:**

```bash
docker run -d --name scratch-db -e POSTGRES_USER=ci -e POSTGRES_PASSWORD=ci \
  -e POSTGRES_DB=ci -p 55432:5432 postgres:16-alpine
DATABASE_URL=postgres://ci:ci@localhost:55432/ci DATABASE_DRIVER=pg \
  node scripts/migrate.mjs
DATABASE_URL=postgres://ci:ci@localhost:55432/ci DATABASE_DRIVER=pg \
  ENCRYPTION_KEY=$(printf '0%.0s' {1..64}) \
  BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef \
  BETTER_AUTH_URL=http://localhost:3000 npx vitest run
```

Expect **2895 passed, 1 skipped** — not 565 skipped. `docker rm -f scratch-db`
after.

**To see a change in a real browser**, seed that scratch database, confirm the
draft plan (`confirmTrainingPlan` in `src/lib/training-plan.ts`), run
`npx next dev -p 3200` against it, and capture:

```bash
SCREENSHOT_BASE_URL=http://localhost:3200 OWNER_EMAIL=… OWNER_PASSWORD=… \
  npx tsx scripts/verify-surfaces.ts <slice> --only=train --no-axe-gate
```

**Then open the PNGs.** On 2026-08-20 that step found three defects in one
afternoon that 2893 tests and a clean axe report did not: a figure kind that
rendered nothing, a page that contradicted itself two lines apart, and a
feature that was invisible in every capture taken of it.

**To release:** dispatch **Release RC** → **Soak** → open the capture →
**Promote** (with the soak's run id) → **Finish Release**. `docs/RELEASING.md`
is the one statement of the path. Nothing in it is hand-run.
