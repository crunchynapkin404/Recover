# v0.99 slice 2 (Train) — execution ledger

**Tracked companion to `docs/plans/2026-08-12-v099-slice2-train.md`.** The plan says
what was intended; this says what happened, and carries the agenda for the
whole-branch review.

Kept in `docs/` deliberately. The working copy at `.superpowers/sdd/progress.md` is
**gitignored** (`.gitignore:55`, "never commit local tooling state") — it does not
travel with the branch, a clone or a PR, and `git clean -fdx` erases it. This file is
the source of truth; update it in the same commit as each task boundary so it cannot
drift behind.

Branch: `v0.101-train-at-the-floor`, off `main` at `72fb55e`.

---

## Ratchet history

`OFFENDER_CEILINGS` in `tests/type-scale-guard.test.ts`. Both numbers are read from
the guard's own failure message, never hand-counted, and may only go **down**.

| After       | Arbitrary type sizes | Ad-hoc ink alphas |
| ----------- | -------------------- | ----------------- |
| slice start | 351                  | 738               |
| Task 2      | 343                  | 729               |
| Task 3      | 333                  | 709               |
| Task 4      | 333 (unchanged)      | 709 (unchanged)   |
| Task 5      | 302                  | 669               |
| Task 6      | 288                  | 651               |
| Task 7      | 265                  | 613               |
| Task 8      | **244**              | **548**           |

Task 4 moving neither number is legitimate and was verified: it was a structural
task (collapsing next week into a `<details>` summary) over rows Task 3 had already
migrated.

## Task status

| Task                                                         | Commits            | Review                                        |
| ------------------------------------------------------------ | ------------------ | --------------------------------------------- |
| 1 — `--ink-race` token, retire the 10px `.label-micro` floor | `9a929bc..bc33038` | clean after 1 fix                             |
| 2 — page chrome, tabs, bottom nav, week strip                | `bc33038..241578b` | clean after 2 fixes                           |
| 3 — week day row, status pill → dot                          | `241578b..e697907` | clean after 3 fixes                           |
| 4 — collapse next-week preview                               | `e697907..7e3f2df` | clean after 4 fixes, zero issues on re-review |
| 5 — Week tab prose blocks                                    | `7e3f2df..324dd3c` | clean after 1 fix                             |
| 6 — Week tab page chrome, skeleton scroll                    | `324dd3c..df00040` | clean, no Critical/Important                  |
| 7 — availability intake path                                 | `df00040..66e3775` | clean after 1 fix                             |
| 8 — races-section + plan preview                             | `9e62253..89a623f` | clean after 2 fixes                           |
| 9–12                                                         | not started        | —                                             |

Out-of-band commits: `d611e0d` (get-wellness fix, merged as `64c78a8`) and `9e62253`
(the ink ruling written into the plan).

## Deferred MINORs — this is the whole-branch review's agenda

None of these blocked a task gate. All were raised by a task reviewer, accepted as
Minor, and deliberately not fixed.

**Guards and tests**

1. `tests/type-scale-guard.test.ts` — `SCALE_PX` hardcodes the seven type-scale px
   values, a second source of truth alongside `globals.css`. Drifts silently if a
   token's rem value changes.
2. `tests/glass-contrast-guard.test.ts` — `declaredTokenNames()` duplicates three
   lines from `tests/contrast-guard.test.ts`.
3. `tests/glass-contrast-guard.test.ts` — the `TEXT_INKS` doc comment explains why
   `accent` and `coach-ink` are included but never mentions `viz-muted-ink`, the
   list's seventh and least obvious member.
4. `src/app/train/skeleton-table.test.ts` — the scroll assertion is **positionally**
   coupled: it finds the file's only `<table>` and searches 400 chars backwards for
   `overflow-x-auto`. Sound today; fragile if a second table ever lands earlier in
   the file.
5. The token-proof assertions for `day-actions` and `event-readiness` exercise one
   render branch each (idle select-row; fully-available verdict). The ratchet's
   source-level scan still covers the rest, so this is not a regression hole.
6. `block-sheet.test.tsx`'s new discriminating assertion covers the **energy** chips
   only — the sport chips render solely when `sports.length > 1` and the fixture
   passes one sport.
7. The token-proof regexes (`text-white\/`, `bg-white\/`, `border-white\/`) do not
   catch a **bare** `text-white` with no alpha slash. Task 8 confirmed by hand that
   none remain in its files; the gap is inherited from the plan.

**Visual / design**

8. **Light mode: `bg-surface-raised` and `bg-surface-overlay` are the same hex**
   (`#ffffff`). block-sheet's inactive chip therefore reads as outline-vs-filled in
   light rather than having its own fill. Dark is genuinely distinct
   (`#161616` vs `#1f1f1f`). **Check in the light PNGs.**
9. The readiness figure in `page.tsx` is not wrapped in `font-numeric` — it is
   interleaved in a mixed string (`"72 · green"`).
10. `border-current` on the readiness chip makes the _calibrating_ band's border
    equal its ink colour, where it used to be a distinct low-alpha white.
11. `fuelling-card`'s Before/During/After labels and its body copy both landed on
    `text-ink-secondary`, flattening a two-tier hierarchy to font-weight alone. This
    predates the per-pair override and is one of the 14 retro sites below.
12. `races-section`'s B-priority badge border went from a distinct
    `border-amber-400/30` to the generic `border-hairline`, so B and C are now
    distinguished by text colour alone.
13. `block-sheet`'s `hover:bg-chart-5/10` is a tone-background hover pattern used
    nowhere else in the codebase.
14. `races-section`'s `divide-hairline` is a first usage of that utility (valid —
    `--color-hairline` auto-generates it).
15. `week-day-list.test.tsx:350` still says "DayActions' own pre-token classes",
    trivially stale now that it is migrated. The sentence's point still holds.

## Open questions for the ruling authority

- **Do ordered tone ramps get their own ink override?** Task 8's A/B/C priority
  badges are a deliberate loud→quiet ramp, but they are not the "label + subordinate
  detail" shape the sanctioned override names. C was implemented on `ink-muted`,
  the review found that unlicensed, and it was reverted to `ink-secondary` to
  conform to the written rule. If a tone-ramp override is formalised, `races-section.tsx:66`
  is the one line to change back.

## Planted TODOs and which task discharges them

- ~~`week-day-list.test.tsx` — restore the unmodified `CURRENT_WEEK_DAYS` fixture
  once `day-actions.tsx` is migrated~~ **discharged by Task 5.**
- `src/app/train/skeleton-table.test.ts` — the whole-file assertion is `it.fails`
  and **Task 11 must flip it to `it`** once History and Fitness are migrated. A
  comment at the site names Task 11.
- **14 sites** across the six files migrated in Tasks 3–7 carried `text-white/60` or
  `/65` and predate the per-pair override. **Task 12 sweeps them**; they were
  deliberately not fixed by reopening six commits.

## Test-suite facts a newcomer will otherwise misread

- **Three `it.fails` are deliberate and expected-failure IS their passing state.**
  Two in `tests/type-scale-guard.test.ts` (they pass only at zero offenders
  app-wide, which is slice 9) and one in `src/app/train/skeleton-table.test.ts`.
  Do not "fix" them.
- **`tests/scheduler.test.ts` is an intermittent full-suite-only flake.** Passes 4/4
  standalone. `vitest.config.ts` records why: it shares the `sync_jobs` queue with
  `morning-hook.test.ts`.
- **`src/lib/tools/get-wellness.test.ts` was a time bomb, now fixed.** Three fixtures
  hardcoded `2026-08-05` against a `{ days: 7 }` query and aged out at midnight on
  2026-08-13. Inherited, not this slice's. Dates are now derived two days back from
  the run.
- **Run the suite with the whole `.env`**: `set -a && . ./.env && set +a && npm test`.
  Vitest loads none of it, and `DATABASE_URL` alone still fails 25 tests for a
  missing `ENCRYPTION_KEY`.
- `npm run build` is **not** in the gate and is the only check that catches a sync
  export from a `"use server"` file. Run it before the PR.

## The get-wellness fix is deliberately not on main

`fix/get-wellness-date-rot` branches off `main` and holds one commit (`d611e0d`),
merged into this slice as `64c78a8` so the slice's gate runs green. It is **not**
merged to main: that is the user's decision, the base branch gates on `checks` and
`docker`, and a peer session's instruction is not user authorisation.

**Flag in the release notes that v0.101 carries one unrelated test fix.** The branch
is ready for its own PR whenever the user wants it.

## Process notes that changed how this slice is reviewed

- **One implementer report invented a supporting quotation from its own brief**
  (Task 3, corrected in the fix commit). Since then every reviewer is instructed to
  verify citations against the named source. Two later reports were checked this way
  and found honest.
- **Four defects in the plan itself were found by review, not by the author.** They
  are fixed, but they are the reason this plan should be read as a starting point
  rather than as verified truth:
  1. Task 1's derived `TEXT_INKS` filter used `startsWith("ink-")`, silently
     excluding `coach-ink` and `accent` — both real text tokens rendered on glass.
     Now role-only with an exact seven-member inventory.
  2. Task 2's "the same pill treatment" was ambiguous and left `ViewTabs`' inactive
     segment with no background while `TrainTabs` kept one.
  3. Task 4's reference code silently dropped `bg-surface-overlay` from the
     "Next week" divider. Restored, and extracted as a prop-free `NextWeekDivider`
     so the tint has one definition.
  4. Task 7's prescribed pill treatment was applied inside a container already at
     `bg-surface-overlay`, leaving a selection chip whose selected state read
     through text colour alone. See the surface-ladder note below.
- **The surface ladder is `base → glass`/`raised` → `overlay`.** The house pill
  treatment (active `overlay`, inactive `raised`) works only because active sits one
  step **above** inactive. Inside a container already at `overlay` that step does not
  exist. The correct treatment there is active `bg-accent text-primary-foreground`,
  inactive explicit `bg-surface-raised text-ink-secondary`.
- **React 19 splits adjacent JSX children with `<!-- -->`.** Adapt the **test**,
  never the component. Task 2 reshaped `{r}d` into a template literal to make an
  assertion pass and had to revert it. House precedent for absorbing the marker:
  `src/components/today/week-row.test.tsx:44`.
- **Cards are `.glass`, not flat surfaces** — v0.100.1 reversed slice 0's retirement
  of glass as a substrate, on owner feedback from the live app. The slice-1 plan's
  migration map still says `bg-surface-raised` and is stale on this point.
- **The ink buckets are the nearest-value partition.** A global redraw was proposed
  and rejected on the arithmetic; the per-pair override was adopted instead. Full
  reasoning and the measurement table are in the plan, section "The ink buckets are
  the nearest-value partition — and the one override that beats them".

## Still owed

- Tasks 9 (History), 10 (Season timeline), 11 (Fitness + flip the `it.fails`),
  12 (sweep to zero offenders, the 14 retro sites, and the duplicate-data scan).
- Task 13: browser capture and axe pass. **The ink-flattening check against the
  per-pair override belongs here**, as do deferred MINORs 8, 9, 10 and 12.
- Whole-branch review, on the most capable model, **by a session that did not author
  the plan**. v0.46 in this project's history had a controller-run final review and
  it is recorded as a mistake.
- Release: version bump to `0.101.0`, CHANGELOG written **from the diff**, roadmap
  updated (do **not** tick 2b.4 — it closes at slice 9), then
  `./scripts/release.sh 0.101.0 <pr>`.
