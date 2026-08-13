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
| Task 8      | 244                  | 548               |
| Task 9      | 235                  | 529               |
| Task 10     | 229                  | 509               |
| Task 11     | 223                  | 496               |
| Task 12     | **217**              | **480**           |

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
| 9 — History, unfix the fixed-height row                      | `7001699..0e78437` | clean after 1 fix                             |
| 10 — Season timeline, the "cannot fit" case                  | `1ee0837..48a9477` | clean, no Critical/Important                  |
| 11 — Fitness tile label cut + `it.fails` flip                | `48a9477..7c4497d` | clean after 1 fix                             |
| 12 — the sweep (A–D)                                         | `7c4497d..6d8cb91` | clean after 4 fixes                           |

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

## Closed questions

**Do ordered tone ramps get their own ink override? — NO. Answered 2026-08-13 on the
merits. `races-section.tsx:66` stays on `text-ink-secondary`.**

Raised because Task 8's A/B/C priority badges look like a deliberate loud→quiet ramp;
C was implemented on `ink-muted`, review found that unlicensed under the sanctioned
override, and it was reverted to nearest-value. Three reasons it stays reverted:

1. **There is no ink ramp among those three badges.** `A: text-ink-race`,
   `B: text-chart-3`, `C: text-ink-secondary` — A and B are carried by _hue_ tokens,
   and C is the only one of the three on the neutral ink scale at all. A one-member
   ramp is not a ramp, so an ink-level override has nothing to preserve.
2. **No collapse occurred.** The per-pair override exists for a demonstrated defect —
   two alphas that _differed_ in the original landing on one token. C had a single
   alpha (`/60`) with no second ink value to collapse against. Nothing flattened.
3. **The priority is already encoded in text.** `races-section.tsx:578` renders
   `race.priority`, so the badge literally reads "A" / "B" / "C". Colour is a
   secondary cue reinforcing a letter that is already there — which is also why the
   hue-vs-neutral split creates no accessibility gap for a reader who cannot separate
   `ink-race` from `chart-3`.

**The durable principle: an override requires a demonstrated collapse.** Nearest-value
is the default precisely because it is mechanical and can be argued with using
arithmetic. Every override is a hole in that, so each needs a specific defect it
repairs. A second override covering cases where nothing flattened would start the
drift from "override where hierarchy provably broke" to "override where it looks
nicer" — and the second is unfalsifiable. One default, one exception, each with a
stated trigger.

**What would reopen it:** a ramp whose members are _all_ on the neutral ink scale and
_did_ differ by alpha before migration, where nearest-value collapses two or more of
them. That is the per-pair defect with three members instead of two, and the existing
override arguably already covers it — which is a further reason not to write a second
rule.

## Planted TODOs and which task discharges them

- ~~`week-day-list.test.tsx` — restore the unmodified `CURRENT_WEEK_DAYS` fixture
  once `day-actions.tsx` is migrated~~ **discharged by Task 5.**
- `src/app/train/skeleton-table.test.ts` — the whole-file assertion is `it.fails`
  and **Task 11 must flip it to `it`** once History and Fitness are migrated. A
  comment at the site names Task 11.
- **14 sites** across the six files migrated in Tasks 3–7 carried `text-white/60` or
  `/65` and predate the per-pair override. **Task 12 sweeps them**; they were
  deliberately not fixed by reopening six commits.

## The 2026-08-13 host crash — what it cost, and what it did not

The host went down mid-Task-9. Nothing committed was lost: `origin` already had
every commit, because pushing at each task boundary had just been adopted.

What **was** lost: the peer session that had been coordinating this slice — it held
the ink rulings, had taken ownership of the whole-branch review, and was to
adjudicate Task 13's captures. Its context is unrecoverable. The only reason that
cost little is that its rulings had been written into this ledger and the plan a few
commits earlier. **That is the argument for this file existing.**

Two traps the crash set, both survived:

1. **The first full suite run afterwards reported 108 failed files / 92 failed tests
   while `tsc` and `eslint` were clean.** That shape is infrastructure, not code:
   `recover-devdb` had exited 255 when the host went down. `docker start recover-devdb`
   and the suite returned 322 files passed, 0 failed. **After any crash, check the
   container before reading a red suite as a regression.** The production containers
   (`recover-app-1` on 3000, `recover-db-1` on 5434) restart themselves and were never
   involved.
2. **`.superpowers/sdd/task-9-report.md` exists and is from 2026-08-07** — a different
   release that reused the filename. Task 9's own implementer was killed before
   writing one. Handing that stale file to a reviewer would have fed it a report about
   unrelated work. `.superpowers/sdd/` holds 314 files spanning many releases; a
   filename match there is not evidence.

Task 9's edits survived uncommitted in the working tree, were verified (focused tests,
typecheck, lint, full suite), had their ceilings re-pinned from the guard's own count,
and were committed and then review-gated normally.

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

## Whole-branch review — run 2026-08-13, findings fixed

Full findings: `docs/plans/2026-08-12-v099-slice2-train-review.md` (tracked).
3 Critical, 7 Important, 3 Minor. Run on a fresh agent with no inherited context.

**All three Criticals and four Importants are fixed** in `404dd75`, `d04c17a`,
`72db7a5`:

- **C1** the 12px floor was asserted against a hand-copied `SCALE_PX` table; nothing
  read the `@theme inline` block where the real values live. Demonstrated green at a
  10px floor. **This branch caused it** — retargeting `.label-micro` from a literal
  `10px` to `var(--text-label)` moved the primary floor off the checked branch.
  Now derived via `readScaleTokens()`, which throws if the block is missing, plus a
  new assertion that every `--text-*` clears 12px in its own right. Mutation
  re-verified by the controller: `--text-label: 0.625rem` turns two assertions red.
- **C2** `week-strip.tsx` had moved to `.glass`, which lifted the strip 4px on hover
  inside Today's `glass-no-hover` card, contradicted the design reference, and created
  glass-in-glass at 4.61:1 on a ground `glass-contrast-guard` claims to have
  enumerated. Reverted to `border border-hairline bg-surface-raised`.
- **C3** `bottom-nav.tsx` went 8px→12px keeping `uppercase tracking-widest`,
  overflowing the global nav by 62px at 320pt and 22px at 360pt (measured in headless
  Chromium). The design reference had already dropped uppercase and tracking at 12px;
  the implementation kept them. Dropped.
- **I1** `--ink-race`'s comment claimed four surfaces; it reaches three.
- **I4** Task 12's checklist structurally could not find the 14 retro ink sites — they
  already read `text-ink-secondary`, and its grep looks for `text-white/`. The
  enumerated list is now in Task 12 Step 1, derived while the diff was addressable.
- **I5** Task 12's zero-offender grep excluded `bottom-nav.tsx` and `ui/collapsible.tsx`,
  which the slice deliberately changed and which still hold live offenders.
- **I6** `skeleton-table.test.ts` re-spelled the offender regexes narrower than the
  guard it inherits from. Now imported from `src/lib/design/type-scale-patterns.ts`,
  and it asserts exactly one `<table>`.

**Correction to the review, found while fixing:** it lists fuelling-card's
Before/During/After flattening as one of the 14 I4 sites. It is not — those were
`/85` and `/75`, outside the `/60`|`/65` filter. It is a real but separate unswept
defect. Still owed.

**Still open from the review:** I2 (RangeTabs is a third pill treatment), I3
(`text-<tone>` on `bg-<tone>/N` is unguarded; 3 of 6 tone tokens fail AA in it, legal
today only because two live sites are icons), I7 (**slice-9 blocker** — in light
`surface-raised == surface-overlay`, so the active/inactive pill has no visible
selected state; the ladder this slice rests on is undefined in one theme), M1–M3.

## Tasks 10–12, and what the sweep found

**Task 10 — Season timeline.** The design reference's only "cannot fit" case: 24 per-bar
micro-labels (9px week + 8px session count, the app's smallest text) need ~500–540px at
the floor. Replaced by an axis tick every 3rd week plus the last, one always-visible
readout, and horizontal scroll. **No client component and no faked interaction** — the
readout names the latest week and every bar keeps its existing `title`. That is a real
loss of reach for the eleven older weeks and it is the disclosed cost.

**Task 11 — Fitness.** Tiles print `CTL`/`ATL`/`TSB` only; the full name is `sr-only`.
`FitnessTile.srLabel` is **required**, so the compiler named all three stale call sites.
This task also **flipped `skeleton-table.test.ts`'s whole-file assertion from `it.fails`
to a real `it`** — `page.tsx` is now clean under the widened shared regexes. The suite's
expected-fail count went 3 → 2, which is the visible proof the flip was real.

**Task 12 — the sweep. It found a planning gap, not a leftover.**
`season-mode-switch.tsx` and `plan-style-switch.tsx` — the two control pills in the Week
tab header — **were never assigned to any task**. Entirely unmigrated: 12 offender sites
including text below the floor and an active/inactive pair each. Had the sweep's grep not
been widened by the whole-branch review (finding I5), they would have shipped.

### The surface is at zero, with exactly one recorded exclusion

`block-sheet.tsx`'s modal scrim (`bg-black/60`) stays. It is neither ink nor surface —
it composites over arbitrary page content rather than sitting as an opaque ground — and
there is no scrim token. Inventing one for a single call site would be worse than the raw
utility. `ui/bottom-sheet.tsx` uses the identical value for its own scrim, so this is
repo convention, not a one-off excuse. **The exclusion is documented at the call site**,
not only here.

### A subtlety worth keeping: comments count

The offender ratchet scans **source lines**, so a comment documenting an original
`text-white/60` counts as an occurrence and makes a zero claim un-literal. Every comment
in this slice that describes a pre-migration alpha writes it as a percentage instead.

### What the sweep's own review caught

- **The availability link vanished in the branch that needs it most.** Part D deleted a
  prose note that duplicated `NextWeekSummary`'s figures — correct — but the note also
  carried the "Set next week's availability" link and was gated only on there _being_ a
  next week. Moving the link inside the summary dropped it from the
  `nextWeekHasAvailability === false` branch: an athlete who has not set availability got
  a dead end where the link used to be. Fixed by extracting `NextWeekAvailabilityNote`
  and rendering it in **both** branches, mirroring `NextWeekDivider`.
- **Two tests had gone vacuous.** `plan-style-switch.test.tsx` lost its "exactly one
  button disabled" invariant while keeping a title claiming to check it;
  `season-timeline-card.test.tsx` asserted target/actual against the whole document, so
  it kept passing on the _tiles_ after Part D removed those figures from the readout —
  protecting nothing in either direction. Both rewritten to discriminate.

### Another stale-report trap, second occurrence

`.superpowers/sdd/task-12-report.md` is from an unrelated **2026-08-07** release that
reused the name — exactly like `task-9-report.md`. A reviewer handed it would have read
about race-demand evidence docs. `.superpowers/sdd/` spans many releases; **a filename
match there is not evidence**. Check mtimes.
