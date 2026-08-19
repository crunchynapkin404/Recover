# Handoff — Phase 3 open, from v0.113.0

**Read this first if you are picking up the roadmap.** Phase 2 is **closed** —
every checkbox in 2a, 2b, 2c and 2d — and prod runs v0.113.0. Phase 3 is open
and nothing blocks starting it.

Authority order when documents disagree: **the code**, then `docs/ROADMAP.md`,
then this file. Everything here was verified on 2026-08-19; re-check before
citing. Its predecessor,
`docs/2026-08-18-phase-2-close-handoff.md`, is still worth reading for the
release-path traps and the measured ink floors — that half has not changed.

---

## State of the world

|                   |                                                                    |
| ----------------- | ------------------------------------------------------------------ |
| Version on `main` | **0.113.0** (`01b924a`)                                            |
| Prod digest       | `sha256:651f366c…` — v0.113.0, healthy, `jobsFailed: 0`            |
| Previous digest   | `sha256:510bdb3f…` — v0.112.0, the rollback target                 |
| Migrations        | **zero across the last three digests** — rollback is unconstrained |
| Surfaces          | **26**, 104 combinations, **0 confirmed axe nodes**, both themes   |
| Phase 2           | **closed** — 2a ✅ 2b ✅ 2c ✅ 2d ✅                               |
| Phase 3           | 3 items open, none started                                         |

Two releases shipped on 2026-08-19: **v0.112.0 "Once"** (the duplicated-data
scan and the tab pattern, which closed Phase 2) and **v0.113.0 "Looked At"**.

### Open pull requests

Both are bookkeeping. Neither blocks anything; prod already runs what they
describe.

- **#161** — records v0.113.0's digest in `ENVIRONMENTS.md`, pins the soak
  stack to `0.113.0-rc.1`. CLEAN.
- **#162** — the release-object title convention and why two releases shipped
  without a release page. Check CI before merging.

---

## What Phase 3 is, and what it needs first

### 1. Multi-A-race seasons — the 244-vote request

The **#1 ranked external request** and the only demand-map row marked **Gap**.
It is also the skipped `v0.53`, the point where the roadmap stopped tracking
its evidence. `ROADMAP.md:55` names the lesson: _"The failure was not speed. It
was working without a source."_

**The design is written and merged**:
`docs/specs/2026-08-19-multi-a-race-seasons-design.md`. Two findings in it
resize the job, and both came from reading the code rather than assuming:

- **The plan is single-race by construction.** `previewTrainingPlan` and its
  siblings take one `raceId`; `periodize()` returns one Base → Build → Peak →
  Taper arc sized to one date. There is no parameter for a second race.
- **The second race's taper already works.** `racesForWeek`
  (`src/lib/race/service.ts:198`) selects every upcoming race in a 28-day
  window sorted priority-A-first, with no filter to a plan target — so when
  race two's taper weeks arrive it _is_ `races[0]` and `materializeWeek` tapers
  it unchanged.

So the hole is neither "multi-race is unsupported" nor the taper. It is:

> a full periodised arc to race one, a correct taper for race two, and
> **nothing structured in between**.

**Its prerequisite is done.** `docs/specs/2026-08-19-taper-evidence.md`
connected the taper constants to Bosquet et al. 2007 and the 2023 endurance
meta-analysis, moving six of seven from Invented/Low to **Medium** with no
behaviour change. That was done first on purpose, because this feature runs the
taper twice per season.

**What it still needs is literature, not code.** Three claims, none of which
should be answered by taste:

- How long is the transition between two A-races, and does it scale with the
  first race's distance class?
- Can the second peak equal the first, or must the plan say it will be lower?
- What is the minimum inter-race gap below which a second A-race should be
  **refused** rather than planned badly? A refusal that names its reason is
  this repo's established pattern (`{ ok: false, reason }` in
  `previewTrainingPlan`).

Do the evidence slice the way the taper one was done — find the
endurance-specific work, write `docs/specs/…-evidence.md`, then build on cited
numbers.

### 2. Race pacing — the skipped v0.54

Untouched. Pacing bands with confidence and assumptions made visible.

### 3. Remainder of the demand map, by votes

---

## Still the owner's call, not an agent's

Four things are deliberately unresolved and recorded rather than decided.

- **Three duplicated-data findings** from the v0.112.0 scan, all the same shape
  as the Sleep-tab one held under 2b.3: Today's hero why-line against the
  vitals grid; `JustLandedCard`'s `Delivered:` line against the stats grid
  ~10px below it; the Sleep tab's `LAST NIGHT · 6:51` against the trend's
  `6.9h`. Full working in `docs/plans/2026-08-18-duplicated-data-scan.md`.
- **Race week reduces training frequency**, which both taper meta-analyses say
  not to do. Bounded to race week and recorded in `race/taper.ts` rather than
  resolved, because no studied protocol ends in a maximal race.

---

## What v0.113.0 taught, because it will happen again

Every defect in that release came from **capturing two surfaces nobody had ever
captured**. None were found by tests, and axe reported `0 confirmed` throughout.

- **`coach-history` had been a false pass at desktop since the surface
  existed.** Coach has two History mechanisms — mobile links to
  `/coach?history=1`, desktop opens a dropdown from client state — and the
  param does nothing at lg+. Every desktop run screenshotted the ordinary Coach
  page under a name promising the History panel. `assertOnSurface` compares
  pathname only, so it agreed.
- **A live hydration mismatch on three surfaces**, in a plain browser with no
  harness. React was discarding and regenerating the client tree.
- **The History panel's selected row was colour-only** — a WCAG 1.4.1 failure
  axe cannot report, because "this link is the page you are on" is not
  inferable from a class.

**The lesson, stated once:** `0 confirmed` means "nothing failed on the
surfaces we look at". Ask which states have never been rendered. If a surface
can reach a URL without reaching the state its name promises, assert the
**state**, not the path — `SURFACE_PREPARE` in `verify-surfaces.ts` is where
those guards live, and every one of them was added after it caught something.

Two traps found the same day, both cheap to repeat:

- **A z-index defect that was not one.** `.menu-pop` is a 160ms fade and
  Playwright calls an element visible as soon as it has a box, so the first
  capture photographed a half-transparent panel. It read exactly like a
  stacking bug. Check the CSS before reporting one. Worse, axe was auditing the
  same see-through panel.
- **A screenshot that omitted its own subject.** The History panel scrolls;
  the selected row was "visible" to Playwright and absent from the PNG.

---

## How to verify anything

**The gate list is `.github/workflows/ci.yml`, and CONTRIBUTING.md's "Quality
gates" mirrors it.** Run all of it, not a subset — a pull request that followed
an older, three-of-six list still went red on `format:check`.

```bash
npm run lint
npm run typecheck
node scripts/migrate.mjs
npm test                      # 2238 pass, 1 expected fail
npm run format:check
npm run build

# surfaces (dev server — NOT 3100, which serves a released image)
BETTER_AUTH_URL=http://localhost:3200 TRUSTED_ORIGINS=http://localhost:3200 \
  npx next dev -p 3200
SCREENSHOT_BASE_URL=http://localhost:3200 \
  OWNER_EMAIL=demo@recover.local OWNER_PASSWORD=recover-demo \
  CHROME_PATH=$HOME/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell \
  npx tsx scripts/verify-surfaces.ts <name>     # 104/104, 0 confirmed
```

**Do not source `.env` before vitest** — it writes real rows to the dev
database. **Do** source it before seeding, and export `DATABASE_URL` _after_.

**Open the PNGs.** Every slice that ran the capture found something axe could
not see. A run that emits files is not evidence; a run whose files you looked
at is.

---

## Releasing: use the script

`scripts/release.sh` exists because the tail is the part that gets half-done.
Its header says not to hand-run the steps individually. **v0.112.0 and v0.113.0
were both hand-run on 2026-08-19 and both reached production with no GitHub
release object**, discovered only when someone asked where the notes were —
the fourth and fifth time after v0.28.0–v0.30.0.

The classifier restriction is **mode-dependent**: with auto mode off an agent
can run `gh pr merge`, `gh release create`, tag pushes and `gh workflow run`,
while `git push origin main:main` is still denied. Being allowed to hand-run
the tail is not a reason to.

Two soak traps, both documented in `RELEASING.md` and both still easy to hit:

- **The RC database needs seeded streams**, or `activity-detail` renders
  `StreamDataEmpty` and takes `debrief-sheet` with it — eight failures that are
  a seeding gap, not a defect. `SEED_DEMO=1 DEMO_EMAIL=<owner>`.
- **The RC owner's password comes from `.env`, not `.env.rc`**, and re-seeding
  does not reset an existing user's password. Using the wrong one fails sign-in
  three times and captures nothing.

And one that is not a trap: **Today's `?state=` surfaces cannot be captured
against the RC**, because the param is refused when `NODE_ENV` is production.
All three render the same real state and `assertTodayStatesDiffer` catches the
byte-identical captures. Capture those three against a dev server. A soak
capture exiting non-zero for **only** that reason is a pass.

---

## One environment fact worth keeping

`turbopack.root` is pinned in `next.config.ts`. It is there because a stray
`npm install` in `$HOME` on 2026-08-18 made Turbopack infer the whole home
directory as the workspace root, and `next dev` spent an evening compiling
against ~9 GB — routes taking minutes, `.next/dev/cache` at 1.4 GB, the server
blocked for 4–9 minutes at a time while it wrote the cache out. It never
errors, so it reads as a hang.

**If a dev server here goes unresponsive with no error, read the startup banner
first.** "We detected multiple lockfiles" means the root is wrong. The shared
Playwright install lives at `~/.local/share/playwright-global` specifically so
its lockfile is not an ancestor of any project; do not move it back to `$HOME`.
