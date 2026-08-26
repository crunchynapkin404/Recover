# Contributing to Recover

Thanks for your interest! Recover is a small self-hosted project maintained in
spare time — contributions are welcome, and small, focused ones land fastest.

## Development setup

Requirements: Node 22+, Docker (for Postgres).

```bash
git clone https://github.com/crunchynapkin404/Recover.git
cd Recover
npm ci
cp .env.example .env        # set ENCRYPTION_KEY + BETTER_AUTH_SECRET at minimum

# Postgres from the compose file (published on 127.0.0.1:5434 for host tooling)
docker compose up -d db
echo 'DATABASE_URL=postgres://recover:recover@127.0.0.1:5434/recover' >> .env
echo 'DATABASE_DRIVER=pg' >> .env

npm run db:migrate          # apply migrations
npm run db:seed             # owner account (uses OWNER_EMAIL/OWNER_PASSWORD)
npm run dev
```

**If `next dev` goes unresponsive, read its startup banner first.** Turbopack
infers the workspace root as the outermost directory holding a lockfile, so a
stray `npm install` anywhere above the repo silently moves the root there —
`next dev` then compiles, watches and caches against that whole tree. On
2026-08-18 a lockfile left in `$HOME` cost an evening: single routes took
minutes to compile, `.next/dev/cache` reached 1.4 GB, and writing it back
blocked the server for 4-9 minutes at a time (`✓ Finished writing to
filesystem cache in 8.8min`). It never crashes, so it reads as a hang.

`turbopack.root` in `next.config.ts` pins this, and the banner is the check:
a "We detected multiple lockfiles" warning means the pin is not taking. After
changing it, delete `.next/dev` — the old cache is keyed to the old root.

### Demo data

For UI work and screenshots, seed a demo account with 90 days of plausible
training history (deterministic and idempotent — safe to rerun):

```bash
SEED_DEMO=1 npm run db:seed-demo
# login: demo@recover.local / recover-demo
```

### Design verification: screenshots + axe

Every redesign slice is checked visually and for accessibility violations
with `scripts/verify-surfaces.ts`, which captures each surface in both
themes and two viewports, then audits the same loaded page with `axe-core`
in the real browser (not `vitest-axe`/jsdom — most surfaces are async server
components that don't render there, and jsdom computes no layout regardless,
so it can't see a contrast or overlap violation). It needs a headless
Chromium, a server on a port that is not production's, and the
`OWNER_EMAIL`/`OWNER_PASSWORD` pair from `npm run db:seed` above (it must be an
owner — `/admin` is one of the captured surfaces and redirects any other role).

Install the browser once per machine. `playwright-core` is a pinned
devDependency, so `npm ci` already provides the driver:

```bash
npm run dev:browser-setup
# system libraries need root. node is under nvm here, so `sudo node` will not
# find it — pass the absolute path:
sudo "$(which node)" node_modules/playwright-core/cli.js install-deps chromium
```

**Which target you want depends on what you are verifying, and the two are not
interchangeable.**

- **Verifying a RELEASE CANDIDATE** — point it at a production build. Lazy
  compilation makes first navigations slow enough to trip the script's
  `networkidle` waits, and the dev server's memory footprint next to a headless
  browser is enough to push a small box into swap; an out-of-memory dev server
  renders a page with none of its blocks, which the script correctly reports as
  a block-order mismatch. The release-candidate stack in
  `docker-compose.dev-rc.yml` serves a real production image on **3100** and is
  what `docs/RELEASING.md` step 7 uses.
- **Verifying a SLICE still in progress** — that same 3100 stack is the wrong
  target, and silently so: it serves a **released image**, so you measure the
  last release rather than your working tree and everything looks unchanged
  because it is. Run a dev server on a free port (**3200**) with
  `BETTER_AUTH_URL` and `TRUSTED_ORIGINS` both set to that same origin —
  Better Auth refuses the login if `BETTER_AUTH_URL` names a different port —
  and accept the dev-server caveats above.

The release-candidate form:

`--only=a,b` and `--except=a,b` narrow the run; without either, all 32 surfaces
are captured. Both reject an unknown name rather than quietly matching nothing,
and both cover the five surfaces `main()` resolves at runtime as well as the 22
in the `SURFACES` literal. `.github/workflows/surfaces.yml` uses them to split
the capture — see "Can this run in CI?" below for why that split is mandatory.

```bash
SCREENSHOT_BASE_URL=http://localhost:3100 \
  OWNER_EMAIL=... OWNER_PASSWORD=... \
  npm run verify:surfaces -- <slice-name>
# → .screenshots/<slice-name>/*.png (gitignored)
# → .screenshots/<slice-name>/axe-report.json — per surface/theme/viewport,
#   axe's "violations" AND "incomplete" results (both requested; a literal
#   "violations"-only filter silently misses real invisible-text bugs behind
#   this app's gradient backgrounds — see the script's header comment),
#   filtered to "serious"/"critical" impact and then split into TWO
#   separate, clearly-labelled metrics (scripts/lib/axe-report.ts):
#     confirmed      — axe actually computed a failure. Gates the exit code.
#     indeterminate  — axe could not compute an answer at all (e.g. text
#                      over a composited CSS gradient). Reported, but never
#                      gates the exit code — on this app's four
#                      gradient-background surfaces the check can never
#                      resolve, so gating on it would make "drive the
#                      number to zero" permanently unreachable.
#   Node-level counts (DOM elements affected) are the number to trust; a
#   rule-row count alone can hide a real regression — see
#   docs/axe-baseline-2026-08-11-seeded.md. Exits non-zero if any surface has
#   a confirmed finding.
```

There is also `npm run verify:axe-split-proof`, which re-runs the committed
browser proof that the confirmed/indeterminate split discriminates correctly
in both directions (`scripts/axe-split-proof.ts`). Same `CHROME_PATH` /
`LD_LIBRARY_PATH` requirement; it needs no server and no database.

#### Can this run in CI? It does now — `.github/workflows/surfaces.yml`

`docs/specs/2026-08-11-2b4-visual-redesign-design.md` listed axe under "Guards
that fail the build" before it was one, and this section spent four releases
explaining why it was not. All four reasons are now closed. They are kept here
because each names a real property of the check, and anyone changing
`surfaces.yml` needs to know which of them they are about to reopen.

1. **A zero-threshold gate would fail every pull request from slice 0 to slice 8.** This was the decisive one — the recorded baseline was **398 confirmed
   defect nodes** (`docs/axe-baseline-2026-08-11-seeded.md` §10) and was
   _supposed_ to be non-zero until the surfaces were migrated. **Closed by a
   ratchet**, the shape `tests/type-scale-guard.test.ts`'s `OFFENDER_CEILINGS`
   uses: `scripts/lib/surface-ratchet.ts` fails on a **rise** against
   `surface-ceilings.json`, never on non-zero. Lowering the ceiling is routine;
   raising it needs a reason in the commit message.

   `indeterminate` is summed and printed but **never gates**. On this app's four
   gradient-background surfaces axe can never compute an answer, so gating it
   would make "drive the number to zero" permanently unreachable.

   **The ceiling is measured by a run, never typed from a document.** It ships
   as `-1`, which nothing can pass, and the first green run re-pins it. A number
   copied out of prose is how this project has been wrong about counts in both
   directions.

2. **A seeded database, not just a migrated one.** CI's Postgres service is
   created empty and only migrated, and seeding alone moved the node count
   1398 → 1687 (+20.7%, Train +600%) because the charts, badges, week rows and
   tables where sub-AA colour actually lives are simply not on screen for an
   empty account. **Closed:** each capture job runs `db:seed`, `db:seed-demo`,
   `seed-confirmed-race.ts` and `seed-two-race.ts`, in that order (see the
   first script's file header for why the order isn't arbitrary) — all
   deterministic and idempotent — and the run's
   real-API-token create/revoke is _safer_ against CI's throwaway database than
   against a dev one.

   The jobs seed **the owner they then sign in as**. `/admin` is a captured
   surface and redirects every other role, and seeding `demo@recover.local`
   instead is the 2026-08-14 defect that voided every reading taken before
   2026-08-16. Establishing the credential in the same job that uses it closes
   that by construction rather than by remembering.

3. **A running server.** CI built but never started the app. **Closed — and it
   needed two jobs, not one.** `previewStateFrom` (`src/lib/today/state.ts`)
   returns `null` when `NODE_ENV === "production"`, so a production build
   renders whichever state the clock dictates for `today`, `today-post-session`
   and `today-evening`; `assertTodayStatesDiffer()` then fails the run on the
   byte-identical PNGs, correctly. So `surfaces.yml` runs a production build for
   every shipping surface and a `next dev` server for exactly those three.

   **Do not merge those two jobs back together.** A single job would capture the
   wrong page for three surfaces and report success — the `assertOnSurface`
   trap in a different costume.

   The split is also why `verify-surfaces.ts` takes `--only=` / `--except=`.
   Before that, `argv[2]` was only an output directory name and `main()` always
   walked every surface. The filter lives inside `captureResolved` and the
   `captureTokenCreated` call rather than around the `SURFACES` loop, because
   five surfaces — `coach-thread`, `coach-history-active`, `activity-detail`,
   `debrief-sheet`, `settings-token-created` — are resolved at runtime and are
   not in that literal. 22 literal + 5 resolved = 27, at four theme/viewport
   combos each.

4. ~~**`playwright-core`, which this repo does not depend on at all.**~~
   **CLOSED in v0.104.0.** It is an exact-pinned devDependency and
   `npm run dev:browser-setup` fetches the matching Chromium, so `npm ci` is
   enough to make the script resolvable. Undeclared tooling stops existing when
   the machine changes — the old npx-cache path did not survive the move to a
   new dev box on 2026-08-14, and every redesign slice was unverifiable until it
   was declared.

   In CI, `CHROME_PATH` is deliberately left unset: `playwright-core` resolves
   the browser it installed. A revision-keyed path hardcoded into a workflow is
   the same mistake at a different address.

**What IS already in CI:** `tests/axe-report-split.test.ts` runs under
`npm test`, and pins the confirmed/indeterminate classification logic against
verbatim real-browser result shapes. So the axe _reasoning_ is guarded on
every pull request; only the axe _run_ is local.

## Quality gates

These are every gate in `.github/workflows/ci.yml`, in its order. Run all of
them locally before pushing — `format:check` in particular is easy to skip by
hand and is never skipped in CI.

```bash
npm run lint
npm run typecheck
node scripts/migrate.mjs     # the same runner Dockerfile:42 executes on every
                             # deploy, so a migration that would break on
                             # deploy breaks the pull request first
npm test
npm run format:check
npm run build
```

**A `typecheck` error whose path starts with `.next/` is almost never yours.**
Those files are generated, and a dev server, a `build`, or another checkout of
this repo regenerating them mid-run makes `tsc` read one half-written. Seen
2026-08-26:

```
.next/dev/types/validator.ts(134,1): error TS1109: Expression expected.
```

A parse error inside generated output, on a branch that changed no route. It
passed on the very next run with nothing deleted. **Run it again before you
bisect your own diff** — the instinct on a red typecheck is to suspect the
change in front of you, and here that hunts a bug that was never there. If it
survives a re-run, `rm -rf .next/types` and try once more; only treat it as
real when it survives both. To settle it in one command:
`git stash && npm run typecheck && git stash pop`.

**"This page couldn't load" locally, while `npm test` is green, usually means
the dev database is behind.** `npm test` runs against a scratch database this
repo migrates from scratch, so it proves nothing about the long-lived dev
database on `127.0.0.1:5434` — that one only advances when someone runs the
migration. Pull a branch whose feature added a column and every page reading
that table fails, with `42703 errorMissingColumn` in the server log. It reads
exactly like a broken branch and is not one. Found 2026-08-26 with the dev
database three migrations behind: `body_prefs` had neither `ftp_watts_indoor`
(v0.118.0) nor the four one-RM columns (v0.119.0), and Today and Body both
refused to render.

```bash
# how far behind, and what the table actually has
docker exec recover-db-1 psql -U recover -d recover \
  -c "select count(*) from drizzle.__drizzle_migrations;"   # vs. ls drizzle/*.sql | wc -l
docker exec recover-db-1 psql -U recover -d recover -c "\d body_prefs"

npm run db:migrate
```

Both of these are the same trap: **a signal that looks like your mistake and
belongs to the environment.** Check the environment before the diff.

A second job builds the Docker image (`docker build -t recover .`); it needs no
local equivalent, but it is what gates the release path.

**`ci.yml` is not the only workflow that gates a pull request.**
`.github/workflows/surfaces.yml` captures every surface in a real browser and
ratchets the axe result; it has no single-command local equivalent because it
needs a seeded database, a running server and a Chromium. Run it locally the
long way (see "Real-browser screenshots" above) or read the capture artifact
the workflow publishes. **A run that emits files is not evidence — open the
PNGs.**

## Principles

A few rules this codebase holds itself to (the long version is in
[docs/PLAN.md](docs/PLAN.md)):

1. **No broken imports.** Code isn't copied from other projects on trust —
   anything ported arrives with unit tests proving it, or it's rewritten.
2. **One tool registry, two consumers.** Every data capability is a single
   `{name, description, inputSchema, execute}` object in `src/lib/tools/`,
   serving both the AI coach and the MCP endpoint. New capability = one file.
3. **Provenance everywhere.** Every activity/wellness row records its source;
   Strava rows are excluded from AI contexts by default.
4. **Secrets encrypted at rest**, decrypted per request, never logged.
5. **Boring operations.** One container + Postgres. No new infrastructure
   dependencies without a very good reason.

## Pull requests

- Keep PRs focused — one change per PR, no drive-by refactors.
- New behavior comes with tests (`tests/` and `src/**/*.test.ts` have
  examples of both unit and integration styles).
- Security-sensitive surfaces (auth, MCP endpoint, token handling, crypto)
  get extra scrutiny; expect questions.
- Check [docs/ROADMAP.md](docs/ROADMAP.md) before building a big feature —
  open an issue first so we can agree on direction before you invest time.

## Reporting bugs

Use the issue templates. For anything security-sensitive, **do not open a
public issue** — see [SECURITY.md](SECURITY.md).
