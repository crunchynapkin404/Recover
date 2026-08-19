# Handoff — closing Phase 2, from v0.111.0

> **Both items below closed at v0.112.0 on 2026-08-19, and Phase 2 with them.**
> The duplicated-data scan is recorded in
> `docs/plans/2026-08-18-duplicated-data-scan.md`; the tab-pattern decision was
> taken by the owner — a link-based `ui/segmented-tabs.tsx`, not a re-vendored
> `ui/tabs.tsx`. This file is kept as written because the rest of it — the
> release-path traps, the measured ink floors, how to verify anything — is
> still current and cost real time to learn. Read §"What remains for Phase 2"
> as history rather than as a queue.

**Read this first if you are picking up the roadmap.** 2b.4's ten redesign
slices are shipped and prod runs v0.111.0. **Two items stand between here and a
closed Phase 2**, and both are 2b.4 riders rather than new work.

Authority order when documents disagree: **the code**, then `docs/ROADMAP.md`,
then this file. Everything here was verified on 2026-08-18; re-check before
citing.

---

## State of the world

|                      |                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------- |
| Version on `main`    | **0.111.0** (`817febf`)                                                             |
| Prod digest          | `sha256:4395e187…` — v0.111.0, healthy, verified by `scripts/live-verify-deploy.sh` |
| Soak stack (`:3100`) | pinned to `0.111.0-rc.1`, same bytes as prod                                        |
| axe                  | **0 confirmed nodes**, 24 surfaces × 4 theme/viewport combos, both themes           |
| Light mode           | reachable — `forcedTheme` lifted in v0.111.0                                        |
| Phase 2              | 2a ✅ · 2b **2 open** · 2c ✅ · 2d ✅                                               |

Recorded axe baseline when this began was **398** confirmed nodes
(`docs/axe-baseline-2026-08-11-seeded.md`).

---

## What remains for Phase 2

### 1. The duplicated-data scan — `docs/ROADMAP.md:572`

> "On every page touched: scan for and remove duplicated data — the same value
> shown twice. A standing finding from prior redesigns here."

Every page has now been touched, so this is due. It is **not** a token or
contrast job — it is about a number being computed or displayed twice.

**The precedent to copy** is v0.84.0 (`ROADMAP.md:643`): `page.tsx` and
`train/page.tsx` each summed `days[].availableMins` into hours independently,
and the fix was one `availableMins(days)` in `week-plan/fill.ts` with both call
sites migrated. Note what that entry also records — `constraints.hoursPerWeek`'s
~60 reads were audited and **deliberately left alone**, because they answer a
different question. Finding two reads of a similar-looking number is not the
same as finding duplication.

**One concrete instance already located**, offered as a starting thread rather
than the whole task:

```
src/components/body/range-tabs.tsx:4   export const RANGES = [30, 90, 180, 365] as const;
src/components/train/range-tabs.tsx:4         const RANGES = [30, 90, 180, 365] as const;
```

Verbatim duplicate. Body exports it, Train keeps it private, and nothing makes
them agree — the exact drift shape 2c exists to prevent.

Do the scan properly rather than stopping there: the item says _every page_.

### 2. The tab-pattern decision — `docs/ROADMAP.md:581`

> "`/body` and `/train` hand-roll their own tab bars while v0.98.0 deleted an
> unused vendored `ui/tabs.tsx`. The duplication is real; the answer is to
> choose a pattern deliberately, not to re-vendor a file because it once
> existed."

**This is the owner's call, not an agent's.** Do not pick one and implement it
unprompted. Present the options and let them decide.

What actually exists today — five hand-rolled components, 242 lines:

| File                              | Lines |
| --------------------------------- | ----: |
| `components/train/view-tabs.tsx`  |    85 |
| `components/body/body-tabs.tsx`   |    43 |
| `components/train/train-tabs.tsx` |    41 |
| `components/body/range-tabs.tsx`  |    38 |
| `components/train/range-tabs.tsx` |    35 |

They are structurally similar and differ in their href builders (Train's takes
a `LogHref`). All are server-rendered links with no client JS, which is a real
property worth preserving — a vendored Radix `Tabs` would make them client
components.

---

## Loose ends, none of them roadmap items

- **`join/[code]` has never been captured.** It is not in `SURFACES`, so no
  screenshot and no axe audit has ever seen it. v0.111.0 tokenised it blind.
  Adding it as a surface is cheap and closes a genuine blind spot.
- **`activity-detail` and `debrief-sheet` are unsoaked** on the shipped bytes.
  The RC database has no `activity_streams`, so `resolveActivityDetailPath`
  refuses to capture rather than audit `StreamDataEmpty` — correct behaviour,
  but it means those two were verified only against dev. Seeding the RC db
  fixes it: `SEED_DEMO=1 DEMO_EMAIL=dev@recover.local` with `DATABASE_URL`
  pointed at 5435.
- **`scripts/release.sh` still prints a deploy claim it does not perform** —
  see the release section below. This is the highest-value fix on this list.
- **`color-scheme` / `themeColor` are unverified.** v0.111.0 restored both, and
  no headless browser can see native chrome. Needs a real device: set the OS to
  light, open the app, look at a `<select>`, a date field and the status bar.
- **7 `*@example.invalid` users on the dev DB (5434)**, left by test runs. The
  DELETE is classifier-blocked for an agent:
  ```bash
  docker exec recover-db-1 psql -U recover -d recover \
    -c "delete from users where email like '%@example.invalid';"
  ```
- **`inline-markdown.tsx:31`'s `text-[0.95em]`** — the one remaining arbitrary
  type size. A relative em with no fixed-step equivalent, deliberate since
  slice 4. It is why that guard keeps its ceiling of 1.

---

## The release model — the thing that cost the most

**A `vX.Y.Z` tag builds nothing.** `release.yml` triggers on `v*-rc.*` only.
`RELEASING.md:264` states the trade: there is no path to production that has
not been soaked. The consequence is that **`scripts/release.sh` does not
deploy** — it merges, tags, and creates a GitHub release object, then prints:

> `Done. Watchtower pulls the new image within ~5 minutes.`

That line is false unless an RC was built and promoted. On 2026-08-18 four
releases — v0.107.0, v0.108.0, v0.110.0, v0.111.0 — were tagged and published
with **no image behind any of them**, and prod sat on v0.106.0 for a day while
five slices of work accumulated as source only. Nothing failed; nothing said
anything either.

**The real sequence:**

```bash
git tag vX.Y.Z-rc.1 && git push origin vX.Y.Z-rc.1   # release.yml builds
# soak on :3100 — the checklist in RELEASING.md:201
# Actions → Promote → rc_tag=X.Y.Z-rc.1, release_tag=X.Y.Z   ← moves :latest
scripts/live-verify-deploy.sh sha256:<promoted digest>        ← proves the deploy
```

Only the promote step deploys. `live-verify-deploy.sh` is the only thing that
proves prod actually moved — the promote workflow cannot reach the prod box and
says so itself.

**Worth fixing:** make `release.sh` refuse to tag when no matching RC image
exists, or stop printing a deploy it does not perform.

### Two traps inside the soak

- **`release.sh` does `git checkout main && git pull` in the working tree.** It
  will yank the tree out from under an in-progress branch. On 2026-08-18 this
  landed two slices' commits on local `main` instead of their branches (twice,
  recovered both times) and invalidated a guard probe measured against the
  wrong tree. **Work in a `git worktree` if a release might run**, or expect to
  re-point branches afterwards.
- **The RC database is a restore of the dev dump, so its owner's password is
  devbox's `.env` `OWNER_PASSWORD`, not `.env.rc`'s.** They differ. Signing in
  with the wrong one fails three times and aborts the whole capture. This is in
  `ENVIRONMENTS.md` and still cost a run.

---

## Design rules that are not obvious

Each of these was **measured**, and each contradicted a plan written before the
measurement. `src/lib/design/mesh-composite.ts` derives them from the CSS and
components that ship; `tests/contrast-guard.test.ts` asserts them.

- **`--ink-muted` is card-only ink.** On the mesh gradient it measures 3.11:1
  (light) / 3.27:1 (dark) against the full depth stack — below the 4.5 floor.
  Un-carded text takes `--ink-secondary` or better. Pinned two-sided, so if
  ink-muted ever becomes safe the guard fails and the restriction gets deleted.
- **`.glass` is opaque in light and translucent in dark**, so the floor on a
  glass card is `--ink-secondary` (6.00:1); ink-muted is **3.60:1** there.
- **`--surface-raised` equals `--surface-overlay` in light** — both `#ffffff`.
  Inside a sheet or overlay use `--surface-selected`; `globals.css:130` records
  why the token exists.
- **`--accent` is icon-only on the gradient** (3.34:1) — never text.
- **Tailwind v4 ships its palette in oklch, and those are not the v3 hexes.**
  `emerald-500` is `#00bc7d`, not `#10b981`. A lookup holding v3 values makes
  every composite wrong; `mesh-composite.ts` carries the corrected table.
- **The guards scan source text, so comments count.** A banned class spelled
  inside a comment is an offender. This caught itself twice.

---

## Guard state

- **Ad-hoc white/black alpha is at ZERO** and its assertion is now a real `it`,
  not an `it.fails`. Its ratchet entry is deleted. The next ad-hoc alpha
  anyone adds **fails the build**.
- **Arbitrary type sizes: ceiling 1**, with the reason recorded in the comment
  above it. Still an `it.fails` pair, deliberately.
- `renderableThemes()` now returns **both** themes, because `forcedTheme` is
  gone. Every inline-literal AA assertion is therefore measured twice. That
  tripwire caught `day-actions.tsx` at 2.52:1 the moment it armed.

## How to verify anything

**The gate list is `.github/workflows/ci.yml`, and CONTRIBUTING.md's "Quality
gates" mirrors it.** Run all of it, not a subset — the block below used to
name three of the six, and a pull request that followed it exactly still went
red on `format:check` (2026-08-19).

```bash
# every gate CI runs, in its order
npm run lint
npm run typecheck
node scripts/migrate.mjs        # the production runner; a migration that
                                # breaks on deploy breaks the PR first
npm test                        # 2213 pass, 1 expected fail (2201 at v0.111.0)
npm run format:check            # easy to skip locally; never skipped in CI
npm run build

# surfaces (dev server — NOT 3100, which serves a released image)
BETTER_AUTH_URL=http://localhost:3200 TRUSTED_ORIGINS=http://localhost:3200 \
  npx next dev -p 3200
SCREENSHOT_BASE_URL=http://localhost:3200 \
  OWNER_EMAIL=demo@recover.local OWNER_PASSWORD=recover-demo \
  CHROME_PATH=$HOME/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell \
  npx tsx scripts/verify-surfaces.ts <name>
```

**Do not source `.env` before vitest** — it writes real rows to the dev
database. **Do** source it before seeding, and export `DATABASE_URL` _after_.

**Open the PNGs.** Every slice that ran the capture found something axe could
not see: a clipped table column behind a clean `confirmed: 0`, day labels
colliding into `MOTUWETHFRSASU`, a near-invisible label on a gradient. A run
that emits files is not evidence; a run whose files you looked at is.
