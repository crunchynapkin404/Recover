# v0.108.0 — slice 6 phase B, the Activity redesign — session handoff

**Read this first if you are picking up Activity.** Everything here was true on
2026-08-17. Authority order when documents disagree: **the code**, then
`docs/ROADMAP.md`, then this file. Re-check before citing.

The general redesign handoff — token names, the per-slice recipe, environment
traps — is `docs/v0.99-redesign-handoff.md` and is still accurate. This file
covers only what changed since, and what slice 6 phase B specifically inherits.

---

## Where things stand

**v0.107.0 is in PR #145**, green, mergeable, not merged.
<https://github.com/crunchynapkin404/Recover/pull/145>

It is slice 6's **phase A** — capture tooling, seeding and measurement. It
changes no rendered style. If it is still open when you start, merge it before
doing anything else; phase B builds directly on its surfaces.

**Shipped and live:** v0.106.0 (Settings redesign) is in production on
`sha256:2ed296b1…`. Rollback target is v0.105.1's `sha256:4f2abdc0…`, recorded
in `docs/ENVIRONMENTS.md`. Neither release carries a migration, so an image
rollback past either is safe.

**Slices 0–5 are complete.** Four remain: **6 (Activity, phase B — you)**,
7 (Admin + Import), 8 (pre-auth), 9 (sweep, which lifts `forcedTheme="dark"`).

---

## What phase A already did for you

Three things exist now that did not before, and all three are load-bearing:

1. **`activity-detail` is a captured surface.** `/activity/[id]` had no
   `SURFACES` entry at all, so its entire render chain had never been
   photographed or axe-audited. It is now resolved at run time by
   `resolveActivityDetailPath` in `scripts/verify-surfaces.ts`, which navigates
   and **proves** `[data-stream-chart]` is in the rendered DOM before returning.
2. **`debrief-sheet` is a captured surface**, deep-linked at
   `/?sheet=debrief&activity=<id>`, guarded by a `SURFACE_PREPARE` entry that
   waits for `[role="dialog"]` and throws if absent.
3. **`activity_streams` is seeded** — five series at ~300 varying points plus a
   laps row — so the detail page renders real charts instead of
   `StreamDataEmpty`. `scripts/seed-demo.ts` also puts the pending debrief on a
   **different** activity than the one carrying streams, deliberately: they
   collided at first and the debrief panel visually occluded the charts.
   `tests/seed-demo-activity-streams.test.ts` locks that invariant.

## The baseline you must drive to zero

Measured 2026-08-17, 4/4 theme/viewport combos each, zero skipped:

| Surface           | Confirmed | Note                                         |
| ----------------- | --------: | -------------------------------------------- |
| `activity-log`    |        46 | the manual-entry form                        |
| `activity-detail` |     **0** | **but 240 indeterminate — not a clean pass** |
| `debrief-sheet`   |        43 | first-ever measurement                       |
| **total**         |    **89** |                                              |

**`activity-detail`'s zero is the trap in this release.** `indeterminate` means
axe could not compute a contrast ratio, not that contrast is fine. Of every 60
indeterminate nodes, **52 are the page's own text** — the `<h1>`, the metric
tiles, the breadcrumb — reading `contrastRatio: 0` because they sit over the
page's gradient blob. Only 8 are chart-internal. A migration that drives
`confirmed` to zero while leaving 240 unresolvable nodes has not finished the
job; the gradient background is the thing to deal with.

---

## The work, measured 2026-08-17

**~144 class-site edits across seven files:**

| File                                              | arbitrary type | ad-hoc ink | default scale | bare white |
| ------------------------------------------------- | -------------: | ---------: | ------------: | ---------: |
| `components/debrief/debrief-sheet.tsx`            |             11 |         17 |             0 |         15 |
| `components/activity/activity-log-form.tsx`       |              0 |         15 |            13 |         16 |
| `app/activity/[id]/page.tsx`                      |              6 |          7 |             0 |          7 |
| `components/debrief/activity-debrief-section.tsx` |              5 |          5 |             0 |          4 |
| `components/activity/laps-table.tsx`              |              3 |          6 |             0 |          5 |
| `components/activity/stream-chart.tsx`            |              2 |          3 |             0 |          2 |
| `components/activity/delete-activity-button.tsx`  |              0 |          1 |             0 |          1 |
| **Total**                                         |         **27** |     **54** |        **13** |     **50** |

**Two things about this list that will bite if you skip them.**

**Bare `text-white` / `bg-white` is the largest class here — 50 sites — and no
guard matches it.** `ADHOC_INK` requires a `/N` alpha, so these are invisible to
`tests/type-scale-guard.test.ts` and to every per-task grep that only copies that
pattern. Slice 5 found 8 of them; Activity has six times as many. Always include
`\b(text|bg)-white\b` in your checks. Raw `text-white` on a light ground is also
the exact defect still open on Today.

**20 of the 27 arbitrary sizes are below the 12px floor**, and they go lower than
anything previous slices met: 6 × `text-[11px]`, 5 × `text-[11.5px]`,
3 × `text-[9.5px]`, 2 × `text-[10px]`, 2 × `text-[10.5px]`, 1 × `text-[9px]`,
1 × `text-[8.5px]`. At 12px that is a 41% jump for the smallest. **Expect at
least one editorial cut** — slice 4 deleted a per-message timestamp, slice 5
deleted an `(example data)` span. Below the floor there is no quieter ink to
give something; it gets restated or deleted, never shrunk.

**`debrief-sheet.tsx` is shared with Today** (`components/today/sheet-host.tsx`),
so migrating it moves a surface slice 1 signed off as clean in v0.100.0.
Re-measure Today rather than assume.

## Guard ceilings

`tests/type-scale-guard.test.ts`, currently **`"arbitrary type sizes": 52** and
**`"ad-hoc white/black alpha utilities": 127**. Both are pinned tight against the
real counts. The ratchet is two-sided: it fails if the real count exceeds the
ceiling **and** if the ceiling sits more than `RATCHET_SLACK` (25) above it, so a
slice that drives a number down is forced to re-pin. Re-pin tight at the end.

---

## Environment traps, each of which cost a run

- **`set -a; . ./.env; set +a` overwrites anything you exported before it.** A
  command that exports `DATABASE_URL=…5435` and then sources `.env` reads
  **5434**, the dev database. `.env` names 5434; the soak stack on 5435 is
  restore-only and gets its own seeding at release time.
- **`TRUSTED_ORIGINS=http://localhost:3200` is required** when serving on any
  non-default port, or Better Auth refuses sign-in and every capture fails at
  login. This is not yet in `docs/RELEASING.md`.
- **`npm run verify:surfaces -- <name>`'s argument is the output directory, not
  a surface filter** (`scripts/verify-surfaces.ts:371`). Every run captures every
  surface and takes 30–45 minutes. **A non-zero exit is expected** while `admin`
  carries its debt — do not read it as failure.
- **Never write a wait loop as `pgrep -f "verify-surfaces"`.** That pattern
  matches the watcher's own command line and never exits. Use
  `pgrep -fa "tsx.*verify-surfaces\.ts"`. This cost an hour in v0.106.0.
- **`axe-report.json`'s `confirmed` is a list of _rule_ objects**, each holding
  its own `nodes` array. `len(confirmed)` counts rules and under-reports badly —
  it reported `admin` as 4 when the truth was 208, and that number reached a
  shipped CHANGELOG. Count nodes, and assert `skipped == 0`: a skipped combo has
  no `confirmed` key, scores 0, and is indistinguishable from a clean pass.
- **`npx vitest run` with `.env` sourced writes real rows** to whatever database
  `.env` names. It leaves `*@example.invalid` fixture users behind.
  `docs/RELEASING.md` prescribes deleting them and records that this exact debris
  class once reached production.

---

## Outstanding, inherited

- **7 `*@example.invalid` users on the dev database (5434)** need clearing. The
  auto-mode permission classifier blocks the DELETE for an agent, so a human has
  to run it:
  ```bash
  docker exec recover-db-1 psql -U recover -d recover \
    -c "delete from users where email like '%@example.invalid';"
  ```
- **Two knowingly-false comments shipped in v0.106.0.**
  `src/components/settings/notifications-card.tsx:155` and
  `body-prefs-card.tsx:145` claim the accent swap is "byte-identical" to
  `bg-emerald-500`. Tailwind v4 ships that as `oklch(69.6% 0.17 162.48)` against
  `--accent`'s `#10b981` — visually indistinguishable, but not identical. One
  line each, fix on next touch.
- **`src/components/ui/inline-markdown.tsx:31`'s `text-[0.95em]`** — a relative
  em with no fixed-step equivalent, deliberately left since slice 4.
- **Today's light-only `text-white` readiness sentence** — 2 nodes per state, 6
  total, recorded for the slice 9 sweep.
- **`scripts/verify-surfaces.ts` now carries three near-identical resolve /
  capture / catch / record blocks** (`coach-thread`, `activity-detail`,
  `debrief-sheet`). A `captureResolved(name, resolvePath)` helper would collapse
  ~90 lines to ~30, and slices 7–9 will add more. Worth doing here.
- **`admin` is 182–208 confirmed depending on data state**, far above the 147 its
  baseline records. Slice 7 must re-measure rather than trust either number.

---

## The lesson that costs most to relearn

**Ask what a surface hides before believing its number.** Five consecutive slices
have found a surface whose reported figure described its content closed — Train's
tabs, Body's tabs, Coach's thread, Settings' five collapsed sections, and now the
activity detail page and the debrief sheet. Every one was found the same way, by
asking which state a PNG was actually of.

**And a zero proves only what was measured.** `settings-connect-errors` audited a
fallback string for a whole release because its query params matched no
`ERROR_MESSAGES` key. `activity-detail` reports 0 confirmed with 240
unresolvable. v0.106.0's `DISCONNECT` pill was clipped off-screen behind a clean
`confirmed: 0`, because `color-contrast` cannot see layout. **Open the
screenshots.** That step has caught something in every slice that ran it.
